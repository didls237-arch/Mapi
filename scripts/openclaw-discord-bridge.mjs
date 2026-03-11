#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

function readStdin() {
  return readFileSync(0, "utf8");
}

function jsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
}

function buildCommand(action) {
  const map = {
    start_discussion: {
      command: process.env.OPENCLAW_BRIDGE_START_COMMAND || "",
      args: jsonEnv("OPENCLAW_BRIDGE_START_ARGS_JSON", [])
    },
    discussion_turn: {
      command: process.env.OPENCLAW_BRIDGE_TURN_COMMAND || "",
      args: jsonEnv("OPENCLAW_BRIDGE_TURN_ARGS_JSON", [])
    },
    final_report: {
      command: process.env.OPENCLAW_BRIDGE_REPORT_COMMAND || "",
      args: jsonEnv("OPENCLAW_BRIDGE_REPORT_ARGS_JSON", [])
    }
  };

  const entry = map[action];
  if (!entry) throw new Error(`Unsupported action: ${action}`);
  if (!entry.command) throw new Error(`Missing bridge command for action: ${action}`);
  if (!Array.isArray(entry.args) || entry.args.some((item) => typeof item !== "string")) {
    throw new Error(`Bridge args for ${action} must be a JSON string array`);
  }
  return entry;
}

function payloadOf(request) {
  return request?.payload && typeof request.payload === "object" ? request.payload : {};
}

function extractPrompt(request) {
  const { action, discussion_id } = request;
  const payload = payloadOf(request);

  if (action === "start_discussion") {
    const rules = Array.isArray(payload.system_rules) ? payload.system_rules.join("\n") : "";
    return [
      `action=start_discussion`,
      `discussion_id=${payload.discussion_id || discussion_id || ""}`,
      `mode=${payload.mode || "analysis"}`,
      `market=${String(payload.market || "").toUpperCase()}`,
      `ticker=${String(payload.ticker || "").toUpperCase()}`,
      `thread_id=${payload.thread_id || ""}`,
      "system_rules:",
      rules || "(none)",
      "",
      "Initialize the discussion context and return the first response only if appropriate."
    ].join("\n");
  }

  if (action === "discussion_turn") {
    return [
      `action=discussion_turn`,
      `discussion_id=${discussion_id || ""}`,
      `turn_number=${payload.turn_number ?? ""}`,
      `persona=${payload.persona || "analyst"}`,
      `phase=${payload.phase || ""}`,
      "prompt:",
      payload.prompt || "",
      payload.context ? "" : null,
      payload.context ? "context:" : null,
      payload.context || null
    ]
      .filter((line) => line !== null)
      .join("\n");
  }

  if (action === "final_report") {
    const turns = Array.isArray(payload.turns) ? payload.turns : [];
    const turnSummary = turns
      .map((turn) => {
        const turnNumber = turn?.turn_number ?? "?";
        const persona = turn?.persona || "analyst";
        const content = String(turn?.content || "").slice(0, 500);
        return `Turn ${turnNumber} (${persona}): ${content}`;
      })
      .join("\n\n");

    return [
      `action=final_report`,
      `market=${String(payload.market || "").toUpperCase()}`,
      `ticker=${String(payload.ticker || "").toUpperCase()}`,
      `thread_id=${payload.thread_id || ""}`,
      "",
      "Create a final investment report as JSON.",
      "Required JSON keys:",
      '{"report_id":"id","verdict":"WAIT|BUY|SELL","confidence":0,"entry":"...","tp":"...","sl":"...","consensus":"...","persona_comments":[{"persona":"...","opinion":"...","stance":"찬성|중립|반대"}],"sources":["source1","source2"],"created_at":"ISO-8601"}',
      "",
      "Turns:",
      turnSummary || "(none)"
    ].join("\n");
  }

  return payload.prompt || payload.message || JSON.stringify(request);
}

function normalizeVerdict(value) {
  const raw = String(value || "").toUpperCase();
  if (raw === "BUY" || raw === "SELL" || raw === "WAIT") return raw;
  if (raw === "HOLD") return "WAIT";
  return "WAIT";
}

function normalizeConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  const raw = String(value || "").toUpperCase();
  if (raw === "HIGH") return 85;
  if (raw === "MEDIUM") return 65;
  if (raw === "LOW") return 40;

  const num = Number(raw);
  if (Number.isFinite(num)) {
    return Math.max(0, Math.min(100, Math.round(num)));
  }

  return 60;
}

function extractText(openclawResult) {
  return (
    openclawResult?.result?.payloads?.find((item) => typeof item?.text === "string")?.text ||
    openclawResult?.result?.text ||
    openclawResult?.text ||
    ""
  );
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    return JSON.parse(fenceMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("No JSON object found in response text");
}

function transformResponse(action, request, openclawResult) {
  const payload = payloadOf(request);
  const text = extractText(openclawResult);
  const meta = openclawResult?.result?.meta?.agentMeta || {};

  if (action === "start_discussion") {
    return {
      discussion_id: payload.discussion_id || request.discussion_id || meta.sessionId || `disc-${Date.now()}`
    };
  }

  if (action === "discussion_turn") {
    return {
      content: text || "(empty)",
      citations: [],
      risk_score: 3
    };
  }

  if (action === "final_report") {
    try {
      const parsed = extractJsonObject(text);
      const personaComments = Array.isArray(parsed.persona_comments) ? parsed.persona_comments : [];
      const sources = Array.isArray(parsed.sources) ? parsed.sources.map(String) : [];

      return {
        report_id: parsed.report_id || `rpt-${Date.now()}`,
        verdict: normalizeVerdict(parsed.verdict),
        confidence: normalizeConfidence(parsed.confidence),
        entry: String(parsed.entry || "N/A"),
        tp: String(parsed.tp || "N/A"),
        sl: String(parsed.sl || "N/A"),
        consensus: String(parsed.consensus || text.slice(0, 1500) || "No consensus provided"),
        persona_comments: personaComments.map((item) => ({
          persona: String(item?.persona || "analyst"),
          opinion: String(item?.opinion || ""),
          stance: ["찬성", "중립", "반대"].includes(String(item?.stance)) ? String(item.stance) : "중립"
        })),
        sources,
        created_at: parsed.created_at || new Date().toISOString()
      };
    } catch {
      return {
        report_id: `rpt-${Date.now()}`,
        verdict: "WAIT",
        confidence: 60,
        entry: "N/A",
        tp: "N/A",
        sl: "N/A",
        consensus: text.slice(0, 1500) || "No consensus provided",
        persona_comments: [],
        sources: [],
        created_at: new Date().toISOString()
      };
    }
  }

  return { content: text || "(empty)" };
}

function runTarget(command, args, messageText) {
  return new Promise((resolve, reject) => {
    const fullArgs = [...args, "--message", messageText];
    const child = spawn(command, fullArgs, {
      cwd: process.env.OPENCLAW_BRIDGE_CWD || process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutMs = Number(process.env.OPENCLAW_BRIDGE_TIMEOUT_MS || "120000");
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(new Error(`Bridge target timed out after ${timeoutMs}ms`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(`Bridge target exited with code ${code}: ${(stderr || stdout).trim().slice(0, 400)}`)
        );
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({ result: { payloads: [{ text: "" }] } });
        return;
      }

      try {
        const firstBrace = trimmed.indexOf("{");
        const lastBrace = trimmed.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          resolve(JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)));
          return;
        }
      } catch {
        // fall through
      }

      resolve({ result: { payloads: [{ text: trimmed }] } });
    });

    child.stdin.end();
  });
}

async function main() {
  const request = JSON.parse(readStdin());
  const target = buildCommand(request.action);
  const prompt = extractPrompt(request);
  const openclawResult = await runTarget(target.command, target.args, prompt);
  const response = transformResponse(request.action, request, openclawResult);
  process.stdout.write(JSON.stringify(response));
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error));
  process.exit(1);
});
