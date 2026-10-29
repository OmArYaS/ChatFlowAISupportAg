"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";
import DashboardClient from "@/components/DashboardClient";

export default function DashboardPage() {
  const [session, setSession] = useState<null | { email: string }>(null);
  const [checking, setChecking] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ? { email: data.session.user.email ?? "" } : null);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s ? { email: s.user.email ?? "" } : null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  async function signUp() {
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signUp({ email, password });
    setError(error ? error.message : "Check your inbox to confirm, then sign in.");
    setBusy(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (checking) {
    return <main className="container"><p className="muted">Checking session…</p></main>;
  }

  if (!session) {
    return (
      <main className="container" style={{ maxWidth: 460 }}>
        <div className="panel stack">
          <h1 style={{ margin: 0 }}>Sign in</h1>
          <p className="muted" style={{ margin: 0 }}>
            Your sites, conversations and analytics — protected by Supabase Row Level Security.
          </p>
          {error && <p className="badge failed" style={{ alignSelf: "flex-start" }}>{error}</p>}
          <form className="stack" onSubmit={signIn}>
            <div>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: "100%" }} />
            </div>
            <div>
              <label htmlFor="password">Password</label>
              <input id="password" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: "100%" }} />
            </div>
            <div className="row">
              <button className="btn" disabled={busy} type="submit">Sign in</button>
              <button className="btn ghost" disabled={busy} type="button" onClick={signUp}>Register</button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <>
      <header className="header">
        <span className="logo">ChatFlow</span>
        <div className="spacer">
          <span className="muted">{session.email}</span>
          <button className="btn ghost small" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="container">
        <DashboardClient userEmail={session.email} />
      </main>
    </>
  );
}
