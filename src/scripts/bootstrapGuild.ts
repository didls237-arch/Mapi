import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import dotenv from "dotenv";
import {
  ChannelType,
  Client,
  Events,
  PermissionFlagsBits,
  PermissionsBitField,
  type CategoryChannel,
  type Guild,
  type Role,
  type TextChannel,
  type ForumChannel,
  type OverwriteResolvable
} from "discord.js";

dotenv.config();

interface BootstrapEnv {
  DISCORD_TOKEN: string;
  DISCORD_GUILD_ID: string;
  DISCORD_ADMIN_ROLE_ID?: string;
  DISCORD_PARTICIPANT_ROLE_ID?: string;
  BOOTSTRAP_ADMIN_ROLE_NAME?: string;
  BOOTSTRAP_PARTICIPANT_ROLE_NAME?: string;
  BOOTSTRAP_ENV_FILE?: string;
}

const env = process.env as unknown as BootstrapEnv;

function requireEnv(key: keyof BootstrapEnv): string {
  const value = env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value.trim();
}

function isCategory(channel: unknown): channel is CategoryChannel {
  return !!channel && typeof channel === "object" && (channel as { type?: number }).type === ChannelType.GuildCategory;
}

function buildForumOverwrites(input: {
  guild: Guild;
  adminRole: Role;
  participantRole: Role;
  botRoleId: string;
}): OverwriteResolvable[] {
  const { guild, adminRole, participantRole, botRoleId } = input;
  return [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreateInstantInvite]
    },
    {
      id: participantRole.id,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreateInstantInvite]
    },
    {
      id: adminRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.CreateInstantInvite,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads
      ]
    },
    {
      id: botRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];
}

function buildTextOverwrites(input: {
  guild: Guild;
  adminRole: Role;
  participantRole: Role;
  botRoleId: string;
  participantCanSend: boolean;
}): OverwriteResolvable[] {
  const { guild, adminRole, participantRole, botRoleId, participantCanSend } = input;

  const participantAllow = [PermissionFlagsBits.ViewChannel];
  if (participantCanSend) {
    participantAllow.push(PermissionFlagsBits.SendMessages);
  }

  const participantDeny = [PermissionFlagsBits.CreateInstantInvite];
  if (!participantCanSend) {
    participantDeny.push(PermissionFlagsBits.SendMessages);
  }

  return [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreateInstantInvite]
    },
    {
      id: participantRole.id,
      allow: participantAllow,
      deny: participantDeny
    },
    {
      id: adminRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.CreateInstantInvite
      ]
    },
    {
      id: botRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];
}

async function ensureRole(input: {
  guild: Guild;
  roleId?: string;
  roleName: string;
  admin: boolean;
}): Promise<Role> {
  const { guild, roleId, roleName, admin } = input;

  if (roleId) {
    const roleById = await guild.roles.fetch(roleId);
    if (roleById) return roleById;
  }

  const existingByName = guild.roles.cache.find((r) => r.name === roleName);
  if (existingByName) {
    return existingByName;
  }

  return guild.roles.create({
    name: roleName,
    color: admin ? 0xe11d48 : 0x0ea5e9,
    permissions: admin ? new PermissionsBitField([PermissionFlagsBits.Administrator]) : []
  });
}

async function ensureCategory(guild: Guild, name: string): Promise<CategoryChannel> {
  const existing = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name === name
  );
  if (existing && isCategory(existing)) {
    return existing;
  }

  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory
  });

  if (!isCategory(created)) {
    throw new Error(`Failed to create category: ${name}`);
  }

  return created;
}

