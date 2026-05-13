import type { AIScheduleSnapshot } from "./scheduleSnapshot.ts";

export type AIFeature =
  | "health-review"
  | "management-summary"
  | "ask-schedule"
  | "suggestions";

export type AIPromptTemplate = {
  readonly system: string;
  readonly user: string;
};

export type AIRequestSnapshot = AIScheduleSnapshot & {
  readonly advisoryOnly: true;
  readonly truncated: boolean;
  readonly includedTaskCount: number;
  readonly includedDependencyCount: number;
};

export const MAX_AI_REQUEST_BYTES = 128 * 1024;
export const MAX_AI_QUESTION_LENGTH = 500;

const FEATURE_LIMITS: Record<
  AIFeature,
  {
    readonly tasks: number;
    readonly dependencies: number;
    readonly wbsSummary: number;
    readonly milestones: number;
    readonly criticalTasks: number;
    readonly constrainedTasks: number;
    readonly missingLogicCandidates: number;
    readonly longDurationCandidates: number;
    readonly diagnosticsSummary: number;
  }
> = {
  "health-review": {
    tasks: 300,
    dependencies: 300,
    wbsSummary: 120,
    milestones: 100,
    criticalTasks: 120,
    constrainedTasks: 120,
    missingLogicCandidates: 150,
    longDurationCandidates: 120,
    diagnosticsSummary: 120,
  },
  "management-summary": {
    tasks: 120,
    dependencies: 120,
    wbsSummary: 80,
    milestones: 60,
    criticalTasks: 80,
    constrainedTasks: 60,
    missingLogicCandidates: 80,
    longDurationCandidates: 60,
    diagnosticsSummary: 60,
  },
  "ask-schedule": {
    tasks: 350,
    dependencies: 700,
    wbsSummary: 120,
    milestones: 80,
    criticalTasks: 100,
    constrainedTasks: 100,
    missingLogicCandidates: 120,
    longDurationCandidates: 100,
    diagnosticsSummary: 100,
  },
  suggestions: {
    tasks: 200,
    dependencies: 200,
    wbsSummary: 120,
    milestones: 80,
    criticalTasks: 120,
    constrainedTasks: 120,
    missingLogicCandidates: 150,
    longDurationCandidates: 120,
    diagnosticsSummary: 120,
  },
};

const COMMON_SYSTEM_RULES = [
  "You are an advisory planning assistant for Planner-Studio.",
  "You must answer only from the provided schedule snapshot.",
  "If information is not present in the snapshot, say that it is not available in the current snapshot.",
  "Do not claim to access live worker state, persistence, imports, external systems, or hidden data.",
  "Do not mutate the schedule and do not propose commands, patches, API calls, or apply flows.",
  "Output advisory analysis text only.",
];

export function normalizeAiQuestion(question: string | undefined): string | undefined {
  const trimmed = question?.trim();
  return trimmed ? trimmed : undefined;
}

export function prepareSnapshotForFeature(
  snapshot: AIScheduleSnapshot,
  feature: AIFeature,
): AIRequestSnapshot {
  const limits = FEATURE_LIMITS[feature];
  const trimmed: AIRequestSnapshot = {
    ...snapshot,
    tasks: snapshot.tasks.slice(0, limits.tasks),
    dependencies: snapshot.dependencies.slice(0, limits.dependencies),
    wbsSummary: snapshot.wbsSummary.slice(0, limits.wbsSummary),
    milestones: snapshot.milestones.slice(0, limits.milestones),
    criticalTasks: snapshot.criticalTasks.slice(0, limits.criticalTasks),
    constrainedTasks: snapshot.constrainedTasks.slice(0, limits.constrainedTasks),
    missingLogicCandidates: snapshot.missingLogicCandidates.slice(0, limits.missingLogicCandidates),
    longDurationCandidates: snapshot.longDurationCandidates.slice(0, limits.longDurationCandidates),
    diagnosticsSummary: snapshot.diagnosticsSummary.slice(0, limits.diagnosticsSummary),
    advisoryOnly: true,
    truncated: false,
    includedTaskCount: Math.min(snapshot.tasks.length, limits.tasks),
    includedDependencyCount: Math.min(snapshot.dependencies.length, limits.dependencies),
  };

  const truncated =
    trimmed.tasks.length !== snapshot.tasks.length ||
    trimmed.dependencies.length !== snapshot.dependencies.length ||
    trimmed.wbsSummary.length !== snapshot.wbsSummary.length ||
    trimmed.milestones.length !== snapshot.milestones.length ||
    trimmed.criticalTasks.length !== snapshot.criticalTasks.length ||
    trimmed.constrainedTasks.length !== snapshot.constrainedTasks.length ||
    trimmed.missingLogicCandidates.length !== snapshot.missingLogicCandidates.length ||
    trimmed.longDurationCandidates.length !== snapshot.longDurationCandidates.length ||
    trimmed.diagnosticsSummary.length !== snapshot.diagnosticsSummary.length;

  return {
    ...trimmed,
    truncated,
  };
}

