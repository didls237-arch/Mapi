import { existsSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { FinalReportResponse } from "../types.js";

function xmlEscape(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(text: string, maxLen: number): string[] {
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
  return lines;
}

function verdictColor(verdict: FinalReportResponse["verdict"]): string {
  if (verdict === "BUY") return "#0a7f42";
  if (verdict === "SELL") return "#b42318";
  return "#344054";
}

function stanceColor(stance: string): string {
  if (stance === "찬성") return "#0a7f42";
  if (stance === "반대") return "#b42318";
  return "#667085";
}

function personaEmoji(persona: string): string {
  if (persona.includes("차트")) return "📈";
  if (persona.includes("애널")) return "🏢";
  if (persona.includes("옵션")) return "🎯";
  return "🌍";
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

function fontFilesForHost(): string[] {
  const candidates = [
    "C:\\Windows\\Fonts\\malgun.ttf",
    "C:\\Windows\\Fonts\\malgunbd.ttf",
    "C:\\Windows\\Fonts\\NanumGothic.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansKR-Medium.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/local/share/fonts/NotoSansKR-Regular.otf",
    "/Library/Fonts/Apple SD Gothic Neo.ttc",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc"
  ];
  return candidates.filter((p) => existsSync(p));
}

function defaultFontFamily(fontFiles: string[]): string {
  const joined = fontFiles.map((file) => path.basename(file).toLowerCase()).join(" ");
  if (joined.includes("malgun")) return "Malgun Gothic";
  if (joined.includes("apple") || joined.includes("gothicneo")) return "Apple SD Gothic Neo";
  if (joined.includes("nanum")) return "NanumGothic";
  if (joined.includes("cjk")) return "Noto Sans CJK KR";
  return "Noto Sans KR";
}

export function buildReportSvg(input: {
  ticker: string;
  marketLabel: string;
  report: FinalReportResponse;
}): string {
  const { ticker, marketLabel, report } = input;
  const W = 1400;
  const PAD = 80;
  const INNER = W - PAD * 2;

  // --- 합의 의견 (본문 3줄 + 요약 2줄) ---
  const consensusLines = wrapText(report.consensus, 48).slice(0, 4);
  // 요약은 consensus 첫 80자
  const summaryText = report.consensus.length > 80
    ? report.consensus.slice(0, 80) + "..."
    : report.consensus;
  const summaryLines = wrapText(summaryText, 55).slice(0, 2);

  // --- 페르소나 서명 블록 높이 계산 ---
  const personas = report.persona_comments.slice(0, 4);
  const personaBlockH = 70;
  const personaSectionH = 60 + personas.length * personaBlockH + 20;

  // --- 전체 높이 계산 ---
  const consensusSectionH = 60 + consensusLines.length * 36 + 30 + summaryLines.length * 28 + 40;
  const totalH = 290 + 200 + 30 + 190 + 30 + consensusSectionH + 30 + personaSectionH + 30 + 80 + 40;

  // --- 합의 의견 tspan ---
  const consensusTspans = consensusLines
    .map((line, i) => `<tspan x="${PAD + 30}" dy="${i === 0 ? 0 : 36}">${xmlEscape(line)}</tspan>`)
    .join("");

  const summaryTspans = summaryLines
    .map((line, i) => `<tspan x="${PAD + 30}" dy="${i === 0 ? 0 : 26}">${xmlEscape(line)}</tspan>`)
    .join("");

  // --- 페르소나 서명 SVG ---
  let personaY = 290 + 200 + 30 + 190 + 30 + consensusSectionH + 30;
  const personaBlocks = personas.map((p, i) => {
    const y = personaY + 55 + i * personaBlockH;
    const opinionLines = wrapText(p.opinion, 60).slice(0, 1);
    return `
      <text x="${PAD + 30}" y="${y}" font-size="24" fill="#344054" font-weight="700">${xmlEscape(personaEmoji(p.persona))} ${xmlEscape(p.persona)}</text>
      <text x="${PAD + 30}" y="${y + 30}" font-size="20" fill="#667085" font-style="italic">${xmlEscape(opinionLines[0] || "")}</text>
      <text x="${INNER + PAD - 30}" y="${y + 15}" font-size="22" fill="${stanceColor(p.stance)}" font-weight="700" text-anchor="end">[${xmlEscape(p.stance)}]</text>
      <line x1="${PAD + 20}" y1="${y + 45}" x2="${INNER + PAD - 20}" y2="${y + 45}" stroke="#eaecf0" stroke-width="1"/>`;
  }).join("");

  // --- 면책조항 Y ---
  const disclaimerY = personaY + personaSectionH + 20;

  // --- 날짜 포맷 ---
  const dateStr = new Date(report.created_at).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}">
  <style>
    text { font-family: "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", "NanumGothic", sans-serif; }
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#eef2ff"/>
    </linearGradient>
  </defs>

  <!-- 배경 -->
  <rect width="${W}" height="${totalH}" fill="url(#bg)"/>
  <rect x="50" y="40" width="${W - 100}" height="${totalH - 80}" fill="#ffffff" stroke="#d0d5dd" stroke-width="2" rx="18"/>

  <!-- 헤더 -->
  <text x="${PAD}" y="110" font-size="44" font-weight="800" fill="#101828">분석위원회 심층 보고서</text>
  <text x="${INNER + PAD - 10}" y="90" font-size="24" fill="#475467" text-anchor="end" font-weight="700">Mapi</text>
  <text x="${INNER + PAD - 10}" y="120" font-size="18" fill="#98a2b3" text-anchor="end">${xmlEscape(dateStr)}</text>
  <text x="${PAD}" y="155" font-size="24" fill="#667085">${xmlEscape(marketLabel)} | ${xmlEscape(ticker)}  •  REF: ${xmlEscape(report.report_id)}</text>

  <!-- 구분선 -->
  <line x1="${PAD}" y1="175" x2="${INNER + PAD}" y2="175" stroke="#eaecf0" stroke-width="2"/>

  <!-- 위원회 공식 입장 -->
  <rect x="${PAD}" y="195" width="${INNER}" height="200" rx="16" fill="#f2f4f7" stroke="#d0d5dd"/>
  <text x="${PAD + 30}" y="250" font-size="28" fill="#667085" font-weight="600">위원회 공식 입장</text>
  <text x="${PAD + 30}" y="340" font-size="80" fill="${verdictColor(report.verdict)}" font-weight="900">${xmlEscape(report.verdict)}</text>
  <text x="${INNER + PAD - 30}" y="260" font-size="28" fill="#344054" font-weight="700" text-anchor="end">신뢰도 ${report.confidence}</text>

  <!-- ENTRY / TP / SL -->
  <rect x="${PAD}" y="425" width="400" height="160" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 20}" y="470" font-size="22" fill="#667085" font-weight="600">진입 구간 (ENTRY)</text>
  <text x="${PAD + 20}" y="555" font-size="24" fill="#101828" font-weight="700">${xmlEscape(report.entry.slice(0, 30))}</text>

  <rect x="${PAD + 420}" y="425" width="400" height="160" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 440}" y="470" font-size="22" fill="#667085" font-weight="600">목표가 (TP)</text>
  <text x="${PAD + 440}" y="555" font-size="24" fill="#067647" font-weight="700">${xmlEscape(report.tp.slice(0, 30))}</text>

  <rect x="${PAD + 840}" y="425" width="400" height="160" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 860}" y="470" font-size="22" fill="#667085" font-weight="600">손절가 (SL)</text>
  <text x="${PAD + 860}" y="555" font-size="24" fill="#b42318" font-weight="700">${xmlEscape(report.sl.slice(0, 30))}</text>

  <!-- 위원회 합의 의견 -->
  <rect x="${PAD}" y="${425 + 190}" width="${INNER}" height="${consensusSectionH}" rx="14" fill="#f8fafc" stroke="#d0d5dd"/>
  <text x="${PAD + 30}" y="${425 + 190 + 40}" font-size="26" fill="#344054" font-weight="700">위원회 합의 의견</text>
  <text font-size="24" fill="#101828" font-weight="400">
    <tspan x="${PAD + 30}" y="${425 + 190 + 80}">${consensusTspans}</tspan>
  </text>
  <text x="${PAD + 30}" y="${425 + 190 + 80 + consensusLines.length * 36 + 25}" font-size="18" fill="#98a2b3" font-weight="600">요약:</text>
  <text font-size="18" fill="#667085" font-style="italic">
    <tspan x="${PAD + 30}" y="${425 + 190 + 80 + consensusLines.length * 36 + 50}">${summaryTspans}</tspan>
  </text>

  <!-- 페르소나 서명 -->
  <rect x="${PAD}" y="${personaY}" width="${INNER}" height="${personaSectionH}" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 30}" y="${personaY + 38}" font-size="26" fill="#344054" font-weight="700">페르소나 서명</text>
  ${personaBlocks}

  <!-- 면책조항 -->
  <rect x="${PAD}" y="${disclaimerY}" width="${INNER}" height="70" rx="14" fill="#101828"/>
  <text x="${PAD + 20}" y="${disclaimerY + 30}" font-size="18" fill="#98a2b3">면책: 본 자료는 투자 자문이 아니며, 최종 판단 책임은 사용자에게 있습니다.</text>
  <text x="${PAD + 20}" y="${disclaimerY + 55}" font-size="16" fill="#667085">© Mapi Analysis Committee • Powered by OpenClaw</text>
</svg>`.trim();
}

export function buildReportPng(input: {
  ticker: string;
  marketLabel: string;
  report: FinalReportResponse;
}): Buffer {
  const svg = buildReportSvg(input);
  const fontDirs = fontDirsForHost();
  const fontFiles = fontFilesForHost();
  const family = defaultFontFamily(fontFiles);

  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: 1400
    },
    font: {
      loadSystemFonts: true,
      fontFiles,
      fontDirs,
      defaultFontFamily: family,
      sansSerifFamily: family
    }
  });

  return resvg.render().asPng();
}
