CREATE TABLE IF NOT EXISTS analysis_jobs (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('kor', 'ex', 'coin')),
  ticker TEXT NOT NULL,
  discord_thread_id TEXT NOT NULL UNIQUE,
  discord_forum_channel_id TEXT NOT NULL,
  discord_summary_channel_id TEXT NOT NULL,
  openclaw_discussion_id TEXT NOT NULL,
  next_turn INT NOT NULL CHECK (next_turn BETWEEN 1 AND 16),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  actor_user_id TEXT NOT NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'turn_messages_discord_thread_id_turn_number_key'
  ) THEN
    ALTER TABLE turn_messages
      ADD CONSTRAINT turn_messages_discord_thread_id_turn_number_key
      UNIQUE (discord_thread_id, turn_number);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status_updated ON analysis_jobs(guild_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_lookup ON analysis_jobs(guild_id, scope, ticker, status);