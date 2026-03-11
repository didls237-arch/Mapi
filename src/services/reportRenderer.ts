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

  // --- ENTRY/TP/SL 줄바꿈 (18자 제한) ---
  const entryLines = wrapText(report.entry, 18).slice(0, 3);
  const tpLines = wrapText(report.tp, 18).slice(0, 3);
  const slLines = wrapText(report.sl, 18).slice(0, 3);
  const priceBoxH = 80 + Math.max(entryLines.length, tpLines.length, slLines.length) * 30 + 20;

  // --- 합의 의견 ---
  const consensusLines = wrapText(report.consensus, 50).slice(0, 8);
  const consensusTextH = consensusLines.length * 32;

  // --- 요약 (합의 의견을 한 줄 50자로 요약) ---
  const summaryOneLiner = report.consensus.length > 50
    ? report.consensus.slice(0, 50) + "..."
    : report.consensus;

  const consensusSectionH = 55 + consensusTextH + 50 + 28 + 30;

  // --- 높이 계산 ---
  const headerH = 160;
  const verdictH = 190;
  const gap = 25;
  const signatureH = 160;
  const disclaimerH = 65;
  const totalH = headerH + verdictH + gap + priceBoxH + gap + consensusSectionH + gap + signatureH + gap + disclaimerH + 60;

  // --- 날짜 ---
  const dateStr = new Date(report.created_at).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });

  // --- ENTRY/TP/SL tspan ---
  const entryTspans = entryLines.map((l, i) =>
    `<tspan x="${PAD + 20}" dy="${i === 0 ? 0 : 28}">${xmlEscape(l)}</tspan>`).join("");
  const tpTspans = tpLines.map((l, i) =>
    `<tspan x="${PAD + 440}" dy="${i === 0 ? 0 : 28}">${xmlEscape(l)}</tspan>`).join("");
  const slTspans = slLines.map((l, i) =>
    `<tspan x="${PAD + 860}" dy="${i === 0 ? 0 : 28}">${xmlEscape(l)}</tspan>`).join("");

  // --- 합의 tspan ---
  const consensusTspans = consensusLines.map((l, i) =>
    `<tspan x="${PAD + 30}" dy="${i === 0 ? 0 : 32}">${xmlEscape(l)}</tspan>`).join("");

  // --- Y 좌표 ---
  const verdictY = headerH;
  const priceY = verdictY + verdictH + gap;
  const consensusY = priceY + priceBoxH + gap;
  const signatureY = consensusY + consensusSectionH + gap;
  const disclaimerY = signatureY + signatureH + gap;

  // --- 페르소나 서명 (가로 나열 + 이탤릭 손글씨풍) ---
  const sigNames = ["기술적", "기업", "옵션", "매크로"];
  const sigLabels = ["기술적 분석가", "기업 애널리스트", "옵션 트레이더", "매크로 전문가"];
  const sigSpacing = INNER / 4;
  const sigBlocks = sigNames.map((name, i) => {
    const cx = PAD + sigSpacing * i + sigSpacing / 2;
    return `
      <text x="${cx}" y="${signatureY + 75}" font-size="44" fill="#344054" font-style="italic" font-weight="300" text-anchor="middle" opacity="0.65">${xmlEscape(name)}</text>
      <line x1="${cx - 55}" y1="${signatureY + 88}" x2="${cx + 55}" y2="${signatureY + 88}" stroke="#d0d5dd" stroke-width="1"/>
      <text x="${cx}" y="${signatureY + 115}" font-size="15" fill="#98a2b3" text-anchor="middle">${xmlEscape(sigLabels[i])}</text>`;
  }).join("");

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
  <rect x="50" y="30" width="${W - 100}" height="${totalH - 60}" fill="#ffffff" stroke="#d0d5dd" stroke-width="2" rx="18"/>

  <!-- 헤더: 제목 + Mapi + 날짜 -->
  <text x="${PAD}" y="90" font-size="40" font-weight="800" fill="#101828">분석위원회 심층 보고서</text>
  <text x="${PAD}" y="130" font-size="22" fill="#667085">${xmlEscape(marketLabel)} | ${xmlEscape(ticker)}</text>
  <text x="${INNER + PAD - 10}" y="80" font-size="22" fill="#475467" text-anchor="end" font-weight="700">Mapi</text>
  <text x="${INNER + PAD - 10}" y="110" font-size="17" fill="#98a2b3" text-anchor="end">${xmlEscape(dateStr)}</text>
  <line x1="${PAD}" y1="148" x2="${INNER + PAD}" y2="148" stroke="#eaecf0" stroke-width="2"/>

  <!-- 위원회 공식 입장 -->
  <rect x="${PAD}" y="${verdictY}" width="${INNER}" height="${verdictH}" rx="16" fill="#f2f4f7" stroke="#d0d5dd"/>
  <text x="${PAD + 30}" y="${verdictY + 45}" font-size="24" fill="#667085" font-weight="600">위원회 공식 입장</text>
  <text x="${PAD + 30}" y="${verdictY + 135}" font-size="76" fill="${verdictColor(report.verdict)}" font-weight="900">${xmlEscape(report.verdict)}</text>
  <text x="${INNER + PAD - 30}" y="${verdictY + 50}" font-size="26" fill="#344054" font-weight="700" text-anchor="end">신뢰도 ${report.confidence}</text>

  <!-- ENTRY -->
  <rect x="${PAD}" y="${priceY}" width="400" height="${priceBoxH}" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 20}" y="${priceY + 32}" font-size="18" fill="#667085" font-weight="600">진입 구간 (ENTRY)</text>
  <text font-size="20" fill="#101828" font-weight="700">
    <tspan x="${PAD + 20}" y="${priceY + 68}">${entryTspans}</tspan>
  </text>

  <!-- TP -->
  <rect x="${PAD + 420}" y="${priceY}" width="400" height="${priceBoxH}" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 440}" y="${priceY + 32}" font-size="18" fill="#667085" font-weight="600">목표가 (TP)</text>
  <text font-size="20" fill="#067647" font-weight="700">
    <tspan x="${PAD + 440}" y="${priceY + 68}">${tpTspans}</tspan>
  </text>

  <!-- SL -->
  <rect x="${PAD + 840}" y="${priceY}" width="400" height="${priceBoxH}" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 860}" y="${priceY + 32}" font-size="18" fill="#667085" font-weight="600">손절가 (SL)</text>
  <text font-size="20" fill="#b42318" font-weight="700">
    <tspan x="${PAD + 860}" y="${priceY + 68}">${slTspans}</tspan>
  </text>

  <!-- 위원회 합의 의견 -->
  <rect x="${PAD}" y="${consensusY}" width="${INNER}" height="${consensusSectionH}" rx="14" fill="#f8fafc" stroke="#d0d5dd"/>
  <text x="${PAD + 30}" y="${consensusY + 38}" font-size="22" fill="#344054" font-weight="700">위원회 합의 의견</text>
  <text font-size="22" fill="#101828" font-weight="400">
    <tspan x="${PAD + 30}" y="${consensusY + 75}">${consensusTspans}</tspan>
  </text>
  <text x="${PAD + 30}" y="${consensusY + 75 + consensusTextH + 30}" font-size="16" fill="#98a2b3" font-weight="600">요약: <tspan fill="#667085" font-style="italic" font-weight="400">${xmlEscape(summaryOneLiner)}</tspan></text>

  <!-- 페르소나 서명 -->
  <rect x="${PAD}" y="${signatureY}" width="${INNER}" height="${signatureH}" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 30}" y="${signatureY + 30}" font-size="20" fill="#344054" font-weight="700">페르소나 서명</text>
  ${sigBlocks}

  <!-- 면책조항 -->
  <rect x="${PAD}" y="${disclaimerY}" width="${INNER}" height="${disclaimerH}" rx="14" fill="#101828"/>
  <text x="${PAD + 20}" y="${disclaimerY + 28}" font-size="16" fill="#98a2b3">면책: 본 자료는 투자 자문이 아니며, 최종 판단 책임은 사용자에게 있습니다.</text>
  <text x="${PAD + 20}" y="${disclaimerY + 50}" font-size="14" fill="#667085">© Mapi Analysis Committee • Powered by OpenClaw</text>
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
