/**
 * Local LLM transport — Ollama only. No cloud calls, no API key, no telemetry.
 *
 * Everything in this file talks to http://127.0.0.1:11434 (override with
 * OLLAMA_HOST). If that host is unreachable the app degrades to the
 * rule-based scorer in scorer.ts rather than breaking the demo.
 *
 * Structured output is enforced with Ollama's `format` parameter, which accepts
 * a JSON Schema on Ollama >= 0.5 and constrains decoding to valid JSON. Older
 * builds accept `format: "json"`; we detect a schema rejection and retry with
 * the string form, then fall back to prompt-only JSON with a repair pass.
 */

export const OLLAMA_HOST =
  process.env.OLLAMA_HOST?.replace(/\/$/, "") ?? "http://127.0.0.1:11434";

/**
 * Default is the Llama 3.1 8B *Instruct* build — on Ollama the bare `llama3.1:8b`
 * tag IS the instruct-tuned model, which is why the tag has no `-instruct`
 * suffix. Swap via OLLAMA_MODEL (see README for stronger / medical-tuned options).
 */
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";

/** Per-request ceiling. Local 8B models on CPU can be slow; be generous. */
export const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 90_000);

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: false;
  format?: unknown;
  options?: Record<string, unknown>;
  keep_alive?: string;
}

export interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

export class OllamaRequestError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
    this.name = "OllamaRequestError";
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new OllamaUnavailableError(
        `Ollama did not respond within ${Math.round(timeoutMs / 1000)}s at ${OLLAMA_HOST}`,
        err,
      );
    }
    throw new OllamaUnavailableError(
      `Cannot reach Ollama at ${OLLAMA_HOST}. Is \`ollama serve\` running?`,
      err,
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface OllamaStatus {
  reachable: boolean;
  host: string;
  configuredModel: string;
  modelInstalled: boolean;
  installedModels: string[];
  error: string | null;
}

export async function checkOllama(): Promise<OllamaStatus> {
  const base: OllamaStatus = {
    reachable: false,
    host: OLLAMA_HOST,
    configuredModel: OLLAMA_MODEL,
    modelInstalled: false,
    installedModels: [],
    error: null,
  };
  try {
    const res = await fetchWithTimeout(`${OLLAMA_HOST}/api/tags`, { method: "GET" }, 4000);
    if (!res.ok) {
      return { ...base, error: `Ollama returned HTTP ${res.status} from /api/tags` };
    }
    const json = (await res.json()) as { models?: { name: string }[] };
    const names = (json.models ?? []).map((m) => m.name);
    // `ollama pull llama3.1` registers the tag as "llama3.1:latest", and a
    // request for the bare name resolves to it — so compare with :latest filled in.
    const want = OLLAMA_MODEL.includes(":") ? OLLAMA_MODEL : `${OLLAMA_MODEL}:latest`;
    return {
      ...base,
      reachable: true,
      installedModels: names,
      modelInstalled: names.some(
        (n) => (n.includes(":") ? n : `${n}:latest`) === want,
      ),
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function ollamaChat(req: OllamaChatRequest): Promise<OllamaChatResponse> {
  const res = await fetchWithTimeout(
    `${OLLAMA_HOST}/api/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    },
    OLLAMA_TIMEOUT_MS,
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OllamaRequestError(
      `Ollama /api/chat failed with HTTP ${res.status}`,
      res.status,
      body,
    );
  }
  return (await res.json()) as OllamaChatResponse;
}

/**
 * Pull the first balanced JSON object out of a model response.
 * Handles the two things small local models do constantly: wrapping JSON in
 * ```json fences, and prefixing it with a sentence of chat.
 */
export function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const haystack = fenced ? fenced[1] : text;

  const start = haystack.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i += 1) {
    const ch = haystack[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}
