import {
    MAX_AI_QUESTION_LENGTH,
    type AIFeature,
    type AIRequestSnapshot,
} from "../../web/src/services/aiPrompts.ts";

export type AiRunRequest = {
  readonly feature: AIFeature;
  readonly snapshot: AIRequestSnapshot;
  readonly question?: string;
};

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly error: string };

export function validateAiRunRequest(body: unknown): ValidationResult<AiRunRequest> {
  if (!isRecord(body)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object." };
  }

  if (!isAIFeature(body.feature)) {
    return { ok: false, status: 400, error: "Unsupported AI feature." };
  }

  if (!isAIRequestSnapshot(body.snapshot)) {
    return { ok: false, status: 400, error: "Invalid AI snapshot payload." };
  }

  if (body.feature === "ask-schedule") {
    if (typeof body.question !== "string" || body.question.trim() === "") {
      return { ok: false, status: 400, error: "Ask the Schedule requires a question." };
    }
    if (body.question.trim().length > MAX_AI_QUESTION_LENGTH) {
      return {
        ok: false,
        status: 400,
        error: `Question exceeds ${MAX_AI_QUESTION_LENGTH} characters.`,
      };
    }
  }

  return {
    ok: true,
    value: {
      feature: body.feature,
      snapshot: body.snapshot,
      ...(typeof body.question === "string" ? { question: body.question.trim() } : {}),
    },
  };
}

function isAIFeature(value: unknown): value is AIFeature {
  return value === "health-review" || value === "management-summary" || value === "ask-schedule" || value === "suggestions";
}

function isAIRequestSnapshot(value: unknown): value is AIRequestSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.projectStartDate === "string" &&
    typeof value.taskCount === "number" &&
    typeof value.dependencyCount === "number" &&
    typeof value.scheduledCount === "number" &&
    typeof value.criticalCount === "number" &&
    Array.isArray(value.tasks) &&
    Array.isArray(value.dependencies) &&
    Array.isArray(value.wbsSummary) &&
    Array.isArray(value.milestones) &&
    Array.isArray(value.criticalTasks) &&
    Array.isArray(value.constrainedTasks) &&
    Array.isArray(value.missingLogicCandidates) &&
    Array.isArray(value.longDurationCandidates) &&
    Array.isArray(value.diagnosticsSummary) &&
    value.advisoryOnly === true &&
    typeof value.truncated === "boolean" &&
    typeof value.includedTaskCount === "number" &&
    typeof value.includedDependencyCount === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
