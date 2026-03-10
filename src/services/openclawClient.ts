import { config } from "../config.js";
import {
  DiscussionStartResponse,
  DiscussionTurnResponse,
  FinalReportRequest,
  FinalReportResponse
} from "../types.js";

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const base = config.OPENCLAW_RETRY_BASE_DELAY_MS;
  const max = config.OPENCLAW_RETRY_MAX_DELAY_MS;
  const jitter = Math.floor(Math.random() * 150);
  return Math.min(max, base * 2 ** (attempt - 1) + jitter);
}

function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("AbortError") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("fetch failed")
  );
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.OPENCLAW_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.OPENCLAW_TIMEOUT_MS);
    try {
      const response = await fetch(`${config.OPENCLAW_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.OPENCLAW_OAUTH_BEARER_TOKEN}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        const retryable = RETRYABLE_STATUS.has(response.status);
        const error = new Error(`OpenClaw HTTP ${response.status}: ${text}`);
        if (retryable && attempt < config.OPENCLAW_RETRY_ATTEMPTS) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw error;
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt >= config.OPENCLAW_RETRY_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }
      await sleep(backoffDelay(attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`OpenClaw request failed: ${String(lastError)}`);
}

export async function startDiscussion(payload: {
  market: string;
  ticker: string;
  thread_id: string;
  mode: "analysis" | "summary" | "rollover" | "macro";
  system_rules: string[];
}): Promise<DiscussionStartResponse> {
  return postJson<DiscussionStartResponse>("/v1/discussions/start", payload);
}

export async function discussionTurn(
  discussionId: string,
  payload: {
    turn_number?: number;
    persona?: string;
    phase?: string;
    prompt: string;
    context?: string;
  }
): Promise<DiscussionTurnResponse> {
  return postJson<DiscussionTurnResponse>(`/v1/discussions/${discussionId}/turn`, payload);
}

export async function finalReport(payload: FinalReportRequest): Promise<FinalReportResponse> {
  return postJson<FinalReportResponse>("/v1/reports/final", payload);
}