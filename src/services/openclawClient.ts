import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { config } from "../config.js";
import {
  DiscussionStartResponse,
  DiscussionTurnResponse,
  FinalReportRequest,
  FinalReportResponse
} from "../types.js";

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

interface CliBridgeRequest {
  action: "start_discussion" | "discussion_turn" | "final_report";
  discussion_id?: string;
  payload: unknown;
}

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
    message.includes("fetch failed") ||
    message.includes("timed out") ||
    message.includes("exited with code")
  );
}

function parseJsonResponse<T>(raw: string): T {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("OpenClaw CLI returned empty stdout");
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error(`OpenClaw CLI returned non-JSON stdout: ${trimmed.slice(0, 400)}`);
  }
}

async function postHttpJson<T>(path: string, payload: unknown): Promise<T> {
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

function executeCliRequest<T>(request: CliBridgeRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.OPENCLAW_CLI_COMMAND, config.OPENCLAW_CLI_ARGS_JSON, {
      cwd: config.OPENCLAW_CLI_CWD || undefined,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, config.OPENCLAW_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(new Error(`OpenClaw CLI timed out after ${config.OPENCLAW_TIMEOUT_MS}ms`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `OpenClaw CLI exited with code ${code}: ${(stderr || stdout).trim().slice(0, 400)}`
          )
        );
        return;
      }

      try {
        resolve(parseJsonResponse<T>(stdout));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

async function postCliJson<T>(request: CliBridgeRequest): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.OPENCLAW_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await executeCliRequest<T>(request);
    } catch (error) {
      lastError = error;
      if (attempt >= config.OPENCLAW_RETRY_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }
      await sleep(backoffDelay(attempt));
    }
  }

  throw new Error(`OpenClaw CLI request failed: ${String(lastError)}`);
}

export async function startDiscussion(payload: {
  market: string;
  ticker: string;
  thread_id: string;
  mode: "analysis" | "summary" | "rollover" | "macro";
  system_rules: string[];
}): Promise<DiscussionStartResponse> {
  if (config.OPENCLAW_TRANSPORT === "cli") {
    return postCliJson<DiscussionStartResponse>({
      action: "start_discussion",
      payload: {
        discussion_id: randomUUID(),
        ...payload
      }
    });
  }

  return postHttpJson<DiscussionStartResponse>("/v1/discussions/start", payload);
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
  if (config.OPENCLAW_TRANSPORT === "cli") {
    return postCliJson<DiscussionTurnResponse>({
      action: "discussion_turn",
      discussion_id: discussionId,
      payload
    });
  }

  return postHttpJson<DiscussionTurnResponse>(`/v1/discussions/${discussionId}/turn`, payload);
}

export async function finalReport(payload: FinalReportRequest): Promise<FinalReportResponse> {
  if (config.OPENCLAW_TRANSPORT === "cli") {
    return postCliJson<FinalReportResponse>({
      action: "final_report",
      payload
    });
  }

  return postHttpJson<FinalReportResponse>("/v1/reports/final", payload);
}
