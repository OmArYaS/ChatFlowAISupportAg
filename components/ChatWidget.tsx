"use client";

import { useRef, useState } from "react";

export interface Source {
  url: string;
  title: string | null;
}

interface Turn {
  role: "user" | "bot";
  text: string;
  sources?: Source[];
}

const VISITOR_KEY = "chatflow_visitor_id";

function visitorId(): string {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

interface ChatWidgetProps {
  siteKey: string;
  origin?: string; // empty = same origin (the normal case)
  greeting?: string;
  agentName?: string;
}

/**
 * The chat surface rendered inside customer pages through an iframe.
 * Streams from /api/chat via SSE and renders citation links under each answer.
 */
export default function ChatWidget({
  siteKey,
  origin = "",
  greeting = "Hi! How can we help you today?",
  agentName = "Support",
}: ChatWidgetProps) {
  const [turns, setTurns] = useState<Turn[]>([{ role: "bot", text: greeting }]);
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const logRef = useRef<HTMLDivElement>(null);

  async function send(message: string) {
    if (!message.trim() || busy) return;

    setTurns((t) => [...t, { role: "user", text: message }, { role: "bot", text: "" }]);
    setBusy(true);
    scrollDown();

    try {
      const res = await fetch(`${origin}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          siteKey,
          visitorId: visitorId(),
          message,
          history: historyRef.current.slice(-6),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("Empty response");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let aggregated = "";
      let sources: Source[] | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: { delta?: string; done?: boolean; sources?: Source[]; error?: string };
          try {
            event = JSON.parse(line.slice(6)) as typeof event;
          } catch {
            continue; // frame split across reads
          }

          if (event.error) throw new Error(event.error);
          if (event.sources !== undefined) sources = event.sources;
          if (event.delta) {
            aggregated += event.delta;
            const delta = event.delta;
            setTurns((prev) => {
              const next = [...prev];
              const last = next.length - 1;
              if (next[last]?.role === "bot") {
                next[last] = { ...next[last], text: next[last].text + delta };
              }
              return next;
            });
            scrollDown();
          }
        }
      }

      historyRef.current.push({ role: "user", content: message });
      historyRef.current.push({ role: "assistant", content: aggregated });
      setTurns((prev) => {
        const next = [...prev];
        const last = next.length - 1;
        if (next[last]?.role === "bot") next[last] = { ...next[last], text: next[last].text, sources };
        return next;
      });
    } catch (err) {
      setTurns((prev) => {
        const next = [...prev];
        const last = next.length - 1;
        const msg = `⚠ ${(err as Error).message}`;
        if (next[last]?.role === "bot" && !next[last]?.text) next[last] = { role: "bot", text: msg };
        else next.push({ role: "bot", text: msg });
        return next;
      });
    } finally {
      setBusy(false);
      scrollDown();
    }
  }

  function scrollDown() {
    requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }));
  }

  return (
    <div className="w-root">
      <div className="w-header">
        {agentName}
        <div className="w-sub">Grounded in this site&apos;s content · sources are linked</div>
      </div>
      <div className="w-log" ref={logRef}>
        {turns.map((t, i) => (
          <div key={i}>
            <div className={`w-msg ${t.role}`}>{t.text || "…"}</div>
            {t.sources && t.sources.length > 0 && (
              <div className="w-sources" style={{ maxWidth: "86%" }}>
                {t.sources.slice(0, 3).map((s, si) => (
                  <a key={si} href={s.url} target="_blank" rel="noreferrer">
                    • {s.title || s.url}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        className="w-form"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement;
          const value = input.value;
          input.value = "";
          void send(value);
        }}
      >
        <input name="q" placeholder="Type your question…" disabled={busy} autoFocus />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
