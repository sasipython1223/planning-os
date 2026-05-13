import { describe, expect, it } from "vitest";
import {
    DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
    evaluateCutoverReadinessBenchmark,
    runCutoverReadinessBenchmarkFixtures,
} from "../../src/schedule/CutoverReadinessBenchmark.js";
import type { CutoverTelemetrySnapshot } from "../../src/schedule/CutoverReadinessGate.js";

const makeTelemetry = (
  overrides: Partial<CutoverTelemetrySnapshot> = {},
): CutoverTelemetrySnapshot => ({
  primaryRuns: 40,
  shadowRuns: 40,
  shadowFailures: 0,
  mismatchCategories: {
    true_regression: 0,
    expected_precision_improvement: 0,
    known_slot_minute_divergence: 0,
    comparator_tolerance_policy_gap: 0,
  },
  primaryP95Ms: 100,
  shadowP95Ms: 120,
  primaryRequestBuildP95Ms: 10,
  primaryEngineExecP95Ms: 60,
  primaryProjectionP95Ms: 15,
  shadowRequestBuildP95Ms: 12,
  shadowEngineExecP95Ms: 80,
  primaryRequestBuildRuns: 40,
  primaryEngineExecRuns: 40,
  primaryProjectionRuns: 40,
  shadowRequestBuildRuns: 40,
  shadowEngineExecRuns: 40,
  ...overrides,
});

describe("D9c cutover readiness benchmark harness", () => {
  it("passes when candidate regression is within budget and samples are sufficient", () => {
    const baseline = makeTelemetry();
    const candidate = makeTelemetry({
      primaryP95Ms: 108,
      shadowP95Ms: 130,
      primaryRequestBuildP95Ms: 11,
      primaryEngineExecP95Ms: 64,
      primaryProjectionP95Ms: 16,
      shadowRequestBuildP95Ms: 13,
      shadowEngineExecP95Ms: 86,
    });

    const report = evaluateCutoverReadinessBenchmark(baseline, candidate, {
      ...DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
      maxLatencyRegressionPct: 10,
      minRunsPerMetric: 30,
      maxShadowFailures: 0,
    });

    expect(report.overallPass).toBe(true);
    expect(report.latencyPass).toBe(true);
    expect(report.samplePass).toBe(true);
    expect(report.shadowFailurePass).toBe(true);
    expect(report.failingChecks).toEqual([]);
  });

  it("fails when any metric exceeds regression budget", () => {
    const baseline = makeTelemetry();
    const candidate = makeTelemetry({
      primaryEngineExecP95Ms: 75, // +25% regression from 60
    });

    const report = evaluateCutoverReadinessBenchmark(baseline, candidate, {
      ...DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
      maxLatencyRegressionPct: 10,
    });

    expect(report.overallPass).toBe(false);
    expect(report.metrics.primary_engine_exec.latencyPass).toBe(false);
    expect(report.failingChecks.some((check) => check.includes("primary_engine_exec"))).toBe(true);
  });

  it("fails when sample minimum is not met", () => {
    const baseline = makeTelemetry({
      primaryProjectionRuns: 10,
    });
    const candidate = makeTelemetry({
      primaryProjectionRuns: 20,
    });

    const report = evaluateCutoverReadinessBenchmark(baseline, candidate, {
      ...DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
      minRunsPerMetric: 30,
    });

    expect(report.overallPass).toBe(false);
    expect(report.metrics.primary_projection.samplePass).toBe(false);
    expect(report.samplePass).toBe(false);
  });

  it("fails when shadow failures exceed budget", () => {
    const baseline = makeTelemetry();
    const candidate = makeTelemetry({ shadowFailures: 1 });

    const report = evaluateCutoverReadinessBenchmark(baseline, candidate, {
      ...DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
      maxShadowFailures: 0,
    });

    expect(report.overallPass).toBe(false);
    expect(report.shadowFailurePass).toBe(false);
    expect(report.failingChecks.some((check) => check.includes("shadow_failures"))).toBe(true);
  });

  it("runs fixture batches and returns structured summary", () => {
    const fixtures = [
      {
        id: "pass-case",
        baseline: makeTelemetry(),
        candidate: makeTelemetry({ primaryP95Ms: 105 }),
      },
      {
        id: "fail-case",
        baseline: makeTelemetry(),
        candidate: makeTelemetry({ primaryP95Ms: 140 }),
      },
    ];

    const summary = runCutoverReadinessBenchmarkFixtures(fixtures, {
      ...DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
      maxLatencyRegressionPct: 10,
      minRunsPerMetric: 30,
      maxShadowFailures: 0,
    });

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.reports).toHaveLength(2);
    expect(summary.reports[0].id).toBe("pass-case");
  });
});
