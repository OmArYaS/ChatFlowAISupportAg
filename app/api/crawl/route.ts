import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { crawlAndIndex, chunkText, embedTexts } from "@/lib/crawler";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  siteId: z.string().uuid(),
  startUrl: z.string().url().optional(), // defaults to the site's own URL
});

/**
 * POST /api/crawl { siteId, startUrl? }
 * Dashboard-only. Verifies the caller's Supabase JWT, checks site ownership,
 * then crawls the site's origin, chunks page text, embeds it and upserts chunks.
 */
export async function POST(req: Request): Promise<Response> {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  // Ownership: verify the caller's Supabase JWT and match the site's owner.
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: site } = await supabaseAdmin
    .from("sites")
    .select("id, owner_id, url, limits")
    .eq("id", body.data.siteId)
    .eq("owner_id", userId)
    .single();
  if (!site) return Response.json({ error: "Site not found" }, { status: 404 });

  const origin = new URL(site.url).origin;
  const start = new URL(body.data.startUrl ?? site.url);
  if (start.origin !== origin) {
    return Response.json({ error: "startUrl must match the site's origin" }, { status: 400 });
  }

  try {
    await supabaseAdmin.from("sites").update({ crawl_status: "running" }).eq("id", site.id);

    const progress = await crawlAndIndex(
      site.id,
      start.toString(),
      (site.limits as { pages_max?: number } | null)?.pages_max ?? 20,
      // one page at a time keeps memory and API bill bounded
      async (page) => {
        const { data: pageRow } = await supabaseAdmin
          .from("pages")
          .upsert({ site_id: site.id, url: page.url, title: page.title }, { onConflict: "site_id,url" })
          .select("id")
          .single();

        if (!pageRow) throw new Error(`could not persist page ${page.url}`);

        // idempotent re-crawl: stale chunks for this page are replaced
        await supabaseAdmin.from("chunks").delete().eq("page_id", pageRow.id);

        const texts = chunkText(page.text);
        if (texts.length === 0) return;

        const { embeddings } = await embedTexts(texts);
        await supabaseAdmin.from("chunks").insert(
          embeddings.map((embedding, i) => ({
            site_id: site.id,
            page_id: pageRow.id,
            content: texts[i],
            embedding: `[${embedding.join(",")}]`, // pgvector text form
          })),
        );
      },
    );

    await supabaseAdmin.from("sites").update({ crawl_status: "done" }).eq("id", site.id);
    return Response.json({ ok: true, progress });
  } catch (err) {
    await supabaseAdmin.from("sites").update({ crawl_status: "failed" }).eq("id", site.id);
    console.error("[crawl]", err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
