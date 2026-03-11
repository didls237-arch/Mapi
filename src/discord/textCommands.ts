import {
  ChannelType,
  Client,
  ForumChannel,
  Message,
  PermissionsBitField,
  TextChannel,
  ThreadChannel
} from "discord.js";
import { config } from "../config.js";
import {
  countRunningJobs,
  findRunningJobByTicker
} from "../repositories/analysisJobRepository.js";
import {
  getSummaryCheckpoint,
  insertAuditLog,
  upsertSummaryCheckpoint,
  upsertThreadState
} from "../repositories/stateRepository.js";
import {
  marketForumId,
  marketSummaryChannelId,
  runAnalysisFlow
} from "../services/analysisOrchestrator.js";
import { discussionTurn, startDiscussion } from "../services/openclawClient.js";
import {
  buildMacroSummaryRows,
  collectThreadMessagesSinceCheckpoint,
  formatTimelineTable
} from "../services/summaryService.js";
import { AnalysisMarket, MarketScope } from "../types.js";

const runningAnalysis = new Set<string>();
const analyzeCooldownByUser = new Map<string, number>();
let activeAnalysisJobs = 0;

interface ParsedTextCommand {
  name: string;
  args: string[];
}

function isAdminMessage(message: Message): boolean {
  const member = message.member;
  if (!member) return false;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.roles.cache.has(config.DISCORD_ADMIN_ROLE_ID)
  );
}

function parseTextCommand(content: string): ParsedTextCommand | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("!")) return null;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  return {
    name: tokens[0].slice(1).toLowerCase(),
    args: tokens.slice(1)
  };
}

function isTickerValid(ticker: string): boolean {
  return /^[A-Z0-9._:/-]{1,20}$/.test(ticker);
}

function isInCooldown(userId: string): { blocked: boolean; leftSec: number } {
  const now = Date.now();
  const cooldownMs = config.ANALYSIS_COMMAND_COOLDOWN_SEC * 1000;
  const last = analyzeCooldownByUser.get(userId);
  if (!last) return { blocked: false, leftSec: 0 };

  const diff = now - last;
  if (diff >= cooldownMs) {
    return { blocked: false, leftSec: 0 };
  }

  return {
    blocked: true,
    leftSec: Math.ceil((cooldownMs - diff) / 1000)
  };
}

function touchCooldown(userId: string): void {
  analyzeCooldownByUser.set(userId, Date.now());
}

function summaryChannelIdByScope(scope: MarketScope): string {
  if (scope === "macro") return config.MACRO_SUMMARY_CHANNEL_ID;
  if (scope === "kor") return config.KOR_SUMMARY_CHANNEL_ID;
  if (scope === "ex") return config.EX_SUMMARY_CHANNEL_ID;
  return config.COIN_SUMMARY_CHANNEL_ID;
}

function scopeByForumChannelId(channelId: string): MarketScope {
  if (channelId === config.KOR_FORUM_CHANNEL_ID) return "kor";
  if (channelId === config.EX_FORUM_CHANNEL_ID) return "ex";
  if (channelId === config.COIN_FORUM_CHANNEL_ID) return "coin";
  return "macro";
}

async function notifyAnalysisFailure(input: {
  client: Client;
  summaryChannel: TextChannel;
  actorUserId: string;
  market: AnalysisMarket;
  ticker: string;
  errorText: string;
}): Promise<{ summaryPosted: boolean; dmPosted: boolean }> {
  const baseMessage =
    `Analysis failed.\n` +
    `market=${input.market}, ticker=${input.ticker.toUpperCase()}\n` +
    `error: ${input.errorText}`;

  let summaryPosted = false;
  let dmPosted = false;

  try {
    await input.summaryChannel.send(baseMessage);
    summaryPosted = true;
  } catch (error) {
    console.error("Failed to send analysis error notice to summary channel:", error);
  }

  if (!summaryPosted) {
    try {
      const actor = await input.client.users.fetch(input.actorUserId);
      await actor.send(
        `[Discord AI Analysis Bot] ${input.market.toUpperCase()} ${input.ticker.toUpperCase()} failed\n` +
          `${input.errorText}`
      );
      dmPosted = true;
    } catch (error) {
      console.error("Failed to send analysis error notice via DM:", error);
    }
  }

  return { summaryPosted, dmPosted };
}

