import { existsSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { FinalReportResponse } from "../types.js";

function xmlEscape(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(text: string, maxLen = 58): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLen) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, 8);
}

function verdictColor(verdict: FinalReportResponse["verdict"]): string {
  if (verdict === "BUY") return "#0a7f42";
  if (verdict === "SELL") return "#b42318";
  return "#344054";
}

function fontDirsForHost(): string[] {
  const candidates = [
    "C:\\Windows\\Fonts",
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "/Library/Fonts",
    "/System/Library/Fonts"
  ];
  return candidates.filter((p) => existsSync(p));
}

export function buildReportSvg(input: {
  ticker: string;
  marketLabel: string;
  report: FinalReportResponse;
}): string {
  const { ticker, marketLabel, report } = input;
  const consensusLines = wrapText(report.consensus, 58);

  const sourceText = report.sources.slice(0, 3).join(" | ");
  const personaText = report.persona_comments
    .slice(0, 4)
    .map((item) => `${item.persona}: ${item.opinion} [${item.stance}]`)
    .join(" / ");

  const linesSvg = consensusLines
    .map((line, idx) => `<tspan x="80" dy="${idx === 0 ? 0 : 34}">${xmlEscape(line)}</tspan>`)
    .join("");

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1800">
  <style>
    text {
      font-family: "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", "NanumGothic", sans-serif;
    }
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#eef2ff"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1400" height="1800" fill="url(#bg)"/>
  <rect x="54" y="52" width="1292" height="1696" fill="#ffffff" stroke="#d0d5dd" stroke-width="2" rx="18"/>

  <text x="90" y="140" font-size="54" font-weight="800" fill="#101828">최종 투자 판결문</text>
  <text x="92" y="188" font-size="28" font-weight="500" fill="#475467">${xmlEscape(marketLabel)} | ${xmlEscape(ticker)}</text>
  <text x="92" y="232" font-size="24" fill="#667085">${xmlEscape(new Date(report.created_at).toLocaleString("ko-KR"))} | REF: ${xmlEscape(report.report_id)}</text>

  <rect x="90" y="280" width="1220" height="210" rx="16" fill="#f2f4f7" stroke="#d0d5dd"/>
  <text x="120" y="360" font-size="38" fill="#475467" font-weight="700">위원회 공식 입장</text>
  <text x="120" y="430" font-size="86" fill="${verdictColor(report.verdict)}" font-weight="900">${xmlEscape(report.verdict)}</text>
  <text x="1040" y="365" font-size="36" fill="#344054" font-weight="700">신뢰도 ${report.confidence}</text>

  <rect x="90" y="540" width="380" height="190" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="120" y="598" font-size="30" fill="#344054" font-weight="700">ENTRY</text>
  <text x="120" y="658" font-size="42" fill="#101828" font-weight="800">${xmlEscape(report.entry)}</text>

  <rect x="510" y="540" width="380" height="190" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="540" y="598" font-size="30" fill="#344054" font-weight="700">TP</text>
  <text x="540" y="658" font-size="42" fill="#067647" font-weight="800">${xmlEscape(report.tp)}</text>

  <rect x="930" y="540" width="380" height="190" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="960" y="598" font-size="30" fill="#344054" font-weight="700">SL</text>
  <text x="960" y="658" font-size="42" fill="#b42318" font-weight="800">${xmlEscape(report.sl)}</text>

  <rect x="90" y="780" width="1220" height="520" rx="14" fill="#f8fafc" stroke="#d0d5dd"/>
  <text x="120" y="848" font-size="34" fill="#344054" font-weight="700">위원회 합의 의견</text>
  <text x="80" y="940" font-size="42" fill="#101828" font-weight="500">${linesSvg}</text>

  <rect x="90" y="1335" width="1220" height="180" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="120" y="1395" font-size="30" fill="#344054" font-weight="700">페르소나 서명</text>
  <text x="120" y="1455" font-size="24" fill="#475467">${xmlEscape(personaText)}</text>

  <rect x="90" y="1545" width="1220" height="140" rx="14" fill="#101828"/>
  <text x="120" y="1600" font-size="24" fill="#f2f4f7">출처: ${xmlEscape(sourceText)}</text>
  <text x="120" y="1642" font-size="22" fill="#d0d5dd">면책: 본 자료는 투자 자문이 아니며, 최종 판단 책임은 사용자에게 있습니다.</text>
</svg>`.trim();
}

export function buildReportPng(input: {
  ticker: string;
  marketLabel: string;
  report: FinalReportResponse;
}): Buffer {
  const svg = buildReportSvg(input);
  const fontDirs = fontDirsForHost();

  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: 1400
    },
    font: {
      fontDirs,
      defaultFontFamily: "Noto Sans KR"
    }
  });

  return resvg.render().asPng();
}