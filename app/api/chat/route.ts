import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { answerWithRag } from "@/lib/rag";
import { allowVisitor, allowSite } from "@/lib/ratelimit";
import type { Site } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  siteKey: z.string().hex().length(24),
  visitorId: z.string().min(8).max(64),
  message: z.string().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(20)
    .optional(),
});

const encoder = new TextEncoder();

export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request body" }, 400);
  const { siteKey, visitorId, message, history } = parsed.data;

  const { data: site } = await supabaseAdmin
    .from("sites")
    .select("*")
    .eq("site_key", siteKey)
    .single();
  if (!site) return json({ error: "Unknown site key" }, 404);

  // ---- rate limits: per visitor (bucket) and per site (durable hourly cap) --
  if (!allowVisitor(visitorId)) return json({ error: "Slow down a little 🙂" }, 429);
  const perHour = (site as unknown as Site).limits?.messages_per_hour_per_visitor ?? 30;
  if (!(await allowSite(site.id, perHour))) {
    await supabaseAdmin.from("events").insert({
      site_id: site.id,
      type: "fallback_rate_limited",
      visitor_id: visitorId,
    });
    return json({ error: "This widget has reached its hourly message limit." }, 429);
  }

  // ---- conversation bookkeeping (upsert; anonymous visitors only) ----------
  let conversationId: string;
  const { data: existing } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("site_id", site.id)
    .eq("visitor_id", visitorId)
    .single();

  if (existing) {
    conversationId = existing.id;
    await supabaseAdmin.from("conversations").update({ last_at: new Date().toISOString() }).eq("id", conversationId);
  } else {
    const { data: created } = await supabaseAdmin
      .from("conversations")
      .insert({ site_id: site.id, visitor_id: visitorId })
      .select("id")
      .single();
    if (!created) return json({ error: "Could not start conversation" }, 500);
    conversationId = created.id;
    await supabaseAdmin.from("events").insert({
      site_id: site.id,
      type: "conversation_started",
      visitor_id: visitorId,
    });
  }

  await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    site_id: site.id,
    role: "user",
    content: message,
  });

  // ---- SSE stream ----------------------------------------------------------
  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  const started = performance.now();
  let aggregated = "";

  const stream = new ReadableStream({
    async start(streamController) {
      const send = (payload: unknown) => streamController.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        const result = await answerWithRag({
          site: site as unknown as Site,
          question: message,
          history: history ?? [],
          signal: controller.signal,
          onToken: (delta) => {
            aggregated += delta;
            send({ delta });
          },
        });
        const latencyMs = Math.round(performance.now() - started);

        await supabaseAdmin.from("messages").insert({
          conversation_id: conversationId,
          site_id: site.id,
          role: "assistant",
          content: aggregated,
          sources: result.sources,
          latency_ms: latencyMs,
          model: result.model,
        });
        await supabaseAdmin.from("events").insert({
          site_id: site.id,
          type: "question_answered",
          payload: { latency_ms: latencyMs, model: result.model },
          visitor_id: visitorId,
        });

        send({ done: true, sources: result.sources });
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("[chat]", err);
          send({ error: "The assistant hit an error. Please retry." });
        }
      } finally {
        streamController.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  });
}

function json(body: unknown, status: number): Response {
  return new Response(
    JSON.stringify(body),
    { status, headers: { "content-type": "application/json" } },
  );
}
