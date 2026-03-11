import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  TextChannel,
  ThreadChannel
} from "discord.js";
import { config } from "../config.js";
import {
  countRunningJobs,
  findRunningJobByTicker,
  listResumableJobs,
  markAnalysisJobFailed
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
  resumeAnalysisFlow,
  runAnalysisFlow
} from "../services/analysisOrchestrator.js";
import { discussionTurn, startDiscussion } from "../services/openclawClient.js";
import {
  buildMacroSummaryRows,
  collectThreadMessagesSinceCheckpoint,
  formatTimelineTable
} from "../services/summaryService.js";
import { AnalysisMarket, MarketScope } from "../types.js";
import { ensureAdmin } from "./permission.js";

const runningAnalysis = new Set<string>();
const analyzeCooldownByUser = new Map<string, number>();
let activeAnalysisJobs = 0;

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

async function resolveThreadForSummary(
  client: Client,
  interaction: ChatInputCommandInteraction,
  providedThreadId?: string
): Promise<ThreadChannel | null> {
  if (providedThreadId) {
    const channel = await client.channels.fetch(providedThreadId);
    if (!channel || !channel.isThread()) return null;
    return channel as ThreadChannel;
  }

  if (interaction.channel && interaction.channel.isThread()) {
    return interaction.channel as ThreadChannel;
  }

  return null;
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

function isTickerValid(ticker: string): boolean {
  return /^[A-Z0-9._:/-]{1,20}$/.test(ticker);
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
  forum: TextChannel;
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
          notification: notifyResult
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

export async function handleAnalyze(
  client: Client,
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!ensureAdmin(interaction)) {
    await interaction.reply({ content: "Admin only.", ephemeral: true });
    return;
  }

  const cooldown = isInCooldown(interaction.user.id);
  if (cooldown.blocked) {
    await interaction.reply({
      content: `Cooldown active. Retry in ${cooldown.leftSec}s.`,
      ephemeral: true
    });
    return;
  }

  const market = interaction.options.getString("market", true) as AnalysisMarket;
  const ticker = interaction.options.getString("ticker", true).trim().toUpperCase();

  if (!isTickerValid(ticker)) {
    await interaction.reply({
      content: "Ticker format is invalid. Allowed: A-Z, 0-9, . _ : / - (max 20 chars)",
      ephemeral: true
    });
    return;
  }

  const lockKey = `${interaction.guildId}:${market}:${ticker}`;
  if (runningAnalysis.has(lockKey)) {
    await interaction.reply({ content: "This ticker is already being analyzed.", ephemeral: true });
    return;
  }

  if (activeAnalysisJobs >= config.ANALYSIS_MAX_CONCURRENCY) {
    await interaction.reply({
      content: `Max concurrency reached (${config.ANALYSIS_MAX_CONCURRENCY}). Try again later.`,
      ephemeral: true
    });
    return;
  }

  const runningDb = await countRunningJobs(interaction.guildId ?? "unknown");
  if (runningDb >= config.ANALYSIS_MAX_CONCURRENCY) {
    await interaction.reply({
      content: `DB concurrency limit reached (${config.ANALYSIS_MAX_CONCURRENCY}).`,
      ephemeral: true
    });
    return;
  }

  const existingJob = await findRunningJobByTicker({
    guild_id: interaction.guildId ?? "unknown",
    scope: market,
    ticker
  });
  if (existingJob) {
    await interaction.reply({
      content: `A running job already exists. thread_id=${existingJob.discord_thread_id}`,
      ephemeral: true
    });
    return;
  }

  const forum = await client.channels.fetch(marketForumId(market));
  const summaryChannel = await client.channels.fetch(marketSummaryChannelId(market));

  if (!forum || forum.type !== ChannelType.GuildText || !summaryChannel || summaryChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "Analysis/Summary channel config is invalid.",
      ephemeral: true
    });
    return;
  }

  touchCooldown(interaction.user.id);

  await interaction.reply({
    content: `${market.toUpperCase()} ${ticker} analysis started. Results will be posted to summary.`,
    ephemeral: true
  });

  void runAnalysisInBackground({
    client,
    lockKey,
    actorUserId: interaction.user.id,
    guildId: interaction.guildId ?? "unknown",
    market,
    ticker,
    forum: forum as TextChannel,
    summaryChannel: summaryChannel as TextChannel
  });
}

