import Link from "next/link";

export default function LandingPage() {
  return (
    <>
      <header className="header">
        <span className="logo">ChatFlow</span>
        <div className="spacer">
          <Link href="/dashboard" className="btn ghost small">Dashboard</Link>
        </div>
      </header>

      <main>
        <section className="hero">
          <h1>AI support agents for any website.</h1>
          <p>
            ChatFlow crawls your site, generates embeddings, and answers customer questions from your
            own content — grounded, cited, and streaming. One script tag to install.
          </p>
          <Link href="/dashboard" className="btn">Open the dashboard →</Link>
        </section>

        <div className="container">
          <div className="grid">
            <div className="feature">
              <h3>🗺️ Learns your site</h3>
              <p>
                A polite crawler respects robots.txt, stays on your origin, page-budget-capped, and
                chunks each page into ~500-word blocks embedded with OpenAI.
              </p>
            </div>
            <div className="feature">
              <h3>🔍 Answers with citations</h3>
              <p>
                Questions go through pgvector similarity search (match_chunks RPC) and the answer
                streams token-by-token, always grounded with [1], [2] citations.
              </p>
            </div>
            <div className="feature">
              <h3>🛡️ Built on Supabase</h3>
              <p>
                Conversations, messages, and analytics live in Postgres with Row Level Security —
                a site owner reads their data and nobody else&apos;s.
              </p>
            </div>
            <div className="feature">
              <h3>🔁 Provider fallbacks</h3>
              <p>
                Rate limits and 5xx errors transparently fail over between providers (OpenAI → Groq →
                OpenRouter) with retries — the customer just sees the typing indicator.
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
