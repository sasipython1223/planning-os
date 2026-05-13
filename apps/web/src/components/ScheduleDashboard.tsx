/**
 * ScheduleDashboard — D.2
 *
 * Read-only schedule health dashboard.
 * Derives all metrics from the AIScheduleSnapshot — no worker contact,
 * no command dispatch, no mutations, no API calls.
 */

import { MINUTES_PER_DAY } from "@planner/protocol";
import type { AIScheduleSnapshot } from "../services/scheduleSnapshot";
import { formatDateISO, projectDate } from "../utils/dateProjection";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleDashboardProps {
  snapshot: AIScheduleSnapshot | null;
}

type FloatBucket = {
  readonly label: string;
  readonly count: number;
  readonly color: string;
};

// ─── Derivations (pure, no CPM re-computation) ────────────────────────────────

export function deriveProjectFinish(snapshot: AIScheduleSnapshot): string | null {
  let maxMinutes = -Infinity;
  for (const task of snapshot.tasks) {
    if (!task.isSummary && task.earlyFinishMinutes !== null && task.earlyFinishMinutes > maxMinutes) {
      maxMinutes = task.earlyFinishMinutes;
    }
  }
  if (maxMinutes === -Infinity) return null;
  const dayOffset = Math.floor(maxMinutes / MINUTES_PER_DAY);
  return formatDateISO(projectDate(snapshot.projectStartDate, dayOffset));
}

export function deriveFloatBuckets(snapshot: AIScheduleSnapshot): FloatBucket[] {
  const D = MINUTES_PER_DAY;
  const raw: Array<{ label: string; min: number; max: number; color: string; count: number }> = [
    { label: "Critical (0d)", min: 0, max: 0, color: "#d32f2f", count: 0 },
    { label: "≤2d", min: 1, max: 2 * D, color: "#f57c00", count: 0 },
    { label: "≤5d", min: 2 * D + 1, max: 5 * D, color: "#fbc02d", count: 0 },
    { label: "≤10d", min: 5 * D + 1, max: 10 * D, color: "#7cb342", count: 0 },
    { label: "≤20d", min: 10 * D + 1, max: 20 * D, color: "#1976d2", count: 0 },
    { label: ">20d", min: 20 * D + 1, max: Infinity, color: "#388e3c", count: 0 },
    { label: "Unscheduled", min: -Infinity, max: -Infinity, color: "#9e9e9e", count: 0 },
  ];

  for (const task of snapshot.tasks) {
    if (task.isSummary) continue;
    if (task.totalFloatMinutes === null) {
      raw[6].count++;
      continue;
    }
    const f = task.totalFloatMinutes;
    for (let i = 0; i < raw.length - 1; i++) {
      if (f >= raw[i].min && f <= raw[i].max) {
        raw[i].count++;
        break;
      }
    }
  }

  return raw.filter((b) => b.count > 0).map(({ label, count, color }) => ({ label, count, color }));
}

export function deriveNearCriticalCount(snapshot: AIScheduleSnapshot): number {
  return snapshot.criticalTasks.filter((t) => !t.isCritical).length;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  accent,
  note,
}: {
  label: string;
  value: string | number;
  accent?: string;
  note?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "6px 10px",
        borderRadius: 4,
        border: "1px solid var(--border-default, #ddd)",
        background: "var(--bg-primary, #fff)",
        minWidth: 90,
        flex: "1 1 90px",
        boxSizing: "border-box",
      }}
    >
      <span style={{ fontSize: "0.72em", color: "var(--color-text-secondary, #777)", lineHeight: 1.2, whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: "1.45em",
          fontWeight: 700,
          color: accent ?? "var(--color-text-primary, #111)",
          lineHeight: 1.2,
          marginTop: 2,
        }}
      >
        {value}
      </span>
      {note && (
        <span style={{ fontSize: "0.68em", color: "var(--color-text-secondary, #999)", marginTop: 1 }}>
          {note}
        </span>
      )}
    </div>
  );
}

