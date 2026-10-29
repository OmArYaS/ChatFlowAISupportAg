"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import { APP_URL } from "@/lib/app-url";

interface SiteRow {
  id: string;
  name: string;
  url: string;
  site_key: string;
  crawl_status: string;
}

interface SiteStats {
  conversations: number;
  questions_7d: number;
  avg_answer_ms: number | null;
  no_context_ratio: number;
}

/** Dashboard: manage sites, trigger crawls, grab the embed snippet. */
export default function DashboardClient({ userEmail }: { userEmail: string }) {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [stats, setStats] = useState<Record<string, SiteStats>>({});
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [snippet, setSnippet] = useState<{ site: SiteRow; code: string } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const { data, error } = await supabase.from("sites").select("*").order("created_at", { ascending: false });
    if (error) return setError(error.message);
    setSites((data ?? []) as SiteRow[]);

    const { data: statRows } = await supabase.from("site_stats").select("*");
    const map: Record<string, SiteStats> = {};
    for (const s of statRows ?? []) map[s.site_id] = s;
    setStats(map);
  }

  async function createSite(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return setError("Not signed in");

    const { error } = await supabase.from("sites").insert({
      name,
      url,
      owner_id: uid,
    });
    if (error) return setError(error.message);
    setName("");
    setUrl("");
    void load();
  }

  async function crawl(site: SiteRow) {
    setError("");
    const { data: token } = await supabase.auth.getSession();
    const jwt = token.session?.access_token;

    const res = await fetch("/api/crawl", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ siteId: site.id, startUrl: site.url }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Crawl failed");
    await load();
  }

  const embedCode = (s: SiteRow) =>
    `<script>\n  (function(){var d=document,s=d.createElement('script');\n  s.src='${APP_URL}/widget-loader.js';\n  s.async;s.dataset.site='${s.site_key}';\n  (d.body||d.head).appendChild(s)})();\n</script>`;

  return (
    <>
      <h1>Your sites</h1>
      {error && <p className="muted" style={{ color: "var(--danger)" }}>⚠ {error}</p>}

      <div className="panel" style={{ marginBottom: 26 }}>
        <form className="row" onSubmit={createSite}>
          <input placeholder="Site name" value={name} onChange={(e) => setName(e.target.value)} required style={{ flex: 1, minWidth: 180 }} />
          <input type="url" placeholder="https://yourapp.com" value={url} onChange={(e) => setUrl(e.target.value)} required style={{ flex: 1.4, minWidth: 240 }} />
          <button className="btn">Add site</button>
        </form>
      </div>

      {sites.length === 0 && <p className="muted">No sites yet — add one above.</p>}

      {sites.map((s) => {
        const st = stats[s.id];
        return (
          <div className="panel" key={s.id} style={{ marginBottom: 18 }}>
            <div className="site-row" style={{ borderBottom: "1px solid var(--border)", marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{s.name}</div>
                <a className="muted" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
              </div>
              <span className={`badge ${s.crawl_status}`}>{s.crawl_status}</span>
              <button className="btn small" onClick={() => void crawl(s)} disabled={s.crawl_status === "running"}>
                {s.crawl_status === "running" ? "Crawling…" : s.crawl_status === "done" ? "Re-crawl" : "Crawl & index"}
              </button>
              <button
                className="btn ghost small"
                onClick={() => setSnippet({ site: s, code: embedCode(s) })}
              >
                Embed code
              </button>
            </div>
            <div className="row muted">
              <span>💬 {st?.conversations ?? 0} conversations</span>
              <span>❓ {st?.questions_7d ?? 0} questions / 7d</span>
              <span>{st?.avg_answer_ms ? `⏱ avg ${(st.avg_answer_ms / 1000).toFixed(1)}s / answer` : ""}</span>
              <span>{st ? `🚫 ${(st.no_context_ratio * 100).toFixed(0)}% no-context answers` : ""}</span>
            </div>
          </div>
        );
      })}

      {snippet && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Embed “{snippet.site.name}”</h3>
          <p className="muted">Paste this before &lt;/body&gt; :</p>
          <div className="codeblock">{snippet.code}</div>
          <p className="muted" style={{ fontSize: 12 }}>
            Widget key: <code>{snippet.site.site_key}</code> — it&apos;s public by design; write
            access goes through server-side rate limits, not the key.
          </p>
          <button className="btn ghost small" onClick={() => setSnippet(null)}>Close</button>
        </div>
      )}
    </>
  );
}
