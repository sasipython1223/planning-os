import {
    buildPromptTemplate,
    type AIPromptTemplate,
} from "../../web/src/services/aiPrompts.ts";
import {
    OpenAIProxyError,
    runOpenAICompletion,
    type OpenAICompletionResponse,
} from "./openaiClient.ts";
import { validateAiRunRequest } from "./validation.ts";

export type AiProxyEnv = {
  readonly openAiApiKey?: string;
  readonly openAiModel: string;
  readonly openAiBaseUrl?: string;
};

export type AiRouteResponse = {
  readonly status: number;
  readonly body: {
    readonly content?: string;
    readonly model?: string;
    readonly warnings?: readonly string[];
    readonly truncated?: boolean;
    readonly error?: string;
  };
};

export type OpenAITransport = (request: {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: AIPromptTemplate;
  readonly baseUrl?: string;
}) => Promise<OpenAICompletionResponse>;

export async function handleAiRunRequest(
  body: unknown,
  env: AiProxyEnv,
  transport: OpenAITransport = runOpenAICompletion,
): Promise<AiRouteResponse> {
  const validation = validateAiRunRequest(body);
  if (!validation.ok) {
    return {
      status: validation.status,
      body: { error: validation.error },
    };
  }

  if (!env.openAiApiKey) {
    return {
      status: 503,
      body: { error: "AI proxy is not configured. Set OPENAI_API_KEY on the backend." },
    };
  }

  try {
    const prompt = buildPromptTemplate(
      validation.value.feature,
      validation.value.snapshot,
      validation.value.question,
    );
    const completion = await transport({
      apiKey: env.openAiApiKey,
      model: env.openAiModel,
      prompt,
      baseUrl: env.openAiBaseUrl,
    });

    return {
      status: 200,
      body: {
        content: completion.content,
        model: completion.model,
        truncated: validation.value.snapshot.truncated,
        warnings: validation.value.snapshot.truncated
          ? ["Snapshot was trimmed by client-side guardrails before AI evaluation."]
          : [],
      },
    };
  } catch (error) {
    if (error instanceof OpenAIProxyError) {
      return {
        status: error.status >= 400 && error.status < 500 ? error.status : 502,
        body: { error: error.message },
      };
    }
    return {
      status: 502,
      body: { error: "AI proxy failed to complete the request." },
    };
  }
}
