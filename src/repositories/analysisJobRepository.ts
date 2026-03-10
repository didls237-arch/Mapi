import { TURN_COUNT } from "../constants.js";
import { query } from "../db.js";
import { AnalysisJobRecord, AnalysisMarket } from "../types.js";

export async function upsertAnalysisJob(input: {
  guild_id: string;
  scope: AnalysisMarket;
  ticker: string;
  discord_thread_id: string;
  discord_forum_channel_id: string;
  discord_summary_channel_id: string;
  openclaw_discussion_id: string;
  actor_user_id: string;
  next_turn: number;
  status: "running" | "completed" | "failed";
  last_error?: string | null;
}): Promise<void> {
  await query(
    `
    INSERT INTO analysis_jobs (
      guild_id, scope, ticker, discord_thread_id, discord_forum_channel_id,
      discord_summary_channel_id, openclaw_discussion_id, next_turn, status,
      actor_user_id, last_error
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (discord_thread_id)
    DO UPDATE SET
      scope = EXCLUDED.scope,
      ticker = EXCLUDED.ticker,
      discord_forum_channel_id = EXCLUDED.discord_forum_channel_id,
      discord_summary_channel_id = EXCLUDED.discord_summary_channel_id,
      openclaw_discussion_id = EXCLUDED.openclaw_discussion_id,
      next_turn = EXCLUDED.next_turn,
      status = EXCLUDED.status,
      actor_user_id = EXCLUDED.actor_user_id,
      last_error = EXCLUDED.last_error,
      updated_at = NOW()
    `,
    [
      input.guild_id,
      input.scope,
      input.ticker,
      input.discord_thread_id,
      input.discord_forum_channel_id,
      input.discord_summary_channel_id,
      input.openclaw_discussion_id,
      input.next_turn,
      input.status,
      input.actor_user_id,
      input.last_error ?? null
    ]
  );
}

export async function updateAnalysisJobProgress(input: {
  discord_thread_id: string;
  next_turn: number;
}): Promise<void> {
  await query(
    `
    UPDATE analysis_jobs
    SET next_turn = $2, status = 'running', last_error = NULL, updated_at = NOW()
    WHERE discord_thread_id = $1
    `,
    [input.discord_thread_id, input.next_turn]
  );
}

export async function markAnalysisJobCompleted(discordThreadId: string): Promise<void> {
  await query(
    `
    UPDATE analysis_jobs
    SET status = 'completed', next_turn = $2, last_error = NULL, updated_at = NOW()
    WHERE discord_thread_id = $1
    `,
    [discordThreadId, TURN_COUNT + 1]
  );
}

export async function markAnalysisJobFailed(input: {
  discord_thread_id: string;
  error: string;
}): Promise<void> {
  await query(
    `
    UPDATE analysis_jobs
    SET status = 'failed', last_error = $2, updated_at = NOW()
    WHERE discord_thread_id = $1
    `,
    [input.discord_thread_id, input.error]
  );
}

export async function findRunningJobByTicker(input: {
  guild_id: string;
  scope: AnalysisMarket;
  ticker: string;
}): Promise<AnalysisJobRecord | null> {
  const rows = await query<AnalysisJobRecord>(
    `
    SELECT guild_id, scope, ticker, discord_thread_id, discord_forum_channel_id,
           discord_summary_channel_id, openclaw_discussion_id, next_turn, status,
           actor_user_id, last_error
    FROM analysis_jobs
    WHERE guild_id = $1 AND scope = $2 AND ticker = $3 AND status = 'running'
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [input.guild_id, input.scope, input.ticker]
  );

  return rows[0] ?? null;
}

export async function countRunningJobs(guildId: string): Promise<number> {
  const rows = await query<{ cnt: string }>(
    `
    SELECT COUNT(*)::text AS cnt
    FROM analysis_jobs
    WHERE guild_id = $1 AND status = 'running'
    `,
    [guildId]
  );

  return Number(rows[0]?.cnt ?? "0");
}

export async function listResumableJobs(guildId: string): Promise<AnalysisJobRecord[]> {
  return query<AnalysisJobRecord>(
    `
    SELECT guild_id, scope, ticker, discord_thread_id, discord_forum_channel_id,
           discord_summary_channel_id, openclaw_discussion_id, next_turn, status,
           actor_user_id, last_error
    FROM analysis_jobs
    WHERE guild_id = $1
      AND status = 'running'
      AND next_turn <= $2
    ORDER BY updated_at ASC
    `,
    [guildId, TURN_COUNT]
  );
}