function FloatBar({ buckets, total }: { buckets: readonly FloatBucket[]; total: number }) {
  if (total === 0 || buckets.length === 0) return null;
  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 10,
          borderRadius: 3,
          overflow: "hidden",
          border: "1px solid var(--border-default, #ddd)",
          marginBottom: 4,
        }}
      >
        {buckets.map((b) => (
          <div
            key={b.label}
            style={{
              width: `${(b.count / total) * 100}%`,
              background: b.color,
              minWidth: b.count > 0 ? 2 : 0,
            }}
            title={`${b.label}: ${b.count}`}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
        {buckets.map((b) => (
          <span key={b.label} style={{ fontSize: "0.70em", color: "var(--color-text-secondary, #555)", whiteSpace: "nowrap" }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: b.color,
                marginRight: 3,
                verticalAlign: "middle",
              }}
            />
            {b.label}: {b.count}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScheduleDashboard({ snapshot }: ScheduleDashboardProps) {
  if (!snapshot || snapshot.taskCount === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--color-text-secondary, #999)",
          fontFamily: "Arial, sans-serif",
          fontSize: "0.82em",
          fontStyle: "italic",
        }}
      >
        No schedule data to display.
      </div>
    );
  }

  const finish = deriveProjectFinish(snapshot);
  const floatBuckets = deriveFloatBuckets(snapshot);
  const nearCritical = deriveNearCriticalCount(snapshot);

  // Total non-summary leaf count for float distribution denominator
  const leafCount = snapshot.tasks.filter((t) => !t.isSummary).length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "8px 12px",
        overflow: "auto",
        height: "100%",
        fontFamily: "Arial, sans-serif",
        fontSize: "0.82em",
        boxSizing: "border-box",
      }}
    >
      {/* ── Metric cards row ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <MetricCard label="Activities" value={snapshot.taskCount} />
        <MetricCard label="Scheduled" value={snapshot.scheduledCount} />
        <MetricCard
          label="Critical"
          value={snapshot.criticalCount}
          accent={snapshot.criticalCount > 0 ? "#d32f2f" : undefined}
        />
        <MetricCard
          label="Near-critical"
          value={nearCritical}
          accent={nearCritical > 0 ? "#f57c00" : undefined}
        />
        <MetricCard label="Milestones" value={snapshot.milestones.length} />
        <MetricCard
          label="Missing logic"
          value={snapshot.missingLogicCandidates.length}
          accent={snapshot.missingLogicCandidates.length > 0 ? "#f57c00" : undefined}
        />
        <MetricCard
          label="Constrained"
          value={snapshot.constrainedTasks.length}
        />
        <MetricCard
          label="Long duration"
          value={snapshot.longDurationCandidates.length}
          accent={snapshot.longDurationCandidates.length > 0 ? "#f57c00" : undefined}
        />
        <MetricCard
          label="Diagnostics"
          value={snapshot.diagnosticsSummary.length}
          accent={snapshot.diagnosticsSummary.length > 0 ? "#c62828" : undefined}
        />
        <MetricCard label="Dependencies" value={snapshot.dependencyCount} />
        <MetricCard label="WBS areas" value={snapshot.wbsSummary.length} />
      </div>

      {/* ── Schedule dates ── */}
      <div style={{ display: "flex", gap: 6 }}>
        <MetricCard label="Project start" value={snapshot.projectStartDate} />
        {finish !== null && <MetricCard label="Early finish" value={finish} />}
      </div>

      {/* ── Float distribution ── */}
      {leafCount > 0 && (
        <div
          style={{
            padding: "6px 10px",
            border: "1px solid var(--border-default, #ddd)",
            borderRadius: 4,
            background: "var(--bg-primary, #fff)",
          }}
        >
          <div
            style={{
              fontSize: "0.72em",
              color: "var(--color-text-secondary, #777)",
              marginBottom: 5,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Float distribution — {leafCount} leaf activities
          </div>
          <FloatBar buckets={floatBuckets} total={leafCount} />
        </div>
      )}

      {/* ── Advisory notice ── */}
      <div
        style={{
          fontSize: "0.68em",
          color: "var(--color-text-secondary, #aaa)",
          fontStyle: "italic",
          paddingBottom: 4,
        }}
      >
        Advisory display only. Data reflects current scheduler state — no schedule changes are made here.
      </div>
    </div>
  );
}