async function ensureForumChannel(input: {
  guild: Guild;
  parent: CategoryChannel;
  name: string;
  adminRole: Role;
  participantRole: Role;
  botRoleId: string;
}): Promise<ForumChannel> {
  const { guild, parent, name, adminRole, participantRole, botRoleId } = input;

  const existing = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildForum && ch.parentId === parent.id && ch.name === name
  );

  const overwrites = buildForumOverwrites({ guild, adminRole, participantRole, botRoleId });

  if (existing && existing.type === ChannelType.GuildForum) {
    await existing.permissionOverwrites.set(overwrites);
    return existing;
  }

  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildForum,
    parent: parent.id,
    permissionOverwrites: overwrites,
    defaultAutoArchiveDuration: 10080
  });

  if (created.type !== ChannelType.GuildForum) {
    throw new Error(`Failed to create forum channel: ${name}`);
  }

  return created;
}

async function ensureTextChannel(input: {
  guild: Guild;
  parent: CategoryChannel;
  name: string;
  adminRole: Role;
  participantRole: Role;
  botRoleId: string;
  participantCanSend: boolean;
}): Promise<TextChannel> {
  const { guild, parent, name, adminRole, participantRole, botRoleId, participantCanSend } = input;

  const existing = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.parentId === parent.id && ch.name === name
  );

  const overwrites = buildTextOverwrites({
    guild,
    adminRole,
    participantRole,
    botRoleId,
    participantCanSend
  });

  if (existing && existing.type === ChannelType.GuildText) {
    await existing.permissionOverwrites.set(overwrites);
    return existing;
  }

  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites: overwrites
  });

  if (created.type !== ChannelType.GuildText) {
    throw new Error(`Failed to create text channel: ${name}`);
  }

  return created;
}

function upsertEnvContent(existing: string, updates: Record<string, string>): string {
  const lines = existing.split(/\r?\n/);
  const keys = Object.keys(updates);
  const seen = new Set<string>();

  const next = lines.map((line) => {
    let replaced = line;
    for (const key of keys) {
      const pattern = new RegExp(`^\\s*${key}=`);
      if (pattern.test(line)) {
        replaced = `${key}=${updates[key]}`;
        seen.add(key);
        break;
      }
    }
    return replaced;
  });

  for (const key of keys) {
    if (!seen.has(key)) {
      next.push(`${key}=${updates[key]}`);
    }
  }

  return next.join("\n").replace(/\n+$/, "") + "\n";
}

async function ensureEnvFile(envPath: string): Promise<void> {
  if (existsSync(envPath)) return;

  const examplePath = path.join(process.cwd(), ".env.example");
  if (existsSync(examplePath)) {
    const example = await fs.readFile(examplePath, "utf8");
    await fs.writeFile(envPath, example, "utf8");
    return;
  }

  await fs.writeFile(envPath, "", "utf8");
}

async function writeEnvUpdates(envPath: string, updates: Record<string, string>): Promise<void> {
  await ensureEnvFile(envPath);
  const existing = await fs.readFile(envPath, "utf8");
  const next = upsertEnvContent(existing, updates);
  await fs.writeFile(envPath, next, "utf8");
}

