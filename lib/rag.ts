/**
 * RAG pipeline: embed the question → match_chunks RPC → grounded prompt →
 * streamed answer. Sources (URLs) ride along so the UI can show citations.
 */
import { complete } from "./llm.js";
import { supabaseAdmin } from "./supabase.js";
import { embedTexts } from "./embeddings.js";
import type { Chunk, Site, Source } from "./types.js";

export async function retrieveContext(siteId: string, question: string, k = 5) {
  const { embeddings } = await embedTexts([question]);
  const embedding = embeddings[0];
  if (!embedding) throw new Error("embedding failed");

  const { data, error } = await supabaseAdmin.rpc("match_chunks", {
    p_site_id: siteId,
    p_embedding: embedding,
    p_k: k,
  });
  if (error) throw new Error(`match_chunks failed: ${error.message}`);
  return (data as Chunk[]).filter((c) => c.similarity >= 0.3);
}

interface AnswerArgs {
  site: Site;
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  onToken: (delta: string) => void;
  signal?: AbortSignal;
}

export interface AnswerResult {
  sources: Source[];
  answer: string;
  retrievalMs: number;
  firstTokenMs: number;
  model: string;
}

export async function answerWithRag(args: AnswerArgs): Promise<AnswerResult> {
  const retrievalStart = performance.now();
  const chunks = await retrieveContext(args.site.id, args.question);
  const retrievalMs = Math.round(performance.now() - retrievalStart);

  const context = chunks
    .map((c, i) => `[${i + 1}] (${c.url})\n${c.content}`)
    .join("\n\n---\n\n");

  let firstTokenMs = 0;
  const firstAt = performance.now();

  const system = buildSystemPrompt(args.site, context);

  const { text, provider } = await complete({
    signal: args.signal,
    temperature: args.site.limits.temperature ?? 0.2,
    maxTokens: 700,
    onToken: (delta) => {
      if (!firstTokenMs) firstTokenMs = Math.round(performance.now() - firstAt);
      args.onToken(delta);
    },
    messages: [
      { role: "system", content: system },
      // Trim history to the last 6 turns so token budgets stay predictable.
      ...args.history.slice(-6).map((m) => ({ role: m.role, content: m.content }) as const),
      { role: "user", content: args.question },
    ],
  });

  return {
    answer: text,
    sources: chunks.map((c) => ({ url: c.url, title: c.title })),
    retrievalMs,
    firstTokenMs,
    model: provider,
  };
}

function buildSystemPrompt(site: Site, context: string): string {
  const base = site.system_prompt ?? "You are a helpful support agent.";
  const grounded = context
    ? `Answer using ONLY the numbered context excerpts below. Cite like [1]. If the context does not contain the answer, say you don't know and suggest contacting support. Do not invent policies, prices or dates.

CONTEXT:
${context}`
    : "No context was retrieved. Answer briefly that you don't have information on this yet and suggest contacting support.";
  return `${base}\n\n${grounded}`;
}
