import { describe, expect, it } from "vitest";
import { formatTimelineTable } from "../src/services/summaryService.js";

describe("formatTimelineTable", () => {
  it("prints markdown table with risk icon and bold number", () => {
    const table = formatTimelineTable([
      {
        date: "2026-03-09",
        previous_timeline: "A",
        changed_timeline: "B",
        risk: 2
      }
    ]);

    expect(table).toContain("| 요약 일자 |");
    expect(table).toContain("🟠 **2**");
  });
});