async function main(): Promise<void> {
  const token = requireEnv("DISCORD_TOKEN");
  const guildId = requireEnv("DISCORD_GUILD_ID");
  const envFile = env.BOOTSTRAP_ENV_FILE?.trim() || ".env";

  const client = new Client({ intents: [] });
  await client.login(token);
  await once(client, Events.ClientReady);

  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();
    await guild.roles.fetch();

    const me = await guild.members.fetchMe();
    const botRoleId = me.roles.botRole?.id ?? me.roles.highest.id;

    const adminRole = await ensureRole({
      guild,
      roleId: env.DISCORD_ADMIN_ROLE_ID,
      roleName: env.BOOTSTRAP_ADMIN_ROLE_NAME?.trim() || "Admin",
      admin: true
    });

    const participantRole = await ensureRole({
      guild,
      roleId: env.DISCORD_PARTICIPANT_ROLE_ID,
      roleName: env.BOOTSTRAP_PARTICIPANT_ROLE_NAME?.trim() || "Participant",
      admin: false
    });

    const macroCategory = await ensureCategory(guild, "Macro Scenario");
    const korCategory = await ensureCategory(guild, "Kor.Analysis");
    const exCategory = await ensureCategory(guild, "Ex.Analysis");
    const coinCategory = await ensureCategory(guild, "Coin Analysis");

    const macroForum = await ensureForumChannel({
      guild,
      parent: macroCategory,
      name: "macro-scenario",
      adminRole,
      participantRole,
      botRoleId
    });
    const korForum = await ensureForumChannel({
      guild,
      parent: korCategory,
      name: "kor-analysis",
      adminRole,
      participantRole,
      botRoleId
    });
    const exForum = await ensureForumChannel({
      guild,
      parent: exCategory,
      name: "ex-analysis",
      adminRole,
      participantRole,
      botRoleId
    });
    const coinForum = await ensureForumChannel({
      guild,
      parent: coinCategory,
      name: "coin-analysis",
      adminRole,
      participantRole,
      botRoleId
    });

    const macroSummary = await ensureTextChannel({
      guild,
      parent: macroCategory,
      name: "summary",
      adminRole,
      participantRole,
      botRoleId,
      participantCanSend: false
    });
    const korSummary = await ensureTextChannel({
      guild,
      parent: korCategory,
      name: "summary",
      adminRole,
      participantRole,
      botRoleId,
      participantCanSend: false
    });
    const exSummary = await ensureTextChannel({
      guild,
      parent: exCategory,
      name: "summary",
      adminRole,
      participantRole,
      botRoleId,
      participantCanSend: false
    });
    const coinSummary = await ensureTextChannel({
      guild,
      parent: coinCategory,
      name: "summary",
      adminRole,
      participantRole,
      botRoleId,
      participantCanSend: false
    });

    const macroQuestion = await ensureTextChannel({
      guild,
      parent: macroCategory,
      name: "question",
      adminRole,
      participantRole,
      botRoleId,
      participantCanSend: true
    });
    const korQuestion = await ensureTextChannel({
      guild,
      parent: korCategory,
      name: "question",
      adminRole,
      participantRole,
      botRoleId,
      participantCanSend: true
    });
    const exQuestion = await ensureTextChannel({
      guild,
      parent: exCategory,
      name: "question",
      adminRole,
      participantRole,
      botRoleId,
      participantCanSend: true
    });
    const coinQuestion = await ensureTextChannel({
      guild,
      parent: coinCategory,
      name: "question",
      adminRole,
      participantRole,
      botRoleId,
      participantCanSend: true
    });

    const updates: Record<string, string> = {
      DISCORD_GUILD_ID: guild.id,
      DISCORD_ADMIN_ROLE_ID: adminRole.id,
      DISCORD_PARTICIPANT_ROLE_ID: participantRole.id,
      MACRO_FORUM_CHANNEL_ID: macroForum.id,
      KOR_FORUM_CHANNEL_ID: korForum.id,
      EX_FORUM_CHANNEL_ID: exForum.id,
      COIN_FORUM_CHANNEL_ID: coinForum.id,
      MACRO_SUMMARY_CHANNEL_ID: macroSummary.id,
      KOR_SUMMARY_CHANNEL_ID: korSummary.id,
      EX_SUMMARY_CHANNEL_ID: exSummary.id,
      COIN_SUMMARY_CHANNEL_ID: coinSummary.id,
      MACRO_QUESTION_CHANNEL_ID: macroQuestion.id,
      KOR_QUESTION_CHANNEL_ID: korQuestion.id,
      EX_QUESTION_CHANNEL_ID: exQuestion.id,
      COIN_QUESTION_CHANNEL_ID: coinQuestion.id
    };

    await writeEnvUpdates(path.join(process.cwd(), envFile), updates);

    console.log("Bootstrap complete. Updated env keys:");
    for (const [key, value] of Object.entries(updates)) {
      console.log(`${key}=${value}`);
    }
    console.log(`Saved to ${envFile}`);
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});