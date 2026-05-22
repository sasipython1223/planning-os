import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeCarFinderListings } from "../index";
import { COPILOT_RANKING_SAMPLE } from "../examples/copilotRankingSample";
import { buildTop5CarsByCopilotRankingOutput } from "../output/buildTop5CarsRankingOutput";

const THIS_FILE_DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(THIS_FILE_DIR, "../reports/top5-cars-by-copilot-ranking.md");

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
      mkdirSync(dirname(REPORT_PATH), { recursive: true });
      writeFileSync(REPORT_PATH, output, "utf8");
    }

    console.log("\n" + output);
  });
});
