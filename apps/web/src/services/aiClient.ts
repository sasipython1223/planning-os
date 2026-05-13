import {
    MAX_AI_QUESTION_LENGTH,
    MAX_AI_REQUEST_BYTES,
    estimateJsonBytes,
    normalizeAiQuestion,
    prepareSnapshotForFeature,
    type AIFeature,
    type AIRequestSnapshot,
} from "./aiPrompts";
import type { AIScheduleSnapshot } from "./scheduleSnapshot";

export type AIServiceResponse = {
  readonly content: string;
  readonly model?: string;
  readonly warnings: readonly string[];
  readonly truncated: boolean;
  readonly mode: "live";
};

export type RunAiFeatureInput = {
  readonly feature: AIFeature;
  readonly snapshot: AIScheduleSnapshot;
  readonly question?: string;
  readonly signal?: AbortSignal;
};

export class AIServiceError extends Error {
  readonly code:
    | "REQUEST_TOO_LARGE"
    | "INVALID_QUESTION"
    | "INVALID_RESPONSE"
    | "SERVICE_UNAVAILABLE"
    | "NETWORK_ERROR"
    | "UNKNOWN";
  readonly status?: number;

  constructor(
    code: AIServiceError["code"],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "AIServiceError";
    this.code = code;
    this.status = status;
  }
}

type AiRunRequestBody = {
  readonly feature: AIFeature;
  readonly snapshot: AIRequestSnapshot;
  readonly question?: string;
};

type AiRunResponseBody = {
  readonly content?: string;
  readonly model?: string;
  readonly warnings?: readonly string[];
  readonly truncated?: boolean;
  readonly error?: string;
};

const AI_ENDPOINT = "/api/ai/run";
const MINIMUM_COMPRESSED_TASKS = 25;
const MINIMUM_COMPRESSED_DEPENDENCIES = 25;
const SNAPSHOT_ARRAY_KEYS = [
  "tasks",
  "dependencies",
  "wbsSummary",
  "milestones",
  "criticalTasks",
  "constrainedTasks",
  "missingLogicCandidates",
  "longDurationCandidates",
  "diagnosticsSummary",
] as const;

export async function runAiFeature(input: RunAiFeatureInput): Promise<AIServiceResponse> {
  const normalizedQuestion = normalizeAiQuestion(input.question);
  if (input.feature === "ask-schedule") {
    if (!normalizedQuestion) {
      throw new AIServiceError("INVALID_QUESTION", "Ask the Schedule requires a question.");
    }
    if (normalizedQuestion.length > MAX_AI_QUESTION_LENGTH) {
      throw new AIServiceError(
        "INVALID_QUESTION",
        `Question exceeds ${MAX_AI_QUESTION_LENGTH} characters.`,
      );
    }
  }

  const body = fitRequestBodyToSize({
    feature: input.feature,
    snapshot: input.snapshot,
    question: normalizedQuestion,
  });

  let response: Response;
  try {
    response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new AIServiceError(
      "NETWORK_ERROR",
      "Unable to reach the AI proxy service.",
    );
  }

  const responseBody = (await safeParseJson(response)) as AiRunResponseBody | null;
  if (!response.ok) {
    const message = responseBody?.error ?? defaultProxyErrorMessage(response.status);
    throw new AIServiceError(
      response.status === 503 ? "SERVICE_UNAVAILABLE" : "UNKNOWN",
      message,
      response.status,
    );
  }

  if (!responseBody || typeof responseBody.content !== "string" || responseBody.content.trim() === "") {
    throw new AIServiceError(
      "INVALID_RESPONSE",
      "AI proxy returned an invalid response payload.",
      response.status,
    );
  }

  return {
    content: responseBody.content,
    model: responseBody.model,
    warnings: responseBody.warnings ?? [],
    truncated: responseBody.truncated ?? body.snapshot.truncated,
    mode: "live",
  };
}

export function buildAiRunRequestBody(
  feature: AIFeature,
  snapshot: AIScheduleSnapshot,
  question?: string,
): AiRunRequestBody {
  const normalizedQuestion = normalizeAiQuestion(question);
  const preparedSnapshot = prepareSnapshotForFeature(snapshot, feature);
  return {
    feature,
    snapshot: preparedSnapshot,
    ...(normalizedQuestion ? { question: normalizedQuestion } : {}),
  };
}

function fitRequestBodyToSize(
  input: Omit<RunAiFeatureInput, "signal">,
): AiRunRequestBody {
  let body = buildAiRunRequestBody(input.feature, input.snapshot, input.question);
  if (estimateJsonBytes(body) <= MAX_AI_REQUEST_BYTES) {
    return body;
  }

  let nextSnapshot = body.snapshot;
  while (
    estimateJsonBytes({ ...body, snapshot: nextSnapshot }) > MAX_AI_REQUEST_BYTES
  ) {
    const reducedSnapshot = reduceSnapshotArrays(nextSnapshot);
    if (reducedSnapshot === null) {
      break;
    }
    nextSnapshot = reducedSnapshot;
  }

  body = {
    ...body,
    snapshot: nextSnapshot,
  };

  if (estimateJsonBytes(body) > MAX_AI_REQUEST_BYTES) {
    throw new AIServiceError(
      "REQUEST_TOO_LARGE",
      `AI request exceeds ${MAX_AI_REQUEST_BYTES} bytes after client-side trimming.`,
    );
  }

  return body;
}

function reduceSnapshotArrays(snapshot: AIRequestSnapshot): AIRequestSnapshot | null {
  const overrides: Partial<Record<(typeof SNAPSHOT_ARRAY_KEYS)[number], readonly unknown[]>> = {};

  for (const key of SNAPSHOT_ARRAY_KEYS) {
    const minimum =
      key === "tasks"
        ? MINIMUM_COMPRESSED_TASKS
        : key === "dependencies"
          ? MINIMUM_COMPRESSED_DEPENDENCIES
          : 0;
    const current = snapshot[key];
    if (current.length <= minimum) {
      continue;
    }

    const targetLength = Math.max(minimum, Math.floor(current.length / 2));
    if (targetLength >= current.length) {
      continue;
    }

    overrides[key] = current.slice(0, targetLength);
  }

  if (Object.keys(overrides).length === 0) {
    return null;
  }

  const next: AIRequestSnapshot = {
    ...snapshot,
    ...(overrides as Pick<AIRequestSnapshot, (typeof SNAPSHOT_ARRAY_KEYS)[number]>),
  };

  const nextTaskLen = next.tasks.length;
  const nextDepLen = next.dependencies.length;

  return {
    ...next,
    includedTaskCount: Math.min(snapshot.includedTaskCount, nextTaskLen),
    includedDependencyCount: Math.min(snapshot.includedDependencyCount, nextDepLen),
    truncated: true,
  };
}

async function safeParseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function defaultProxyErrorMessage(status: number): string {
  if (status === 500) {
    return "AI proxy request failed. The proxy or provider may be unavailable. Check the ai-proxy server logs.";
  }
  if (status === 502) {
    return "AI provider request failed. Check ai-proxy logs for upstream details.";
  }
  if (status === 503) {
    return "AI proxy is not configured. Set OPENAI_API_KEY in apps/ai-proxy/.env.";
  }
  return `AI proxy request failed with status ${status}.`;
}
