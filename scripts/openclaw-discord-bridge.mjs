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
  if (!entry) {
    throw new Error(`Unsupported action: ${action}`);
  }

  if (!entry.command) {
    throw new Error(`Missing bridge command for action: ${action}`);
  }

  if (!Array.isArray(entry.args) || entry.args.some((item) => typeof item !== "string")) {
    throw new Error(`Bridge args for ${action} must be a JSON string array`);
  }

  return entry;
}

function parseJsonResponse(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Bridge target returned empty stdout");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`Bridge target returned non-JSON stdout: ${trimmed.slice(0, 400)}`);
  }
}

function runTarget(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.env.OPENCLAW_BRIDGE_CWD || process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutMs = Number(process.env.OPENCLAW_BRIDGE_TIMEOUT_MS || "30000");
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
          new Error(
            `Bridge target exited with code ${code}: ${(stderr || stdout).trim().slice(0, 400)}`
          )
        );
        return;
      }

      try {
        resolve(parseJsonResponse(stdout));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

async function main() {
  const request = JSON.parse(readStdin());
  const { action } = request;
  const target = buildCommand(action);
  const response = await runTarget(target.command, target.args, request);
  process.stdout.write(JSON.stringify(response));
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error));
  process.exit(1);
});
