import { ThreadChannel } from "discord.js";
import { config } from "../config.js";
import { riskIcon } from "../constants.js";
import { MarketScope, TimelineRow } from "../types.js";
import { discussionTurn, startDiscussion } from "./openclawClient.js";

interface CollectedMessage {
  id: string;
  ts: number;
  line: string;
}

export function formatTimelineTable(rows: TimelineRow[]): string {
  const header = [
    "| 요약 일자 | 기존 시나리오 타임라인 | 변경 시나리오 타임라인 | 위험도 |",
    "|---|---|---|---|"
  ];

  const body = rows.map((row) => {
    const risk = Math.max(1, Math.min(5, row.risk));
    return `| ${row.date} | ${row.previous_timeline} | ${row.changed_timeline} | ${riskIcon(risk)} **${risk}** |`;
  });

  return [...header, ...body].join("\n");
}

function extractJsonArray(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    const inner = fenceMatch[1].trim();
    if (inner.startsWith("[") && inner.endsWith("]")) {
      return inner;
    }
  }

  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1);
  }

  return null;
}

function parseTimelineRows(text: string): TimelineRow[] {
  const json = extractJsonArray(text);
  if (!json) return [];

  const parsed = JSON.parse(json) as TimelineRow[];
  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  return parsed
    .filter((item) => item && item.date && item.previous_timeline && item.changed_timeline)
    .map((item) => ({
      date: String(item.date),
      previous_timeline: String(item.previous_timeline),
      changed_timeline: String(item.changed_timeline),
      risk: Math.max(1, Math.min(5, Number(item.risk || 3)))
    }));
}

export async function collectThreadMessagesSinceCheckpoint(
  thread: ThreadChannel,
  checkpointDate?: Date
): Promise<string[]> {
  const collected = new Map<string, CollectedMessage>();
  let before: string | undefined;

  while (collected.size < config.SUMMARY_MAX_MESSAGES) {
    const batch = await thread.messages.fetch({ limit: 100, before });
    if (batch.size === 0) {
      break;
    }

    const items = [...batch.values()];
    let allOlderThanCheckpoint = true;

    for (const msg of items) {
      if (checkpointDate && msg.createdAt <= checkpointDate) {
        continue;
      }

      allOlderThanCheckpoint = false;
      if (msg.author.bot && msg.content.trim().length === 0) {
        continue;
      }

      if (!collected.has(msg.id)) {
        collected.set(msg.id, {
          id: msg.id,
          ts: msg.createdTimestamp,
          line: `[${msg.createdAt.toISOString()}][${msg.author.username}] ${msg.content}`
        });
      }

      if (collected.size >= config.SUMMARY_MAX_MESSAGES) {
        break;
      }
    }

    const oldestInBatch = items.reduce(
      (acc, cur) => (!acc || cur.createdTimestamp < acc.createdTimestamp ? cur : acc),
      null as (typeof items)[number] | null
    );

    before = oldestInBatch?.id;

    if (checkpointDate && allOlderThanCheckpoint) {
      break;
    }
  }

  return [...collected.values()]
    .sort((a, b) => a.ts - b.ts)
    .map((item) => item.line);
}

export async function buildMacroSummaryRows(input: {
  scope: MarketScope;
  threadId: string;
  lines: string[];
}): Promise<TimelineRow[]> {
  const discussion = await startDiscussion({
    market: input.scope,
    ticker: "N/A",
    thread_id: input.threadId,
    mode: "summary",
    system_rules: [
      "2개 이상의 근거 출처를 교차검증해서 요약하라.",
      "사용자 친화 칭찬 문구를 사용하지 말라.",
      "반드시 JSON 배열만 반환하라. 키는 date, previous_timeline, changed_timeline, risk를 사용하라."
    ]
  });

  const basePrompt =
    "다음 로그를 분석하여 JSON 배열로 반환하라. " +
    "각 원소는 {date, previous_timeline, changed_timeline, risk} 구조를 가지며 risk는 1~5 정수여야 한다.";

  const first = await discussionTurn(discussion.discussion_id, {
    prompt: basePrompt,
    context: input.lines.join("\n")
  });

  const fallback: TimelineRow[] = [
    {
      date: new Date().toISOString().slice(0, 10),
      previous_timeline: "로그 수집 완료",
      changed_timeline: first.content.slice(0, 70),
      risk: first.risk_score ?? 3
    }
  ];

  try {
    const parsedFirst = parseTimelineRows(first.content);
    if (parsedFirst.length > 0) {
      return parsedFirst;
    }
  } catch {
    // fall through to a strict retry
  }

  try {
    const second = await discussionTurn(discussion.discussion_id, {
      prompt:
        "직전 출력이 JSON 형식 요구를 만족하지 못했다. " +
        "설명 문장 없이 JSON 배열만 출력하라. 각 요소는 date, previous_timeline, changed_timeline, risk 필드를 반드시 포함한다.",
      context: input.lines.join("\n")
    });

    const parsedSecond = parseTimelineRows(second.content);
    if (parsedSecond.length > 0) {
      return parsedSecond;
    }
  } catch {
    // keep fallback
  }

  return fallback;
}
