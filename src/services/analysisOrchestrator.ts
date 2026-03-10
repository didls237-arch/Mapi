import { ChannelType, ForumChannel, TextChannel, ThreadChannel } from "discord.js";
import { config } from "../config.js";
import { TURN_COUNT, personaForTurn, phaseForTurn } from "../constants.js";
import {
  countRunningJobs,
  markAnalysisJobCompleted,
  markAnalysisJobFailed,
  updateAnalysisJobProgress,
  upsertAnalysisJob
} from "../repositories/analysisJobRepository.js";
import {
  getLastTurnNumber,
  getThreadTurns,
  insertAuditLog,
  insertFinalReport,
  insertTurnMessage,
  upsertThreadState
} from "../repositories/stateRepository.js";
import { AnalysisMarket } from "../types.js";
import { finalReport, discussionTurn, startDiscussion } from "./openclawClient.js";
import { buildReportPng } from "./reportRenderer.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function systemRules(): string[] {
  return [
    "적어도 2개 이상의 출처로 교차 검증 후 분석하라.",
    "사용자 친화 칭찬 문구(좋은 질문입니다, 완벽합니다 등)를 금지한다.",
    "턴 단계 정의를 준수하라: 1~5 탐색, 6~10 검증/반박, 11~15 수렴/합의."
  ];
}

function safeContent(text: string): string {
  if (text.length <= 1850) return text;
  return `${text.slice(0, 1840)}\n... (truncated)`;
}