export function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function buildPromptTemplate(
  feature: AIFeature,
  snapshot: AIRequestSnapshot,
  question?: string,
): AIPromptTemplate {
  const system = COMMON_SYSTEM_RULES.join(" ");
  const serializedSnapshot = JSON.stringify(snapshot, null, 2);

  switch (feature) {
    case "health-review":
      return {
        system,
        user: [
          "Feature: AI Schedule Health Review.",
          "Summarize schedule condition, identify critical and near-critical risks, missing logic, constraints, suspicious long durations, and WBS risk areas.",
          "Use short section headings: Summary, Critical Path, Missing Logic, Constraints, Long Durations, WBS Risk Areas.",
          "Keep the response advisory only.",
          "Snapshot:",
          serializedSnapshot,
        ].join("\n\n"),
      };
    case "management-summary":
      return {
        system,
        user: [
          "Feature: AI Management Summary.",
          "Write an executive-friendly summary using Problem / Impact / Action format.",
          "Include milestone status and critical path summary.",
          "Do not use internal implementation language.",
          "Keep the response advisory only.",
          "Snapshot:",
          serializedSnapshot,
        ].join("\n\n"),
      };
    case "ask-schedule":
      return {
        system,
        user: [
          "Feature: Ask the Schedule.",
          "Answer the user's question using only the snapshot.",
          "If the snapshot does not contain the answer, say: not available in current snapshot.",
          `User question: ${question ?? ""}`,
          "Snapshot:",
          serializedSnapshot,
        ].join("\n\n"),
      };
    case "suggestions":
      return {
        system,
        user: [
          "Feature: Advisory Suggestions.",
          "Generate advisory-only suggestions with rationale.",
          "Do not instruct the system to apply changes and do not output commands.",
          "Use a numbered list. Each item must be suggestion plus rationale only.",
          "Snapshot:",
          serializedSnapshot,
        ].join("\n\n"),
      };
  }
}

export function buildMockAiResponse(
  feature: AIFeature,
  snapshot: AIScheduleSnapshot,
  question?: string,
): string {
  switch (feature) {
    case "health-review":
      return buildMockHealthReview(snapshot);
    case "management-summary":
      return buildMockManagementSummary(snapshot);
    case "ask-schedule":
      return buildMockAskSchedule(snapshot, question ?? "");
    case "suggestions":
      return buildMockSuggestions(snapshot);
  }
}

function buildMockHealthReview(snapshot: AIScheduleSnapshot): string {
  const lines: string[] = [];
  lines.push("## Schedule Health Review");
  lines.push(`Project start: ${snapshot.projectStartDate}`);
  lines.push("");
  lines.push("### Summary");
  lines.push(
    `Schedule contains ${snapshot.taskCount} tasks and ${snapshot.dependencyCount} dependencies. ${snapshot.scheduledCount} tasks have computed schedule dates.`,
  );
  lines.push("");
  lines.push("### Critical Path");
  if (snapshot.criticalCount === 0) {
    lines.push("No critical tasks identified. Schedule may be unlinked or unscheduled.");
  } else {
    lines.push(`${snapshot.criticalCount} critical task(s) on the critical path.`);
    for (const task of snapshot.criticalTasks.filter((item) => item.isCritical).slice(0, 5)) {
      lines.push(`- ${task.name} (${task.wbsCode})`);
    }
  }
  lines.push("");
  lines.push("### Missing Logic");
  if (snapshot.missingLogicCandidates.length === 0) {
    lines.push("No open-ended activities detected.");
  } else {
    lines.push(`${snapshot.missingLogicCandidates.length} activity/activities have open predecessor or successor logic.`);
  }
  lines.push("");
  lines.push("### Constraints");
  if (snapshot.constrainedTasks.length === 0) {
    lines.push("No hard date constraints detected.");
  } else {
    lines.push(`${snapshot.constrainedTasks.length} constrained task(s) are present.`);
  }
  lines.push("");
  lines.push("### Long Durations");
  if (snapshot.longDurationCandidates.length === 0) {
    lines.push("No unusually long activities detected.");
  } else {
    lines.push(`${snapshot.longDurationCandidates.length} long-duration activity/activities exceed 20 working days.`);
  }
  lines.push("");
  lines.push("### WBS Risk Areas");
  if (snapshot.wbsSummary.length === 0) {
    lines.push("No WBS summary rows available.");
  } else {
    lines.push(`WBS summary covers ${snapshot.wbsSummary.length} area(s).`);
  }
  lines.push("");
  lines.push("Advisory only. Review with the planner before acting.");
  return lines.join("\n");
}

