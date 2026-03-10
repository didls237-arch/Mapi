CREATE TABLE IF NOT EXISTS threads (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('macro', 'kor', 'ex', 'coin')),
  discord_thread_id TEXT NOT NULL UNIQUE,
  discord_parent_channel_id TEXT NOT NULL,
  linked_previous_thread_id TEXT NULL,
  openclaw_discussion_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS turn_messages (
  id BIGSERIAL PRIMARY KEY,
  market TEXT NOT NULL CHECK (market IN ('kor', 'ex', 'coin')),
  ticker TEXT NOT NULL,
  discord_thread_id TEXT NOT NULL,
  discord_message_id TEXT NOT NULL UNIQUE,
  turn_number INT NOT NULL CHECK (turn_number BETWEEN 1 AND 15),
  persona TEXT NOT NULL,
  phase TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (discord_thread_id, turn_number)
);

CREATE TABLE IF NOT EXISTS summary_checkpoints (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('macro', 'kor', 'ex', 'coin')),
  discord_thread_id TEXT NOT NULL,
  checkpoint_message_id TEXT NOT NULL,
  checkpoint_created_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, discord_thread_id)
);

CREATE TABLE IF NOT EXISTS final_reports (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('macro', 'kor', 'ex', 'coin')),
  market TEXT NOT NULL CHECK (market IN ('kor', 'ex', 'coin')),
  ticker TEXT NOT NULL,
  discord_thread_id TEXT NOT NULL,
  discord_summary_channel_id TEXT NOT NULL,
  discord_message_id TEXT NOT NULL UNIQUE,
  report_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('WAIT', 'BUY', 'SELL')),
  confidence INT NOT NULL,
  consensus TEXT NOT NULL,
  sources JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_turn_messages_thread ON turn_messages(discord_thread_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_summary_scope_thread ON summary_checkpoints(scope, discord_thread_id);
CREATE INDEX IF NOT EXISTS idx_final_reports_scope_market ON final_reports(scope, market, ticker);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_created ON audit_logs(event_type, created_at DESC);
