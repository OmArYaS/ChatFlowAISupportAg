/**
 * Multi-provider LLM layer.
 *
 * - Providers are tried in order (openai → groq → openrouter). A 429 or 5xx
 *   moves to the next provider instead of failing the user's question.
 * - Streaming and non-streaming share one code path.
 * - Retries: per provider, exponential backoff on transport errors only.
 */
import { z } from "zod";

export interface ChatMessagePayload {
  role: "system" | "user" | "assistant";
  content: string;
}

interface Provider {
  name: string;
  apiKey?: string;
  baseUrl: string;
  model: string;
}

const providers: Provider[] = [
  {
    name: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    name: "groq",
    apiKey: process.env.GROQ_API_KEY,
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.1-8b-instant",
  },
  {
    name: "openrouter",
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-flash-1.5",
  },
].filter((p) => Boolean(p.apiKey));

export function availableProviders(): string[] {
  return providers.map((p) => p.name);
}

export interface CompletionOptions {
  messages: ChatMessagePayload[];
  maxTokens?: number;
  temperature?: number;
  onToken?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  provider: string;
}

export async function complete(opts: CompletionOptions): Promise<CompletionResult> {
  if (providers.length === 0) throw new Error("No LLM API keys configured");

  let lastError: unknown;
  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { provider: provider.name, text: await callProvider(provider, opts) };
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        lastError = err;
        if (err instanceof ProviderSwitch) break; // 429/5xx → next provider
        const retryable = !(err instanceof HttpError);
        if (!retryable) break;
        await sleep(500 * 2 ** attempt);
      }
    }
  }
  throw lastError ?? new Error("All LLM providers failed");
}

class HttpError extends Error {
  constructor(public status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}
class ProviderSwitch extends Error {}

async function callProvider(provider: Provider, opts: CompletionOptions): Promise<string> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 700,
      temperature: opts.temperature ?? 0.2,
      stream: Boolean(opts.onToken),
    }),
  });

  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) throw new ProviderSwitch(`provider ${provider.name} ${res.status}`);
    throw new HttpError(res.status, await res.text());
  }

  if (!opts.onToken) {
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? "";
  }
  return streamSse(res, opts.onToken);
}

const frameRegex = /data: (.+?)(?:\n\n|\r\n\r\n)/g;

async function streamSse(res: Response, onToken: (delta: string) => void): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    for (const match of [...buffer.matchAll(frameRegex)]) {
      const payload = match[1].trim();
      if (payload === "[DONE]") return full;
      try {
        const obj = chunkSchema.parse(JSON.parse(payload));
        const delta = obj.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        /* frame split across chunks — the remainder arrives next read; unmatched tail stays in buffer */
      }
    }
    buffer = buffer.slice(buffer.lastIndexOf("data: "));
  }
  return full;
}

const chunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.object({ content: z.string().optional() }).passthrough().optional(),
    }).passthrough(),
  ).min(1),
}).passthrough();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