export async function handleSummary(
  client: Client,
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!ensureAdmin(interaction)) {
    await interaction.reply({ content: "Admin only.", ephemeral: true });
    return;
  }

  const scope = interaction.options.getString("scope", true) as MarketScope;
  const providedThreadId = interaction.options.getString("thread_id") ?? undefined;
  const thread = await resolveThreadForSummary(client, interaction, providedThreadId);

  if (!thread) {
    await interaction.reply({
      content: "Target thread not found. Run inside a thread or pass thread_id.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const checkpoint = await getSummaryCheckpoint(scope, thread.id);
  const lines = await collectThreadMessagesSinceCheckpoint(
    thread,
    checkpoint?.checkpoint_created_at ? new Date(checkpoint.checkpoint_created_at) : undefined
  );

  if (lines.length === 0) {
    await interaction.editReply("No new messages to summarize.");
    return;
  }

  const rows = await buildMacroSummaryRows({ scope, threadId: thread.id, lines });
  const table = formatTimelineTable(rows);
  const summaryCh = await client.channels.fetch(summaryChannelIdByScope(scope));

  if (!summaryCh || summaryCh.type !== ChannelType.GuildText) {
    await interaction.editReply("Summary channel config is invalid.");
    return;
  }

  const msg = await (summaryCh as TextChannel).send(
    `## ${scope.toUpperCase()} Summary\nThread: ${thread.id}\n\n${table}`
  );

  await upsertSummaryCheckpoint({
    scope,
    discord_thread_id: thread.id,
    checkpoint_message_id: msg.id,
    checkpoint_created_at: new Date()
  });

  await insertAuditLog({
    event_type: "summary_generated",
    guild_id: interaction.guildId ?? "unknown",
    actor_user_id: interaction.user.id,
    details: {
      scope,
      thread_id: thread.id,
      line_count: lines.length
    }
  });

  await interaction.editReply(`Summary generated. message_id=${msg.id}`);
}

export async function handleRollover(
  client: Client,
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!ensureAdmin(interaction)) {
    await interaction.reply({ content: "Admin only.", ephemeral: true });
    return;
  }

  const threadId = interaction.options.getString("thread_id", true);
  const target = await client.channels.fetch(threadId);
  if (!target || !target.isThread()) {
    await interaction.reply({ content: "Invalid thread_id.", ephemeral: true });
    return;
  }

  const thread = target as ThreadChannel;
  const parent = thread.parent;
  if (!parent || parent.type !== ChannelType.GuildText) {
    await interaction.reply({ content: "Rollover supports only text-channel threads.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

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

  const starterMessage = await (parent as TextChannel).send(
    `### Compressed Context\n${compressed.content}\n\nOriginal thread: ${thread.id}`
  );
  const newThread = (await starterMessage.startThread({
    name: `${thread.name} | rollover ${new Date().toLocaleDateString("ko-KR")}`,
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
    guild_id: interaction.guildId ?? "unknown",
    actor_user_id: interaction.user.id,
    details: {
      old_thread: thread.id,
      new_thread: newThread.id,
      copied_messages: lines.length
    }
  });

  await interaction.editReply(`Rollover complete. new_thread=${newThread.id}`);
}

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const message =
    `openclaw_transport: ${config.OPENCLAW_TRANSPORT}\n` +
    `running_analysis_jobs(in-memory): ${runningAnalysis.size}\n` +
    `active_analysis_jobs: ${activeAnalysisJobs}\n` +
    `max_concurrency: ${config.ANALYSIS_MAX_CONCURRENCY}\n` +
    `command_cooldown_sec: ${config.ANALYSIS_COMMAND_COOLDOWN_SEC}\n` +
    `turn_delay_ms: ${config.ANALYSIS_TURN_DELAY_MS}\n` +
    `retry_attempts: ${config.OPENCLAW_RETRY_ATTEMPTS}\n` +
    `rollover_threshold: ${config.ROLLOVER_MESSAGE_THRESHOLD}\n` +
    `openclaw_timeout_ms: ${config.OPENCLAW_TIMEOUT_MS}`;

  await interaction.reply({ content: "```txt\n" + message + "\n```", ephemeral: true });
}

export async function resumePendingAnalysisJobs(client: Client): Promise<void> {
  if (!config.ANALYSIS_RESUME_ON_START) {
    return;
  }

  const jobs = await listResumableJobs(config.DISCORD_GUILD_ID);
  if (jobs.length === 0) {
    return;
  }

  for (const job of jobs) {
    if (activeAnalysisJobs >= config.ANALYSIS_MAX_CONCURRENCY) {
      break;
    }

    const threadChannel = await client.channels.fetch(job.discord_thread_id).catch(() => null);
    const summaryChannel = await client.channels.fetch(job.discord_summary_channel_id).catch(() => null);

    if (!threadChannel || !threadChannel.isThread() || !summaryChannel || summaryChannel.type !== ChannelType.GuildText) {
      await markAnalysisJobFailed({
        discord_thread_id: job.discord_thread_id,
        error: "Resume failed: thread or summary channel missing"
      });
      continue;
    }

    const lockKey = `${job.guild_id}:${job.scope}:${job.ticker}`;
    if (runningAnalysis.has(lockKey)) {
      continue;
    }

    activeAnalysisJobs += 1;
    runningAnalysis.add(lockKey);

    void resumeAnalysisFlow({
      actorUserId: job.actor_user_id,
      guildId: job.guild_id,
      market: job.scope,
      ticker: job.ticker,
      thread: threadChannel as ThreadChannel,
      summaryChannel: summaryChannel as TextChannel,
      discussionId: job.openclaw_discussion_id,
      nextTurnFromJob: job.next_turn
    })
      .catch(async (error) => {
        const errorText = error instanceof Error ? error.message : String(error);

        await markAnalysisJobFailed({
          discord_thread_id: job.discord_thread_id,
          error: errorText
        });

        await notifyAnalysisFailure({
          client,
          summaryChannel: summaryChannel as TextChannel,
          actorUserId: job.actor_user_id,
          market: job.scope,
          ticker: job.ticker,
          errorText: `Resume failed: ${errorText}`
        });
      })
      .finally(() => {
        runningAnalysis.delete(lockKey);
        activeAnalysisJobs = Math.max(0, activeAnalysisJobs - 1);
      });
  }
}
