import type { AIPromptTemplate } from "../../web/src/services/aiPrompts.ts";

export type OpenAICompletionRequest = {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: AIPromptTemplate;
  readonly baseUrl?: string;
};

export type OpenAICompletionResponse = {
  readonly content: string;
  readonly model: string;
};

export class OpenAIProxyError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenAIProxyError";
    this.status = status;
  }
}

export async function runOpenAICompletion(
  request: OpenAICompletionRequest,
): Promise<OpenAICompletionResponse> {
  const response = await fetch(`${request.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: request.prompt.system },
        { role: "user", content: request.prompt.user },
      ],
    }),
  });

  const payload = (await safeParseJson(response)) as
    | {
        readonly error?: { readonly message?: string };
        readonly model?: string;
        readonly choices?: ReadonlyArray<{
          readonly message?: {
            readonly content?: string | ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
          };
        }>;
      }
    | null;

  if (!response.ok) {
    throw new OpenAIProxyError(
      payload?.error?.message ?? `OpenAI request failed with status ${response.status}.`,
      response.status,
    );
  }

  const content = extractMessageContent(payload?.choices?.[0]?.message?.content);
  if (!content) {
    throw new OpenAIProxyError("OpenAI response did not contain message content.", 502);
  }

  return {
    content,
    model: payload?.model ?? request.model,
  };
}

function extractMessageContent(
  content: string | ReadonlyArray<{ readonly type?: string; readonly text?: string }> | undefined,
): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
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
