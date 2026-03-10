import { Persona, TurnPhase } from "./types.js";

export const PERSONAS: Persona[] = [
  "기술적 차트 분석가",
  "기업 애널리스트",
  "옵션 트레이더",
  "매크로 전문가"
];

export const TURN_COUNT = 15;

export function personaForTurn(turn: number): Persona {
  const index = (turn - 1) % PERSONAS.length;
  return PERSONAS[index];
}

export function phaseForTurn(turn: number): TurnPhase {
  if (turn >= 1 && turn <= 5) {
    return "탐색 단계";
  }
  if (turn >= 6 && turn <= 10) {
    return "검증 및 반박 단계";
  }
  return "수렴 및 합의 단계";
}

export function riskIcon(risk: number): string {
  if (risk <= 1) return "🔴";
  if (risk <= 2) return "🟠";
  if (risk <= 3) return "🟡";
  if (risk <= 4) return "🟢";
  return "🟩";
}
