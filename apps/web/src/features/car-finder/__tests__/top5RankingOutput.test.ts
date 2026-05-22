import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeCarFinderListings } from "../index";
import { COPILOT_RANKING_SAMPLE } from "../examples/copilotRankingSample";
import { buildTop5CarsByCopilotRankingOutput } from "../output/buildTop5CarsRankingOutput";

describe("Top 5 cars by Copilot ranking output", () => {
  it("prints shortlist with required columns and summary sections", () => {
    const analysis = analyzeCarFinderListings(COPILOT_RANKING_SAMPLE);
    const output = buildTop5CarsByCopilotRankingOutput(analysis);

    expect(output).toContain("## Top 5 cars by Copilot ranking");
    expect(output).toContain("| Rank | Title | Total Score | Recommendation | Annual Depreciation | Price | Risk Flags |");
    expect(output).toContain("## Best value");
    expect(output).toContain("## Low headache");
    expect(output).toContain("## Avoid / Skip");

    if (process.env.CAR_FINDER_WRITE_REPORT === "1") {
      const reportPath = resolve(
        "/home/runner/work/planning-os/planning-os/apps/web/src/features/car-finder/reports/top5-cars-by-copilot-ranking.md",
      );
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, output, "utf8");
    }

    console.log("\n" + output);
  });
});
