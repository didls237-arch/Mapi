CREATE TABLE IF NOT EXISTS persona_styles (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  persona TEXT NOT NULL,
  style_text TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, persona)
);

CREATE TABLE IF NOT EXISTS system_rules (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_persona_styles_guild ON persona_styles(guild_id, persona);
CREATE INDEX IF NOT EXISTS idx_system_rules_guild_created ON system_rules(guild_id, created_at ASC);
