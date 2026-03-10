import { describe, expect, it } from "vitest";
import { personaForTurn, phaseForTurn, riskIcon } from "../src/constants.js";

describe("turn mapping", () => {
  it("maps phases correctly", () => {
    expect(phaseForTurn(1)).toBe("탐색 단계");
    expect(phaseForTurn(5)).toBe("탐색 단계");
    expect(phaseForTurn(6)).toBe("검증 및 반박 단계");
    expect(phaseForTurn(10)).toBe("검증 및 반박 단계");
    expect(phaseForTurn(11)).toBe("수렴 및 합의 단계");
    expect(phaseForTurn(15)).toBe("수렴 및 합의 단계");
  });

  it("rotates personas", () => {
    expect(personaForTurn(1)).toBe("기술적 차트 분석가");
    expect(personaForTurn(2)).toBe("기업 애널리스트");
    expect(personaForTurn(3)).toBe("옵션 트레이더");
    expect(personaForTurn(4)).toBe("매크로 전문가");
    expect(personaForTurn(5)).toBe("기술적 차트 분석가");
  });

  it("maps risk icon", () => {
    expect(riskIcon(1)).toBe("🔴");
    expect(riskIcon(2)).toBe("🟠");
    expect(riskIcon(3)).toBe("🟡");
    expect(riskIcon(4)).toBe("🟢");
    expect(riskIcon(5)).toBe("🟩");
  });
});
