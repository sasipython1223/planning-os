import type { CutoverTelemetrySnapshot } from "./CutoverReadinessGate.js";

export type CutoverBenchmarkMetricKey =
  | "primary_overall"
  | "shadow_overall"
  | "primary_request_build"
  | "primary_engine_exec"
  | "primary_projection"
  | "shadow_request_build"
  | "shadow_engine_exec";

type MetricDescriptor = {
  readonly p95Field:
    | "primaryP95Ms"
    | "shadowP95Ms"
    | "primaryRequestBuildP95Ms"
    | "primaryEngineExecP95Ms"
    | "primaryProjectionP95Ms"
    | "shadowRequestBuildP95Ms"
    | "shadowEngineExecP95Ms";
  readonly runsField:
    | "primaryRuns"
    | "shadowRuns"
    | "primaryRequestBuildRuns"
    | "primaryEngineExecRuns"
    | "primaryProjectionRuns"
    | "shadowRequestBuildRuns"
    | "shadowEngineExecRuns";
};

const METRIC_DESCRIPTORS: Record<CutoverBenchmarkMetricKey, MetricDescriptor> = {
  primary_overall: {
    p95Field: "primaryP95Ms",
    runsField: "primaryRuns",
  },
  shadow_overall: {
    p95Field: "shadowP95Ms",
    runsField: "shadowRuns",
  },
  primary_request_build: {
    p95Field: "primaryRequestBuildP95Ms",
    runsField: "primaryRequestBuildRuns",
  },
  primary_engine_exec: {
    p95Field: "primaryEngineExecP95Ms",
    runsField: "primaryEngineExecRuns",
  },
  primary_projection: {
    p95Field: "primaryProjectionP95Ms",
    runsField: "primaryProjectionRuns",
  },
  shadow_request_build: {
    p95Field: "shadowRequestBuildP95Ms",
    runsField: "shadowRequestBuildRuns",
  },
  shadow_engine_exec: {
    p95Field: "shadowEngineExecP95Ms",
    runsField: "shadowEngineExecRuns",
  },
};

export type CutoverBenchmarkThresholds = {
  readonly maxLatencyRegressionPct: number;
  readonly minRunsPerMetric: number;
  readonly maxShadowFailures: number;
};

export const DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS: CutoverBenchmarkThresholds = {
  maxLatencyRegressionPct: 10,
  minRunsPerMetric: 30,
  maxShadowFailures: 0,
};

export type CutoverBenchmarkMetricReport = {
  readonly key: CutoverBenchmarkMetricKey;
  readonly baselineP95Ms: number;
  readonly candidateP95Ms: number;
  readonly baselineRuns: number;
  readonly candidateRuns: number;
  readonly samplePass: boolean;
  readonly regressionPct: number;
  readonly budgetPct: number;
  readonly latencyPass: boolean;
  readonly pass: boolean;
};

export type CutoverReadinessBenchmarkReport = {
  readonly thresholds: CutoverBenchmarkThresholds;
  readonly latencyPass: boolean;
  readonly samplePass: boolean;
  readonly shadowFailurePass: boolean;
  readonly overallPass: boolean;
  readonly shadowFailure: {
    readonly observed: number;
    readonly maxAllowed: number;
    readonly pass: boolean;
  };
  readonly metrics: Readonly<Record<CutoverBenchmarkMetricKey, CutoverBenchmarkMetricReport>>;
  readonly failingChecks: readonly string[];
};

export type CutoverBenchmarkFixture = {
  readonly id: string;
  readonly baseline: CutoverTelemetrySnapshot;
  readonly candidate: CutoverTelemetrySnapshot;
};

export type CutoverBenchmarkRunSummary = {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly reports: ReadonlyArray<{
    readonly id: string;
    readonly report: CutoverReadinessBenchmarkReport;
  }>;
};

const computeRegressionPct = (baselineMs: number, candidateMs: number): number => {
  if (baselineMs <= 0) {
    return candidateMs <= 0 ? 0 : Number.POSITIVE_INFINITY;
  }

  return ((candidateMs - baselineMs) / baselineMs) * 100;
};

export const evaluateCutoverReadinessBenchmark = (
  baseline: CutoverTelemetrySnapshot,
  candidate: CutoverTelemetrySnapshot,
  thresholds: CutoverBenchmarkThresholds = DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
): CutoverReadinessBenchmarkReport => {
  const metricKeys = Object.keys(METRIC_DESCRIPTORS) as CutoverBenchmarkMetricKey[];
  const metrics = {} as Record<CutoverBenchmarkMetricKey, CutoverBenchmarkMetricReport>;

  for (const key of metricKeys) {
    const descriptor = METRIC_DESCRIPTORS[key];
    const baselineP95 = baseline[descriptor.p95Field] as number;
    const candidateP95 = candidate[descriptor.p95Field] as number;
    const baselineRuns = baseline[descriptor.runsField] as number;
    const candidateRuns = candidate[descriptor.runsField] as number;
    const samplePass =
      baselineRuns >= thresholds.minRunsPerMetric &&
      candidateRuns >= thresholds.minRunsPerMetric;
    const regressionPct = computeRegressionPct(baselineP95, candidateP95);
    const latencyPass = Number.isFinite(regressionPct)
      ? regressionPct <= thresholds.maxLatencyRegressionPct
      : false;

    metrics[key] = {
      key,
      baselineP95Ms: baselineP95,
      candidateP95Ms: candidateP95,
      baselineRuns,
      candidateRuns,
      samplePass,
      regressionPct,
      budgetPct: thresholds.maxLatencyRegressionPct,
      latencyPass,
      pass: samplePass && latencyPass,
    };
  }

  const samplePass = metricKeys.every((key) => metrics[key].samplePass);
  const latencyPass = metricKeys.every((key) => metrics[key].latencyPass);
  const shadowFailurePass = candidate.shadowFailures <= thresholds.maxShadowFailures;
  const failingChecks: string[] = [];

  for (const key of metricKeys) {
    if (!metrics[key].samplePass) {
      failingChecks.push(
        `${key}: insufficient samples baseline=${metrics[key].baselineRuns} candidate=${metrics[key].candidateRuns}`,
      );
    }
    if (!metrics[key].latencyPass) {
      failingChecks.push(
        `${key}: regression ${metrics[key].regressionPct.toFixed(2)}% exceeds budget ${metrics[key].budgetPct.toFixed(2)}%`,
      );
    }
  }

  if (!shadowFailurePass) {
    failingChecks.push(
      `shadow_failures: observed ${candidate.shadowFailures} exceeds budget ${thresholds.maxShadowFailures}`,
    );
  }

  return {
    thresholds,
    latencyPass,
    samplePass,
    shadowFailurePass,
    overallPass: samplePass && latencyPass && shadowFailurePass,
    shadowFailure: {
      observed: candidate.shadowFailures,
      maxAllowed: thresholds.maxShadowFailures,
      pass: shadowFailurePass,
    },
    metrics,
    failingChecks,
  };
};

export const runCutoverReadinessBenchmarkFixtures = (
  fixtures: readonly CutoverBenchmarkFixture[],
  thresholds: CutoverBenchmarkThresholds = DEFAULT_CUTOVER_BENCHMARK_THRESHOLDS,
): CutoverBenchmarkRunSummary => {
  const reports = fixtures.map((fixture) => ({
    id: fixture.id,
    report: evaluateCutoverReadinessBenchmark(fixture.baseline, fixture.candidate, thresholds),
  }));

  const passed = reports.filter((item) => item.report.overallPass).length;

  return {
    total: reports.length,
    passed,
    failed: reports.length - passed,
    reports,
  };
};
