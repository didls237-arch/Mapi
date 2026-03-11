import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Message,
  PermissionsBitField
} from "discord.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import {
  handleAnalyze,
  handleRollover,
  handleStatus,
  handleSummary,
  resumePendingAnalysisJobs
} from "./discord/handlers.js";
import { handleTextCommandMessage } from "./discord/textCommands.js";
import { handleMacroScenarioMessage } from "./services/macroScenarioService.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const QUESTION_CHANNEL_IDS = new Set<string>([
  config.MACRO_QUESTION_CHANNEL_ID,
  config.KOR_QUESTION_CHANNEL_ID,
  config.EX_QUESTION_CHANNEL_ID,
  config.COIN_QUESTION_CHANNEL_ID
]);

async function runSetupChecks(): Promise<void> {
  if (!config.ENABLE_SETUP_CHECKS) return;

  const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID);
  const channels = await guild.channels.fetch();
  const required = [
    config.MACRO_FORUM_CHANNEL_ID,
    config.KOR_FORUM_CHANNEL_ID,
    config.EX_FORUM_CHANNEL_ID,
    config.COIN_FORUM_CHANNEL_ID,
    config.MACRO_SUMMARY_CHANNEL_ID,
    config.KOR_SUMMARY_CHANNEL_ID,
    config.EX_SUMMARY_CHANNEL_ID,
    config.COIN_SUMMARY_CHANNEL_ID,
    config.MACRO_QUESTION_CHANNEL_ID,
    config.KOR_QUESTION_CHANNEL_ID,
    config.EX_QUESTION_CHANNEL_ID,
    config.COIN_QUESTION_CHANNEL_ID
  ];

  for (const id of required) {
    if (!channels.has(id)) {
      throw new Error(`Configured channel ID not found in guild: ${id}`);
    }
  }
}

function isQuestionChannel(message: Message): boolean {
  const channel = message.channel;
  if (channel.type === ChannelType.GuildText) {
    return QUESTION_CHANNEL_IDS.has(channel.id);
  }

  if (channel.isThread() && channel.parent && channel.parent.type === ChannelType.GuildText) {
    return QUESTION_CHANNEL_IDS.has(channel.parent.id);
  }

  return false;
}

function isMacroForumThreadMessage(message: Message): boolean {
  if (!message.channel.isThread()) return false;
  return message.channel.parentId === config.MACRO_FORUM_CHANNEL_ID;
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot ready: ${readyClient.user.tag}`);
  try {
    await runSetupChecks();
    console.log("Setup checks passed.");
    await resumePendingAnalysisJobs(client);
    console.log("Resume check completed.");
  } catch (error) {
    console.error("Setup/resume failed:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = interaction.commandName;

  try {
    if (command === "analyze") {
      await handleAnalyze(client, interaction as ChatInputCommandInteraction);
      return;
    }
    if (command === "summary") {
      await handleSummary(client, interaction as ChatInputCommandInteraction);
      return;
    }
    if (command === "rollover") {
      await handleRollover(client, interaction as ChatInputCommandInteraction);
      return;
    }
    if (command === "status") {
      await handleStatus(interaction as ChatInputCommandInteraction);
      return;
    }
  } catch (error) {
    const replyMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: replyMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: replyMessage, ephemeral: true });
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guildId) return;

  try {
    const handledAsCommand = await handleTextCommandMessage(client, message);
    if (handledAsCommand) {
      return;
    }
  } catch (error) {
    await message.reply(`Command failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const member = message.member;
  if (!member) return;

  const isAdmin =
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.roles.cache.has(config.DISCORD_ADMIN_ROLE_ID);

  if (isAdmin && isMacroForumThreadMessage(message)) {
    try {
      await handleMacroScenarioMessage({
        message,
        actorUserId: message.author.id
      });
    } catch (error) {
      await message.channel.send(
        `Macro response failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return;
  }

  const isParticipant = member.roles.cache.has(config.DISCORD_PARTICIPANT_ROLE_ID);
  if (!isParticipant) return;

  if (!isQuestionChannel(message)) {
    if (message.deletable) {
      await message.delete().catch(() => undefined);
    }

    const warning = await message.channel.send(
      `<@${message.author.id}> Participants can only post in question channels.`
    );
    setTimeout(() => {
      warning.delete().catch(() => undefined);
    }, 7000);
  }
});

process.on("SIGINT", async () => {
  await pool.end();
  client.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await pool.end();
  client.destroy();
  process.exit(0);
});

client.login(config.DISCORD_TOKEN).catch((error) => {
  console.error("Failed to login:", error);
  process.exit(1);
});