async function executeTurns(input: {
  actorUserId: string;
  guildId: string;
  market: AnalysisMarket;
  ticker: string;
  thread: ThreadChannel;
  discussionId: string;
  summaryChannel: TextChannel;
  startTurn: number;
}): Promise<{ thread: ThreadChannel; finalMessageId: string }> {
  for (let turn = input.startTurn; turn <= TURN_COUNT; turn += 1) {
    const persona = personaForTurn(turn);
    const phase = phaseForTurn(turn);

    let turnContent = "";
    try {
      const turnResult = await discussionTurn(input.discussionId, {
        turn_number: turn,
        persona,
        phase,
        prompt:
          `${input.market.toUpperCase()} ${input.ticker.toUpperCase()} 분석 ${turn}/${TURN_COUNT}. ` +
          `페르소나 역할에 맞는 주장과 반박 사인을 제시하라.`,
        context:
          "옵션 트레이더는 v1에서 옵션체인 심화 데이터 없이 가격/거래량/뉴스 기반으로 판단한다."
      });
      turnContent = turnResult.content;
    } catch (error) {
      if (!config.ANALYSIS_SKIP_FAILED_TURN) {
        throw error;
      }

      turnContent =
        `[TURN ${turn} 실패: 모델 응답 오류]\n` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        "다음 턴으로 진행합니다.";

      await insertAuditLog({
        event_type: "analysis_turn_failed",
        guild_id: input.guildId,
        actor_user_id: input.actorUserId,
        details: {
          market: input.market,
          ticker: input.ticker,
          thread_id: input.thread.id,
          turn,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }

    const message = await input.thread.send(
      `**${persona}**\n\n` +
        `${safeContent(turnContent)}\n\n` +
        `Turn ${turn}/${TURN_COUNT} | ${phase} | ${input.ticker.toUpperCase()} | ${new Date().toLocaleString("ko-KR")}`
    );

    await insertTurnMessage({
      market: input.market,
      ticker: input.ticker.toUpperCase(),
      discord_thread_id: input.thread.id,
      discord_message_id: message.id,
      turn_number: turn,
      persona,
      phase,
      content: turnContent
    });

    await updateAnalysisJobProgress({
      discord_thread_id: input.thread.id,
      next_turn: turn + 1
    });

    if (turn < TURN_COUNT && config.ANALYSIS_TURN_DELAY_MS > 0) {
      await sleep(config.ANALYSIS_TURN_DELAY_MS);
    }
  }

  const turns = await getThreadTurns(input.thread.id);
  const report = await finalReport({
    market: input.market,
    ticker: input.ticker.toUpperCase(),
    thread_id: input.thread.id,
    turns
  });

  const png = buildReportPng({
    ticker: input.ticker.toUpperCase(),
    marketLabel: input.market.toUpperCase(),
    report
  });

  const reportMessage = await input.summaryChannel.send({
    content:
      `최종분석 보고서 | ${input.market.toUpperCase()} ${input.ticker.toUpperCase()}\n` +
      `판정: **${report.verdict}** (신뢰도 ${report.confidence})`,
    files: [
      {
        attachment: png,
        name: `final-report-${input.market}-${input.ticker.toUpperCase()}-${report.report_id}.png`
      }
    ]
  });

  await insertFinalReport({
    scope: input.market,
    market: input.market,
    ticker: input.ticker.toUpperCase(),
    discord_thread_id: input.thread.id,
    discord_summary_channel_id: input.summaryChannel.id,
    discord_message_id: reportMessage.id,
    report_id: report.report_id,
    verdict: report.verdict,
    confidence: report.confidence,
    consensus: report.consensus,
    sources: report.sources
  });

  await markAnalysisJobCompleted(input.thread.id);

  await insertAuditLog({
    event_type: "analysis_completed",
    guild_id: input.guildId,
    actor_user_id: input.actorUserId,
    details: {
      market: input.market,
      ticker: input.ticker.toUpperCase(),
      thread_id: input.thread.id,
      report_id: report.report_id
    }
  });

  return { thread: input.thread, finalMessageId: reportMessage.id };
}

export async function runAnalysisFlow(input: {
  actorUserId: string;
  guildId: string;
  market: AnalysisMarket;
  ticker: string;
  forum: ForumChannel;
  summaryChannel: TextChannel;
}): Promise<{ thread: ThreadChannel; finalMessageId: string }> {
  const runningCount = await countRunningJobs(input.guildId);
  if (runningCount >= config.ANALYSIS_MAX_CONCURRENCY) {
    throw new Error(`동시 분석 한도(${config.ANALYSIS_MAX_CONCURRENCY})를 초과했습니다.`);
  }

  const starter = await input.forum.threads.create({
    name: `${input.ticker.toUpperCase()} | ${new Date().toLocaleDateString("ko-KR")}`,
    message: {
      content:
        `분석 시작: ${input.market.toUpperCase()} ${input.ticker.toUpperCase()}\n` +
        `총 ${TURN_COUNT}턴 자동 진행`
    },
    autoArchiveDuration: 10080
  });

  const thread = starter as ThreadChannel;

  const discussion = await startDiscussion({
    market: input.market,
    ticker: input.ticker.toUpperCase(),
    thread_id: thread.id,
    mode: "analysis",
    system_rules: systemRules()
  });

  await upsertThreadState({
    scope: input.market,
    discord_thread_id: thread.id,
    discord_parent_channel_id: input.forum.id,
    openclaw_discussion_id: discussion.discussion_id
  });

  await upsertAnalysisJob({
    guild_id: input.guildId,
    scope: input.market,
    ticker: input.ticker.toUpperCase(),
    discord_thread_id: thread.id,
    discord_forum_channel_id: input.forum.id,
    discord_summary_channel_id: input.summaryChannel.id,
    openclaw_discussion_id: discussion.discussion_id,
    actor_user_id: input.actorUserId,
    next_turn: 1,
    status: "running"
  });

  try {
    return await executeTurns({
      actorUserId: input.actorUserId,
      guildId: input.guildId,
      market: input.market,
      ticker: input.ticker,
      thread,
      discussionId: discussion.discussion_id,
      summaryChannel: input.summaryChannel,
      startTurn: 1
    });
  } catch (error) {
    await markAnalysisJobFailed({
      discord_thread_id: thread.id,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export async function resumeAnalysisFlow(input: {
  actorUserId: string;
  guildId: string;
  market: AnalysisMarket;
  ticker: string;
  thread: ThreadChannel;
  summaryChannel: TextChannel;
  discussionId: string;
  nextTurnFromJob: number;
}): Promise<{ thread: ThreadChannel; finalMessageId: string }> {
  const lastTurn = await getLastTurnNumber(input.thread.id);
  const startTurn = Math.max(input.nextTurnFromJob, lastTurn + 1);

  if (startTurn > TURN_COUNT) {
    throw new Error("재개할 턴이 없습니다.");
  }

  await upsertAnalysisJob({
    guild_id: input.guildId,
    scope: input.market,
    ticker: input.ticker.toUpperCase(),
    discord_thread_id: input.thread.id,
    discord_forum_channel_id: input.thread.parentId ?? marketForumId(input.market),
    discord_summary_channel_id: input.summaryChannel.id,
    openclaw_discussion_id: input.discussionId,
    actor_user_id: input.actorUserId,
    next_turn: startTurn,
    status: "running"
  });

  try {
    return await executeTurns({
      actorUserId: input.actorUserId,
      guildId: input.guildId,
      market: input.market,
      ticker: input.ticker,
      thread: input.thread,
      discussionId: input.discussionId,
      summaryChannel: input.summaryChannel,
      startTurn
    });
  } catch (error) {
    await markAnalysisJobFailed({
      discord_thread_id: input.thread.id,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export function marketForumId(market: AnalysisMarket): string {
  if (market === "kor") return config.KOR_FORUM_CHANNEL_ID;
  if (market === "ex") return config.EX_FORUM_CHANNEL_ID;
  return config.COIN_FORUM_CHANNEL_ID;
}

export function marketSummaryChannelId(market: AnalysisMarket): string {
  if (market === "kor") return config.KOR_SUMMARY_CHANNEL_ID;
  if (market === "ex") return config.EX_SUMMARY_CHANNEL_ID;
  return config.COIN_SUMMARY_CHANNEL_ID;
}

export function marketByForumChannelId(channelId: string): AnalysisMarket | null {
  if (channelId === config.KOR_FORUM_CHANNEL_ID) return "kor";
  if (channelId === config.EX_FORUM_CHANNEL_ID) return "ex";
  if (channelId === config.COIN_FORUM_CHANNEL_ID) return "coin";
  return null;
}

export function marketBySummaryChannelId(channelId: string): AnalysisMarket | null {
  if (channelId === config.KOR_SUMMARY_CHANNEL_ID) return "kor";
  if (channelId === config.EX_SUMMARY_CHANNEL_ID) return "ex";
  if (channelId === config.COIN_SUMMARY_CHANNEL_ID) return "coin";
  return null;
}

export function isAnalysisForumChannelId(channelId: string): boolean {
  return marketByForumChannelId(channelId) !== null;
}

export function isAnalysisSummaryChannelId(channelId: string): boolean {
  return marketBySummaryChannelId(channelId) !== null;
}