function buildMockManagementSummary(snapshot: AIScheduleSnapshot): string {
  const lines: string[] = [];
  lines.push("## Management Summary");
  lines.push(`Project start: ${snapshot.projectStartDate}`);
  lines.push("");
  lines.push("### Problem");
  if (snapshot.scheduledCount === 0) {
    lines.push("The project schedule has not been computed. No schedule dates or critical path are available.");
  } else {
    lines.push(
      `${snapshot.scheduledCount} of ${snapshot.taskCount} activities are scheduled, and ${snapshot.criticalCount} are currently critical.`,
    );
  }
  lines.push("");
  lines.push("### Impact");
  lines.push(`${snapshot.milestones.length} milestone(s) and ${snapshot.wbsSummary.length} WBS area(s) are represented in the current snapshot.`);
  lines.push("");
  lines.push("### Action");
  if (
    snapshot.missingLogicCandidates.length === 0 &&
    snapshot.longDurationCandidates.length === 0 &&
    snapshot.diagnosticsSummary.length === 0
  ) {
    lines.push("No immediate corrective action is indicated from the current snapshot. Continue monitoring.");
  } else {
    if (snapshot.missingLogicCandidates.length > 0) {
      lines.push(`- Review ${snapshot.missingLogicCandidates.length} open-ended activity/activities.`);
    }
    if (snapshot.longDurationCandidates.length > 0) {
      lines.push(`- Review ${snapshot.longDurationCandidates.length} long-duration activity/activities for decomposition.`);
    }
    if (snapshot.diagnosticsSummary.length > 0) {
      lines.push(`- Review ${snapshot.diagnosticsSummary.length} activity/activities with diagnostics.`);
    }
  }
  lines.push("");
  lines.push("Advisory only. Validate before distribution.");
  return lines.join("\n");
}

function buildMockAskSchedule(snapshot: AIScheduleSnapshot, question: string): string {
  const normalized = question.trim().toLowerCase();
  if (normalized.includes("critical")) {
    return `There are ${snapshot.criticalCount} critical task(s) in the current snapshot.`;
  }
  if (normalized.includes("milestone")) {
    return `There are ${snapshot.milestones.length} milestone(s) in the current snapshot.`;
  }
  if (normalized.includes("constraint")) {
    return `There are ${snapshot.constrainedTasks.length} constrained task(s) in the current snapshot.`;
  }
  if (normalized.includes("logic")) {
    return `There are ${snapshot.missingLogicCandidates.length} open-ended activity/activities in the current snapshot.`;
  }
  return (
    `I can answer schedule questions from the current snapshot (${snapshot.taskCount} tasks, ` +
    `${snapshot.dependencyCount} dependencies, project start ${snapshot.projectStartDate}).`
  );
}

function buildMockSuggestions(snapshot: AIScheduleSnapshot): string {
  const lines: string[] = [];
  lines.push("## Advisory Suggestions");
  let count = 0;
  if (snapshot.missingLogicCandidates.length > 0) {
    count += 1;
    lines.push(`${count}. Review open-ended activities. ${snapshot.missingLogicCandidates.length} activity/activities have missing predecessor or successor logic.`);
  }
  if (snapshot.longDurationCandidates.length > 0) {
    count += 1;
    lines.push(`${count}. Review long-duration activities. ${snapshot.longDurationCandidates.length} activity/activities exceed 20 working days.`);
  }
  if (snapshot.diagnosticsSummary.length > 0) {
    count += 1;
    lines.push(`${count}. Review diagnostics. ${snapshot.diagnosticsSummary.length} activity/activities have active diagnostic codes.`);
  }
  if (count === 0) {
    lines.push("No significant advisory items identified from the current snapshot.");
  }
  lines.push("");
  lines.push("Advisory only. No changes have been applied.");
  return lines.join("\n");
}
