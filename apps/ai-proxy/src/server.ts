import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MAX_AI_REQUEST_BYTES } from "../../web/src/services/aiPrompts.ts";
import { handleAiRunRequest } from "./route.ts";

const port = Number(process.env.AI_PROXY_PORT ?? 8787);

const server = createServer(async (req, res) => {
  try {
    await routeRequest(req, res);
  } catch (error) {
    writeJson(res, 500, { error: error instanceof Error ? error.message : "Unexpected proxy failure." });
  }
});

server.listen(port, () => {
  console.log(`AI proxy listening on http://127.0.0.1:${port}`);
});

async function routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!req.url) {
    writeJson(res, 400, { error: "Missing request URL." });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && req.url === "/api/ai/run") {
    const body = await readJsonBody(req, MAX_AI_REQUEST_BYTES);
    if (!body.ok) {
      writeJson(res, body.status, { error: body.error });
      return;
    }

    const result = await handleAiRunRequest(body.value, {
      openAiApiKey: process.env.OPENAI_API_KEY,
      openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      openAiBaseUrl: process.env.OPENAI_BASE_URL,
    });

    writeJson(res, result.status, result.body);
    return;
  }

  writeJson(res, 404, { error: "Route not found." });
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      return {
        ok: false,
        status: 413,
        error: `Request exceeds ${maxBytes} bytes.`,
      };
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") {
    return {
      ok: false,
      status: 400,
      error: "Request body is required.",
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(text) as unknown,
    };
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Request body must be valid JSON.",
    };
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
