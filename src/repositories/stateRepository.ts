import { query } from "../db.js";
import { AnalysisMarket, MarketScope, Persona, TurnPhase } from "../types.js";

export async function upsertThreadState(input: {
  scope: MarketScope;
  discord_thread_id: string;
  discord_parent_channel_id: string;
  linked_previous_thread_id?: string | null;
  openclaw_discussion_id?: string | null;
}): Promise<void> {
  await query(
    `
    INSERT INTO threads (
      scope, discord_thread_id, discord_parent_channel_id, linked_previous_thread_id, openclaw_discussion_id
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (discord_thread_id)
    DO UPDATE SET
      scope = EXCLUDED.scope,
      discord_parent_channel_id = EXCLUDED.discord_parent_channel_id,
      linked_previous_thread_id = EXCLUDED.linked_previous_thread_id,
      openclaw_discussion_id = EXCLUDED.openclaw_discussion_id,
      updated_at = NOW()
    `,
    [
      input.scope,
      input.discord_thread_id,
      input.discord_parent_channel_id,
      input.linked_previous_thread_id ?? null,
      input.openclaw_discussion_id ?? null
    ]
  );
}

export async function getThreadState(discordThreadId: string): Promise<{
  scope: MarketScope;
  discord_thread_id: string;
  discord_parent_channel_id: string;
  linked_previous_thread_id: string | null;
  openclaw_discussion_id: string | null;
} | null> {
  const rows = await query<{
    scope: MarketScope;
    discord_thread_id: string;
    discord_parent_channel_id: string;
    linked_previous_thread_id: string | null;
    openclaw_discussion_id: string | null;
  }>(
    `
    SELECT scope, discord_thread_id, discord_parent_channel_id, linked_previous_thread_id, openclaw_discussion_id
    FROM threads
    WHERE discord_thread_id = $1
    LIMIT 1
    `,
    [discordThreadId]
  );

  return rows[0] ?? null;
}

export async function insertTurnMessage(input: {
  market: AnalysisMarket;
  ticker: string;
  discord_thread_id: string;
  discord_message_id: string;
  turn_number: number;
  persona: Persona;
  phase: TurnPhase;
  content: string;
}): Promise<void> {
  await query(
    `
    INSERT INTO turn_messages (
      market, ticker, discord_thread_id, discord_message_id, turn_number, persona, phase, content
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (discord_thread_id, turn_number)
    DO UPDATE SET
      discord_message_id = EXCLUDED.discord_message_id,
      persona = EXCLUDED.persona,
      phase = EXCLUDED.phase,
      content = EXCLUDED.content
    `,
    [
      input.market,
      input.ticker,
      input.discord_thread_id,
      input.discord_message_id,
      input.turn_number,
      input.persona,
      input.phase,
      input.content
    ]
  );
}

export async function getLastTurnNumber(discordThreadId: string): Promise<number> {
  const rows = await query<{ max_turn: number | null }>(
    `
    SELECT MAX(turn_number) AS max_turn
    FROM turn_messages
    WHERE discord_thread_id = $1
    `,
    [discordThreadId]
  );

  return rows[0]?.max_turn ?? 0;
}

export async function getThreadTurns(discordThreadId: string): Promise<
  Array<{
    turn_number: number;
    persona: Persona;
    phase: TurnPhase;
    content: string;
  }>
> {
  return query(
    `
    SELECT turn_number, persona, phase, content
    FROM turn_messages
    WHERE discord_thread_id = $1
    ORDER BY turn_number ASC
    `,
    [discordThreadId]
  );
}

export async function upsertSummaryCheckpoint(input: {
  scope: MarketScope;
  discord_thread_id: string;
  checkpoint_message_id: string;
  checkpoint_created_at: Date;
}): Promise<void> {
  await query(
    `
    INSERT INTO summary_checkpoints (
      scope, discord_thread_id, checkpoint_message_id, checkpoint_created_at
    )
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (scope, discord_thread_id)
    DO UPDATE SET
      checkpoint_message_id = EXCLUDED.checkpoint_message_id,
      checkpoint_created_at = EXCLUDED.checkpoint_created_at,
      updated_at = NOW()
    `,
    [
      input.scope,
      input.discord_thread_id,
      input.checkpoint_message_id,
      input.checkpoint_created_at.toISOString()
    ]
  );
}

export async function getSummaryCheckpoint(scope: MarketScope, discordThreadId: string): Promise<{
  checkpoint_message_id: string;
  checkpoint_created_at: Date;
} | null> {
  const rows = await query<{
    checkpoint_message_id: string;
    checkpoint_created_at: Date;
  }>(
    `
    SELECT checkpoint_message_id, checkpoint_created_at
    FROM summary_checkpoints
    WHERE scope = $1 AND discord_thread_id = $2
    LIMIT 1
    `,
    [scope, discordThreadId]
  );

  return rows[0] ?? null;
}

export async function insertFinalReport(input: {
  scope: MarketScope;
  market: AnalysisMarket;
  ticker: string;
  discord_thread_id: string;
  discord_summary_channel_id: string;
  discord_message_id: string;
  report_id: string;
  verdict: "WAIT" | "BUY" | "SELL";
  confidence: number;
  consensus: string;
  sources: string[];
}): Promise<void> {
  await query(
    `
    INSERT INTO final_reports (
      scope, market, ticker, discord_thread_id, discord_summary_channel_id,
      discord_message_id, report_id, verdict, confidence, consensus, sources
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (discord_message_id)
    DO NOTHING
    `,
    [
      input.scope,
      input.market,
      input.ticker,
      input.discord_thread_id,
      input.discord_summary_channel_id,
      input.discord_message_id,
      input.report_id,
      input.verdict,
      input.confidence,
      input.consensus,
      JSON.stringify(input.sources)
    ]
  );
}

export async function insertAuditLog(input: {
  event_type: string;
  guild_id: string;
  actor_user_id: string;
  details: Record<string, unknown>;
}): Promise<void> {
  await query(
    `
    INSERT INTO audit_logs (event_type, guild_id, actor_user_id, details)
    VALUES ($1,$2,$3,$4)
    `,
    [input.event_type, input.guild_id, input.actor_user_id, JSON.stringify(input.details)]
  );
}
