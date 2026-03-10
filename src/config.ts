import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const boolFromString = z
  .string()
  .optional()
  .transform((v) => (v ?? "false").toLowerCase() === "true");

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_ADMIN_ROLE_ID: z.string().min(1),
  DISCORD_PARTICIPANT_ROLE_ID: z.string().min(1),

  MACRO_QUESTION_CHANNEL_ID: z.string().min(1),
  KOR_QUESTION_CHANNEL_ID: z.string().min(1),
  EX_QUESTION_CHANNEL_ID: z.string().min(1),
  COIN_QUESTION_CHANNEL_ID: z.string().min(1),

  PG_CONNECTION_STRING: z.string().min(1),

  OPENCLAW_BASE_URL: z.string().url(),
  OPENCLAW_OAUTH_BEARER_TOKEN: z.string().min(1),
  OPENCLAW_TIMEOUT_MS: z.coerce.number().positive().default(30000),
  OPENCLAW_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  OPENCLAW_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).default(700),
  OPENCLAW_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(500).default(6000),

  MACRO_FORUM_CHANNEL_ID: z.string().min(1),
  KOR_FORUM_CHANNEL_ID: z.string().min(1),
  EX_FORUM_CHANNEL_ID: z.string().min(1),
  COIN_FORUM_CHANNEL_ID: z.string().min(1),

  MACRO_SUMMARY_CHANNEL_ID: z.string().min(1),
  KOR_SUMMARY_CHANNEL_ID: z.string().min(1),
  EX_SUMMARY_CHANNEL_ID: z.string().min(1),
  COIN_SUMMARY_CHANNEL_ID: z.string().min(1),

  ROLLOVER_MESSAGE_THRESHOLD: z.coerce.number().positive().default(120),
  SUMMARY_MAX_MESSAGES: z.coerce.number().int().min(100).default(2000),

  ANALYSIS_TURN_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  ANALYSIS_SKIP_FAILED_TURN: boolFromString,
  ANALYSIS_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  ANALYSIS_COMMAND_COOLDOWN_SEC: z.coerce.number().int().min(0).default(30),
  ANALYSIS_RESUME_ON_START: boolFromString,

  ENABLE_SETUP_CHECKS: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() === "true")
});

export type AppConfig = z.infer<typeof schema>;

export const config: AppConfig = schema.parse(process.env);