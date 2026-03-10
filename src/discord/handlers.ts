import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  ForumChannel,
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
    const ch = await client.channels.fetch(providedThreadId);
    if (!ch || !ch.isThread()) return null;
    return ch;
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
    `분석 작업 중 오류가 발생했습니다.\n` +
    `market=${input.market}, ticker=${input.ticker.toUpperCase()}\n` +
    `오류: ${input.errorText}`;

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
        `[Discord AI Analysis Bot] ${input.market.toUpperCase()} ${input.ticker.toUpperCase()} 분석 실패\n` +
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
    await interaction.reply({
      content: "관리자만 실행할 수 있습니다.",
      ephemeral: true
    });
    return;
  }

  const cooldown = isInCooldown(interaction.user.id);
  if (cooldown.blocked) {
    await interaction.reply({
      content: `명령 쿨다운 중입니다. ${cooldown.leftSec}초 후 다시 시도하세요.`,
      ephemeral: true
    });
    return;
  }

  const market = interaction.options.getString("market", true) as AnalysisMarket;
  const ticker = interaction.options.getString("ticker", true).trim().toUpperCase();

  if (!isTickerValid(ticker)) {
    await interaction.reply({
      content: "티커 형식이 올바르지 않습니다. (허용: A-Z, 0-9, . _ : / - , 최대 20자)",
      ephemeral: true
    });
    return;
  }

  const lockKey = `${interaction.guildId}:${market}:${ticker}`;
  if (runningAnalysis.has(lockKey)) {
    await interaction.reply({ content: "동일 티커 분석이 이미 진행 중입니다.", ephemeral: true });
    return;
  }

  if (activeAnalysisJobs >= config.ANALYSIS_MAX_CONCURRENCY) {
    await interaction.reply({
      content: `동시 분석 한도(${config.ANALYSIS_MAX_CONCURRENCY})에 도달했습니다. 잠시 후 다시 시도하세요.`,
      ephemeral: true
    });
    return;
  }

  const runningDb = await countRunningJobs(interaction.guildId ?? "unknown");
  if (runningDb >= config.ANALYSIS_MAX_CONCURRENCY) {
    await interaction.reply({
      content: `DB 기준 동시 분석 한도(${config.ANALYSIS_MAX_CONCURRENCY})에 도달했습니다.`,
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
      content: `이미 실행 중인 작업이 있습니다. thread_id=${existingJob.discord_thread_id}`,
      ephemeral: true
    });
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
    await interaction.reply({
      content: "채널 설정이 올바르지 않습니다. .env의 FORUM/SUMMARY 채널 ID를 확인하세요.",
      ephemeral: true
    });
    return;
  }

  touchCooldown(interaction.user.id);

  await interaction.reply({
    content:
      `${market.toUpperCase()} ${ticker} 분석을 시작했습니다. ` +
      `백그라운드로 진행되며 완료 결과는 Summary 채널에 게시됩니다.`,
    ephemeral: true
  });

  void runAnalysisInBackground({
    client,
    lockKey,
    actorUserId: interaction.user.id,
    guildId: interaction.guildId ?? "unknown",
    market,
    ticker,
    forum: forum as ForumChannel,
    summaryChannel: summaryChannel as TextChannel
  });
}

export async function handleSummary(
  client: Client,
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!ensureAdmin(interaction)) {
    await interaction.reply({ content: "관리자만 실행할 수 있습니다.", ephemeral: true });
    return;
  }

  const scope = interaction.options.getString("scope", true) as MarketScope;
  const providedThreadId = interaction.options.getString("thread_id") ?? undefined;
  const thread = await resolveThreadForSummary(client, interaction, providedThreadId);

  if (!thread) {
    await interaction.reply({
      content: "대상 thread를 찾을 수 없습니다. thread_id를 지정하거나 thread 안에서 실행하세요.",
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
    await interaction.editReply("요약할 신규 메시지가 없습니다.");
    return;
  }

  const rows = await buildMacroSummaryRows({
    scope,
    threadId: thread.id,
    lines
  });

  const table = formatTimelineTable(rows);
  const summaryCh = await client.channels.fetch(summaryChannelIdByScope(scope));

  if (!summaryCh || summaryCh.type !== ChannelType.GuildText) {
    await interaction.editReply("요약 채널 설정이 올바르지 않습니다.");
    return;
  }

  const msg = await (summaryCh as TextChannel).send(
    `## ${scope.toUpperCase()} Summary\n` + `Thread: ${thread.id}\n\n` + table
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

  await interaction.editReply(`요약을 생성했습니다. 메시지 ID: ${msg.id}`);
}

export async function handleRollover(
  client: Client,
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!ensureAdmin(interaction)) {
    await interaction.reply({ content: "관리자만 실행할 수 있습니다.", ephemeral: true });
    return;
  }

  const threadId = interaction.options.getString("thread_id", true);
  const target = await client.channels.fetch(threadId);
  if (!target || !target.isThread()) {
    await interaction.reply({ content: "유효한 thread_id가 아닙니다.", ephemeral: true });
    return;
  }

  const thread = target as ThreadChannel;
  const parent = thread.parent;

  if (!parent || parent.type !== ChannelType.GuildForum) {
    await interaction.reply({ content: "포럼 스레드만 롤오버할 수 있습니다.", ephemeral: true });
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
      "기존 맥락을 잃지 않게 핵심 사실/결정/리스크를 압축하라.",
      "칭찬형 문구를 사용하지 말라."
    ]
  });

  const compressed = await discussionTurn(discussion.discussion_id, {
    prompt: "새 스레드 시작용 압축 컨텍스트를 작성하라.",
    context: sliced
  });

  const newThreadRaw = await (parent as ForumChannel).threads.create({
    name: `${thread.name} | rollover ${new Date().toLocaleDateString("ko-KR")}`,
    message: {
      content: "### 압축 컨텍스트\n" + `${compressed.content}\n\n` + `원본 thread: ${thread.id}`
    },
    autoArchiveDuration: 10080
  });

  const newThread = newThreadRaw as ThreadChannel;

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

  await interaction.editReply(`롤오버 완료: 새 thread ${newThread.id}`);
}

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const msg =
    `running_analysis_jobs(in-memory): ${runningAnalysis.size}\n` +
    `active_analysis_jobs: ${activeAnalysisJobs}\n` +
    `max_concurrency: ${config.ANALYSIS_MAX_CONCURRENCY}\n` +
    `command_cooldown_sec: ${config.ANALYSIS_COMMAND_COOLDOWN_SEC}\n` +
    `turn_delay_ms: ${config.ANALYSIS_TURN_DELAY_MS}\n` +
    `retry_attempts: ${config.OPENCLAW_RETRY_ATTEMPTS}\n` +
    `rollover_threshold: ${config.ROLLOVER_MESSAGE_THRESHOLD}\n` +
    `openclaw_timeout_ms: ${config.OPENCLAW_TIMEOUT_MS}`;

  await interaction.reply({ content: "```txt\n" + msg + "\n```", ephemeral: true });
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
        error: "복구 실패: 스레드 또는 summary 채널을 찾을 수 없음"
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
          errorText: `자동 복구 작업 실패: ${errorText}`
        });
      })
      .finally(() => {
        runningAnalysis.delete(lockKey);
        activeAnalysisJobs = Math.max(0, activeAnalysisJobs - 1);
      });
  }
}
