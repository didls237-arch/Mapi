#!/usr/bin/env node

import { readFileSync } from "node:fs";

function readStdin() {
  return readFileSync(0, "utf8");
}

async function runOpenClaw(request) {
  // TODO:
  // Replace this function with the real OpenClaw CLI invocation.
  // The input shape is:
  // {
  //   action: "start_discussion" | "discussion_turn" | "final_report",
  //   discussion_id?: string,
  //   payload: object
  // }
  //
  // Return one JSON object matching the bot expectations.
  // Examples:
  // { discussion_id: "abc-123" }
  // { content: "response text", citations: [], risk_score: 3 }
  // {
  //   report_id: "rpt-1",
  //   verdict: "WAIT",
  //   confidence: 80,
  //   entry: "entry",
  //   tp: "tp",
  //   sl: "sl",
  //   consensus: "summary",
  //   persona_comments: [],
  //   sources: ["source-1", "source-2"],
  //   created_at: new Date().toISOString()
  // }
  throw new Error(`Implement OpenClaw CLI bridge for action: ${request.action}`);
}

async function main() {
  const raw = readStdin();
  const request = JSON.parse(raw);
  const response = await runOpenClaw(request);
  process.stdout.write(JSON.stringify(response));
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error));
  process.exit(1);
});
