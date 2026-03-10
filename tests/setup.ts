const defaults: Record<string, string> = {
  DISCORD_TOKEN: "test-token",
  DISCORD_CLIENT_ID: "test-client",
  DISCORD_GUILD_ID: "test-guild",
  DISCORD_ADMIN_ROLE_ID: "test-admin-role",
  DISCORD_PARTICIPANT_ROLE_ID: "test-participant-role",
  MACRO_QUESTION_CHANNEL_ID: "macro-question",
  KOR_QUESTION_CHANNEL_ID: "kor-question",
  EX_QUESTION_CHANNEL_ID: "ex-question",
  COIN_QUESTION_CHANNEL_ID: "coin-question",
  PG_CONNECTION_STRING: "postgres://test:test@localhost:5432/test",
  OPENCLAW_BASE_URL: "https://example.com",
  OPENCLAW_OAUTH_BEARER_TOKEN: "test-oauth-token",
  OPENCLAW_TIMEOUT_MS: "30000",
  OPENCLAW_RETRY_ATTEMPTS: "3",
  OPENCLAW_RETRY_BASE_DELAY_MS: "700",
  OPENCLAW_RETRY_MAX_DELAY_MS: "6000",
  MACRO_FORUM_CHANNEL_ID: "macro-forum",
  KOR_FORUM_CHANNEL_ID: "kor-forum",
  EX_FORUM_CHANNEL_ID: "ex-forum",
  COIN_FORUM_CHANNEL_ID: "coin-forum",
  MACRO_SUMMARY_CHANNEL_ID: "macro-summary",
  KOR_SUMMARY_CHANNEL_ID: "kor-summary",
  EX_SUMMARY_CHANNEL_ID: "ex-summary",
  COIN_SUMMARY_CHANNEL_ID: "coin-summary",
  ROLLOVER_MESSAGE_THRESHOLD: "120",
  SUMMARY_MAX_MESSAGES: "2000",
  ANALYSIS_TURN_DELAY_MS: "0",
  ANALYSIS_SKIP_FAILED_TURN: "true",
  ANALYSIS_MAX_CONCURRENCY: "2",
  ANALYSIS_COMMAND_COOLDOWN_SEC: "30",
  ANALYSIS_RESUME_ON_START: "false",
  ENABLE_SETUP_CHECKS: "false"
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}