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

function verdictColor(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v === "BUY") return "#0a7f42";
  if (v === "SELL") return "#b42318";
  return "#344054";
}

function verdictKorean(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v === "BUY") return "매수 (BUY)";
  if (v === "SELL") return "매도 (SELL)";
  return "관망 (WAIT)";
}

function fontDirsForHost(): string[] {
  return [
    "C:\\Windows\\Fonts",
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "/Library/Fonts",
    "/System/Library/Fonts"
  ].filter((p) => existsSync(p));
}

function fontFilesForHost(): string[] {
  return [
    "C:\\Windows\\Fonts\\malgun.ttf",
    "C:\\Windows\\Fonts\\malgunbd.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansKR-Medium.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/local/share/fonts/NotoSansKR-Regular.otf",
    "/Library/Fonts/Apple SD Gothic Neo.ttc",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc"
  ].filter((p) => existsSync(p));
}

function defaultFontFamily(fontFiles: string[]): string {
  const joined = fontFiles.map((f) => path.basename(f).toLowerCase()).join(" ");
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

  // --- ENTRY/TP/SL (짧게, 최대 2줄) ---
  const entryLines = wrapText(report.entry, 20).slice(0, 2);
  const tpLines = wrapText(report.tp, 20).slice(0, 2);
  const slLines = wrapText(report.sl, 20).slice(0, 2);
  const maxPriceLines = Math.max(entryLines.length, tpLines.length, slLines.length);
  const priceBoxH = 70 + maxPriceLines * 30 + 15;

  // --- 합의 의견 ---
  const consensusLines = wrapText(report.consensus, 50).slice(0, 8);
  const consensusTextH = consensusLines.length * 32;
  const summaryOneLiner =
    report.consensus.length > 55
      ? report.consensus.slice(0, 55) + "..."
      : report.consensus;
  const consensusSectionH = 55 + consensusTextH + 55 + 28 + 30;

  // --- 소수의견 (DISSENT) ---
  const dissent = (report as any).dissent as string | undefined;
  const hasDissent = typeof dissent === "string" && dissent.trim().length > 0;
  const dissentLines = hasDissent ? wrapText(dissent!.trim(), 55).slice(0, 4) : [];
  const dissentSectionH = hasDissent ? 50 + dissentLines.length * 30 + 25 : 0;

  // --- 날짜 ---
  const dateStr = new Date(report.created_at).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  // --- 높이 계산 ---
  const headerH = 155;
  const verdictH = 180;
  const gap = 22;
  const signatureH = 150;
  const disclaimerH = 60;
  const totalH =
    headerH +
    verdictH + gap +
    priceBoxH + gap +
    consensusSectionH + gap +
    (hasDissent ? dissentSectionH + gap : 0) +
    signatureH + gap +
    disclaimerH + 50;

  // --- tspan 생성 ---
  const mkTspans = (lines: string[], x: number, dy: number) =>
    lines
      .map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : dy}">${xmlEscape(l)}</tspan>`)
      .join("");

  const entryTspans = mkTspans(entryLines, PAD + 20, 28);
  const tpTspans = mkTspans(tpLines, PAD + 440, 28);
  const slTspans = mkTspans(slLines, PAD + 860, 28);
  const consensusTspans = mkTspans(consensusLines, PAD + 30, 32);
  const dissentTspans = mkTspans(dissentLines, PAD + 30, 28);

  // --- Y 좌표 ---
  const verdictY = headerH;
  const priceY = verdictY + verdictH + gap;
  const consensusY = priceY + priceBoxH + gap;
  const dissentY = consensusY + consensusSectionH + gap;
  const signatureY = hasDissent
    ? dissentY + dissentSectionH + gap
    : consensusY + consensusSectionH + gap;
  const disclaimerY = signatureY + signatureH + gap;

  // --- 페르소나 서명 (가로 나열) ---
  const sigNames = ["기술적", "기업", "옵션", "매크로"];
  const sigLabels = ["기술적 분석가", "기업 애널리스트", "옵션 트레이더", "매크로 전문가"];
  const sigSpacing = INNER / 4;
  const sigBlocks = sigNames
    .map((name, i) => {
      const cx = PAD + sigSpacing * i + sigSpacing / 2;
      return `
      <text x="${cx}" y="${signatureY + 68}" font-size="42" fill="#344054" font-style="italic" font-weight="300" text-anchor="middle" opacity="0.6">${xmlEscape(name)}</text>
      <line x1="${cx - 50}" y1="${signatureY + 82}" x2="${cx + 50}" y2="${signatureY + 82}" stroke="#d0d5dd" stroke-width="1"/>
      <text x="${cx}" y="${signatureY + 108}" font-size="14" fill="#98a2b3" text-anchor="middle">${xmlEscape(sigLabels[i])}</text>`;
    })
    .join("");

  // --- 소수의견 SVG ---
  const dissentSvg = hasDissent
    ? `
  <rect x="${PAD}" y="${dissentY}" width="${INNER}" height="${dissentSectionH}" rx="14" fill="#fffbeb" stroke="#f59e0b" stroke-width="1.5"/>
  <text x="${PAD + 30}" y="${dissentY + 35}" font-size="20" fill="#92400e" font-weight="700" text-decoration="underline">소수의견 (DISSENT)</text>
  <text font-size="19" fill="#78350f" font-weight="400">
    <tspan x="${PAD + 30}" y="${dissentY + 65}">${dissentTspans}</tspan>
  </text>`
    : "";

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

  <rect width="${W}" height="${totalH}" fill="url(#bg)"/>
  <rect x="50" y="30" width="${W - 100}" height="${totalH - 60}" fill="#ffffff" stroke="#d0d5dd" stroke-width="2" rx="18"/>

  <!-- 헤더 -->
  <text x="${PAD}" y="88" font-size="38" font-weight="800" fill="#101828">분석위원회 심층 보고서</text>
  <text x="${PAD}" y="125" font-size="20" fill="#667085">${xmlEscape(marketLabel)} | ${xmlEscape(ticker)}</text>
  <text x="${INNER + PAD - 10}" y="78" font-size="32" fill="#101828" text-anchor="end" font-weight="800">${xmlEscape(ticker)}</text>
  <text x="${INNER + PAD - 10}" y="108" font-size="16" fill="#98a2b3" text-anchor="end">${xmlEscape(dateStr)}</text>
  <line x1="${PAD}" y1="143" x2="${INNER + PAD}" y2="143" stroke="#eaecf0" stroke-width="2"/>

  <!-- 위원회 공식 입장 -->
  <rect x="${PAD}" y="${verdictY}" width="${INNER}" height="${verdictH}" rx="16" fill="#f2f4f7" stroke="#d0d5dd"/>
  <text x="${PAD + 30}" y="${verdictY + 42}" font-size="22" fill="#667085" font-weight="600">위원회 공식 입장</text>
  <text x="${PAD + 30}" y="${verdictY + 128}" font-size="68" fill="${verdictColor(report.verdict)}" font-weight="900">${xmlEscape(verdictKorean(report.verdict))}</text>
  <text x="${INNER + PAD - 30}" y="${verdictY + 48}" font-size="24" fill="#344054" font-weight="700" text-anchor="end">신뢰도 ${report.confidence}</text>

  <!-- ENTRY -->
  <rect x="${PAD}" y="${priceY}" width="400" height="${priceBoxH}" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 20}" y="${priceY + 28}" font-size="16" fill="#667085" font-weight="600">진입 구간 (ENTRY)</text>
  <text font-size="22" fill="#101828" font-weight="700">
    <tspan x="${PAD + 20}" y="${priceY + 60}">${entryTspans}</tspan>
  </text>

  <!-- TP -->
  <rect x="${PAD + 420}" y="${priceY}" width="400" height="${priceBoxH}" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 440}" y="${priceY + 28}" font-size="16" fill="#667085" font-weight="600">목표가 (TP)</text>
  <text font-size="22" fill="#067647" font-weight="700">
    <tspan x="${PAD + 440}" y="${priceY + 60}">${tpTspans}</tspan>
  </text>

  <!-- SL -->
  <rect x="${PAD + 840}" y="${priceY}" width="400" height="${priceBoxH}" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 860}" y="${priceY + 28}" font-size="16" fill="#667085" font-weight="600">손절가 (SL)</text>
  <text font-size="22" fill="#b42318" font-weight="700">
    <tspan x="${PAD + 860}" y="${priceY + 60}">${slTspans}</tspan>
  </text>

  <!-- 위원회 합의 의견 -->
  <rect x="${PAD}" y="${consensusY}" width="${INNER}" height="${consensusSectionH}" rx="14" fill="#f8fafc" stroke="#d0d5dd"/>
  <text x="${PAD + 30}" y="${consensusY + 36}" font-size="20" fill="#344054" font-weight="700">위원회 합의 의견</text>
  <text font-size="21" fill="#101828" font-weight="400">
    <tspan x="${PAD + 30}" y="${consensusY + 72}">${consensusTspans}</tspan>
  </text>
  <text x="${PAD + 30}" y="${consensusY + 72 + consensusTextH + 28}" font-size="15" fill="#98a2b3" font-weight="600">요약: <tspan fill="#667085" font-style="italic" font-weight="400">${xmlEscape(summaryOneLiner)}</tspan></text>

  <!-- 소수의견 (DISSENT) -->
  ${dissentSvg}

  <!-- 페르소나 서명 -->
  <rect x="${PAD}" y="${signatureY}" width="${INNER}" height="${signatureH}" rx="14" fill="#fcfcfd" stroke="#d0d5dd"/>
  <text x="${PAD + 30}" y="${signatureY + 28}" font-size="18" fill="#344054" font-weight="700">페르소나 서명</text>
  ${sigBlocks}

  <!-- 면책조항 -->
  <rect x="${PAD}" y="${disclaimerY}" width="${INNER}" height="${disclaimerH}" rx="14" fill="#101828"/>
  <text x="${PAD + 20}" y="${disclaimerY + 26}" font-size="15" fill="#98a2b3">면책: 본 자료는 투자 자문이 아니며, 최종 판단 책임은 사용자에게 있습니다.</text>
  <text x="${PAD + 20}" y="${disclaimerY + 46}" font-size="13" fill="#667085">© Mapi Analysis Committee • Powered by OpenClaw</text>
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
    fitTo: { mode: "width", value: 1400 },
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
