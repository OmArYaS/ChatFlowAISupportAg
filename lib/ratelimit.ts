/**
 * Two-layer rate limiting for chat endpoints:
 *  1. per-visitor token bucket (in-memory; single-instance deployment)
 *  2. per-site hourly budget backed by Supabase message counts (durable,
 *     survives restarts and multiple instances share it via the database)
 */
import { supabaseAdmin } from "./supabase.js";

const visitors = new Map<string, { tokens: number; updatedAt: number }>();
const VISITOR_RATE = 20 / 60_000; // tokens per ms: 20 per minute

export function allowVisitor(visitorId: string, burst = 8): boolean {
  const now = Date.now();
  const b = visitors.get(visitorId) ?? { tokens: burst, updatedAt: now };
  const tokens = Math.min(burst, b.tokens + (now - b.updatedAt) * VISITOR_RATE) - 1;
  visitors.set(visitorId, { tokens, updatedAt: now });

  // opportunistic cleanup so the map can't grow unbounded
  if (visitors.size > 5000) {
    for (const [id, s] of visitors) {
      if (now - s.updatedAt > 3_600_000) visitors.delete(id);
    }
  }
  return tokens >= 0;
}

export async function allowSite(siteId: string, hourlyCap: number): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .eq("role", "user")
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());

  if (error) {
    console.error("[ratelimit] count failed, allowing (fail-open)", error.message);
    return true;
  }
  return (count ?? 0) < hourlyCap;
}

export interface RateLimitDecision {
  allowed: boolean;
  reason?: "visitor" | "site";
}