async function runAnalysisInBackground(input: {
  client: Client;
  lockKey: string;
  actorUserId: string;
  guildId: string;
  market: AnalysisMarket;
  ticker: string;
  forum: ForumChannel;
  summaryChannel: TextChannel;
}): Promise<void> {
  activeAnalysisJobs += 1;
  runningAnalysis.add(input.lockKey);

  try {
    await runAnalysisFlow({
      actorUserId: input.actorUserId,
      guildId: input.guildId,
      market: input.market,
      ticker: input.ticker,
      forum: input.forum,
      summaryChannel: input.summaryChannel
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    const notifyResult = await notifyAnalysisFailure({
      client: input.client,
      summaryChannel: input.summaryChannel,
      actorUserId: input.actorUserId,
      market: input.market,
      ticker: input.ticker,
      errorText
    });

    try {
      await insertAuditLog({
        event_type: "analysis_failed",
        guild_id: input.guildId,
        actor_user_id: input.actorUserId,
        details: {
          market: input.market,
          ticker: input.ticker.toUpperCase(),
          error: errorText,
          notification: notifyResult,
          source: "text_command"
        }
      });
    } catch (auditError) {
      console.error("Failed to write analysis_failed audit log:", auditError);
    }
  } finally {
    runningAnalysis.delete(input.lockKey);
    activeAnalysisJobs = Math.max(0, activeAnalysisJobs - 1);
  }
}

async function handleAnalyzeCommand(client: Client, message: Message, args: string[]): Promise<void> {
  const [marketRaw, tickerRaw] = args;
  if (!marketRaw || !tickerRaw) {
    await message.reply("Usage: !analyze <kor|ex|coin> <ticker>");
    return;
  }

  const market = marketRaw.toLowerCase() as AnalysisMarket;
  if (!["kor", "ex", "coin"].includes(market)) {
    await message.reply("market must be one of: kor, ex, coin");
    return;
  }

  const ticker = tickerRaw.trim().toUpperCase();
  if (!isTickerValid(ticker)) {
    await message.reply("Ticker format is invalid. Allowed: A-Z, 0-9, . _ : / - (max 20 chars)");
    return;
  }

  const cooldown = isInCooldown(message.author.id);
  if (cooldown.blocked) {
    await message.reply(`Cooldown active. Retry in ${cooldown.leftSec}s.`);
    return;
  }

  const lockKey = `${message.guildId}:${market}:${ticker}`;
  if (runningAnalysis.has(lockKey)) {
    await message.reply("This ticker is already being analyzed.");
    return;
  }

  if (activeAnalysisJobs >= config.ANALYSIS_MAX_CONCURRENCY) {
    await message.reply(`Max concurrency reached (${config.ANALYSIS_MAX_CONCURRENCY}). Try again later.`);
    return;
  }

  const runningDb = await countRunningJobs(message.guildId ?? "unknown");
  if (runningDb >= config.ANALYSIS_MAX_CONCURRENCY) {
    await message.reply(`DB concurrency limit reached (${config.ANALYSIS_MAX_CONCURRENCY}).`);
    return;
  }

  const existingJob = await findRunningJobByTicker({
    guild_id: message.guildId ?? "unknown",
    scope: market,
    ticker
  });
  if (existingJob) {
    await message.reply(`A running job already exists. thread_id=${existingJob.discord_thread_id}`);
    return;
  }

  const forum = await client.channels.fetch(marketForumId(market));
  const summaryChannel = await client.channels.fetch(marketSummaryChannelId(market));

  if (
    !forum ||
    forum.type !== ChannelType.GuildForum ||
    !summaryChannel ||
    summaryChannel.type !== ChannelType.GuildText
  ) {
    await message.reply("Forum/Summary channel config is invalid.");
    return;
  }

  touchCooldown(message.author.id);
  await message.reply(
    `${market.toUpperCase()} ${ticker} analysis started. Results will be posted to summary.`
  );

  void runAnalysisInBackground({
    client,
    lockKey,
    actorUserId: message.author.id,
    guildId: message.guildId ?? "unknown",
    market,
    ticker,
    forum: forum as ForumChannel,
    summaryChannel: summaryChannel as TextChannel
  });
}

async function resolveThreadForSummary(client: Client, message: Message, threadId?: string): Promise<ThreadChannel | null> {
  if (threadId) {
    const channel = await client.channels.fetch(threadId);
    if (!channel || !channel.isThread()) return null;
    return channel as ThreadChannel;
  }

  if (message.channel.isThread()) {
    return message.channel as ThreadChannel;
  }

  return null;
}

async function handleSummaryCommand(client: Client, message: Message, args: string[]): Promise<void> {
  const [scopeRaw, threadId] = args;
  if (!scopeRaw) {
    await message.reply("Usage: !summary <macro|kor|ex|coin> [thread_id]");
    return;
  }

  const scope = scopeRaw.toLowerCase() as MarketScope;
  if (!["macro", "kor", "ex", "coin"].includes(scope)) {
    await message.reply("scope must be one of: macro, kor, ex, coin");
    return;
  }

  const thread = await resolveThreadForSummary(client, message, threadId);
  if (!thread) {
    await message.reply("Target thread not found. Run inside a thread or pass thread_id.");
    return;
  }

  const checkpoint = await getSummaryCheckpoint(scope, thread.id);
  const lines = await collectThreadMessagesSinceCheckpoint(
    thread,
    checkpoint?.checkpoint_created_at ? new Date(checkpoint.checkpoint_created_at) : undefined
  );

  if (lines.length === 0) {
    await message.reply("No new messages to summarize.");
    return;
  }

  const rows = await buildMacroSummaryRows({
    scope,
    threadId: thread.id,
    lines
  });

  const summaryChannel = await client.channels.fetch(summaryChannelIdByScope(scope));
  if (!summaryChannel || summaryChannel.type !== ChannelType.GuildText) {
    await message.reply("Summary channel config is invalid.");
    return;
  }

  const table = formatTimelineTable(rows);
  const summaryMessage = await (summaryChannel as TextChannel).send(
    `## ${scope.toUpperCase()} Summary\nThread: ${thread.id}\n\n${table}`
  );

  await upsertSummaryCheckpoint({
    scope,
    discord_thread_id: thread.id,
    checkpoint_message_id: summaryMessage.id,
    checkpoint_created_at: new Date()
  });

  await insertAuditLog({
    event_type: "summary_generated",
    guild_id: message.guildId ?? "unknown",
    actor_user_id: message.author.id,
    details: {
      scope,
      thread_id: thread.id,
      line_count: lines.length,
      source: "text_command"
    }
  });

  await message.reply(`Summary generated. message_id=${summaryMessage.id}`);
}

async function handleRolloverCommand(client: Client, message: Message, args: string[]): Promise<void> {
  const [threadId] = args;
  if (!threadId) {
    await message.reply("Usage: !rollover <thread_id>");
    return;
  }

  const target = await client.channels.fetch(threadId);
  if (!target || !target.isThread()) {
    await message.reply("Invalid thread_id.");
    return;
  }

  const thread = target as ThreadChannel;
  const parent = thread.parent;
  if (!parent || parent.type !== ChannelType.GuildForum) {
    await message.reply("Rollover only supports forum threads.");
    return;
  }

  const lines = await collectThreadMessagesSinceCheckpoint(thread);
  const sliced = lines.slice(-config.ROLLOVER_MESSAGE_THRESHOLD).join("\n");
  const scope = scopeByForumChannelId(parent.id);

  const discussion = await startDiscussion({
    market: scope,
    ticker: "N/A",
    thread_id: thread.id,
    mode: "rollover",
    system_rules: [
      "Compress the key facts, decisions, and risks without losing context.",
      "Do not use praise or filler."
    ]
  });

  const compressed = await discussionTurn(discussion.discussion_id, {
    prompt: "Write compressed context for a new thread.",
    context: sliced
  });

  const newThread = (await (parent as ForumChannel).threads.create({
    name: `${thread.name} | rollover ${new Date().toLocaleDateString("ko-KR")}`,
    message: {
      content: `### Compressed Context\n${compressed.content}\n\nOriginal thread: ${thread.id}`
    },
    autoArchiveDuration: 10080
  })) as ThreadChannel;

  await upsertThreadState({
    scope,
    discord_thread_id: newThread.id,
    discord_parent_channel_id: parent.id,
    linked_previous_thread_id: thread.id,
    openclaw_discussion_id: discussion.discussion_id
  });

  await insertAuditLog({
    event_type: "thread_rollover",
    guild_id: message.guildId ?? "unknown",
    actor_user_id: message.author.id,
    details: {
      old_thread: thread.id,
      new_thread: newThread.id,
      copied_messages: lines.length,
      source: "text_command"
    }
  });

  await message.reply(`Rollover complete. new_thread=${newThread.id}`);
}

async function handleStatusCommand(message: Message): Promise<void> {
  const statusText =
    `openclaw_transport: ${config.OPENCLAW_TRANSPORT}\n` +
    `running_analysis_jobs(in-memory): ${runningAnalysis.size}\n` +
    `active_analysis_jobs: ${activeAnalysisJobs}\n` +
    `max_concurrency: ${config.ANALYSIS_MAX_CONCURRENCY}\n` +
    `command_cooldown_sec: ${config.ANALYSIS_COMMAND_COOLDOWN_SEC}\n` +
    `turn_delay_ms: ${config.ANALYSIS_TURN_DELAY_MS}\n` +
    `retry_attempts: ${config.OPENCLAW_RETRY_ATTEMPTS}\n` +
    `rollover_threshold: ${config.ROLLOVER_MESSAGE_THRESHOLD}\n` +
    `openclaw_timeout_ms: ${config.OPENCLAW_TIMEOUT_MS}`;

  await message.reply("```txt\n" + statusText + "\n```");
}

async function handleHelpCommand(message: Message): Promise<void> {
  await message.reply(
    [
      "Text commands:",
      "!analyze <kor|ex|coin> <ticker>",
      "!summary <macro|kor|ex|coin> [thread_id]",
      "!rollover <thread_id>",
      "!status",
      "!help"
    ].join("\n")
  );
}

export async function handleTextCommandMessage(client: Client, message: Message): Promise<boolean> {
  const parsed = parseTextCommand(message.content);
  if (!parsed) return false;

  if (!isAdminMessage(message)) {
    await message.reply("Admin role is required for bot commands.");
    return true;
  }

  if (parsed.name === "analyze") {
    await handleAnalyzeCommand(client, message, parsed.args);
    return true;
  }

  if (parsed.name === "summary") {
    await handleSummaryCommand(client, message, parsed.args);
    return true;
  }

  if (parsed.name === "rollover") {
    await handleRolloverCommand(client, message, parsed.args);
    return true;
  }

  if (parsed.name === "status") {
    await handleStatusCommand(message);
    return true;
  }

  if (parsed.name === "help") {
    await handleHelpCommand(message);
    return true;
  }

  await message.reply("Unknown command. Use !help.");
  return true;
}


