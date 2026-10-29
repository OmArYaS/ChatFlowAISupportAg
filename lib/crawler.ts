/**
 * Polite site crawler: same-origin BFS, robots.txt respected, page budget
 * enforced, main-content extracted (scripts/styles/nav trimmed), chunked to
 * ~500 words with overlaps of one paragraph.
 */
import { embedTexts, EMBEDDING_DIMENSIONS } from "./embeddings.js";

const CHUNK_WORDS = 500;

interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export interface CrawlProgress {
  pagesCrawled: number;
  chunksIndexed: number;
  skipped: number;
}

/** Crawl up to `maxPages` pages starting at `startUrl`, then index their text. */
export async function crawlAndIndex(
  siteId: string,
  startUrl: string,
  maxPages: number,
  onPage: (page: CrawledPage, index: number) => Promise<void>,
  onProgress?: (p: CrawlProgress) => void,
): Promise<CrawlProgress> {
  const origin = new URL(startUrl).origin;
  const disallow = await loadRobotRules(origin);

  const queue = [startUrl];
  const seen = new Set<string>();
  const progress: CrawlProgress = { pagesCrawled: 0, chunksIndexed: 0, skipped: 0 };

  while (queue.length > 0 && progress.pagesCrawled < maxPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    if (robotDisallows(disallow, url)) {
      progress.skipped++;
      continue;
    }

    const page = await fetchPage(url);
    if (!page) {
      progress.skipped++;
      continue;
    }

    await onPage(page, progress.pagesCrawled);
    progress.pagesCrawled++;
    onProgress?.({ ...progress });

    for (const link of extractLinks(page.text === "" ? "" : page.bodyHtml, origin)) {
      if (seen.size + queue.length < maxPages * 3) queue.push(link);
    }
  }
  return progress;
}

interface RobotRules {
  generic: string[];
}

async function loadRobotRules(origin: string): Promise<RobotRules> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { generic: [] };
    const text = await res.text();
    let currentAgentApplies = false;
    const generic: string[] = [];

    for (const line of text.split("\n")) {
      const l = line.split("#")[0].trim().toLowerCase();
      if (l.startsWith("user-agent:")) {
        const agent = l.slice(11).trim();
        currentAgentApplies = agent === "*";
      } else if (l.startsWith("disallow:") && currentAgentApplies) {
        const path = l.slice(9).trim();
        if (path) generic.push(path);
      }
    }
    return { generic };
  } catch {
    return { generic: [] };
  }
}

function robotDisallows(rules: RobotRules, url: string): boolean {
  const path = new URL(url).pathname;
  return rules.generic.some((rule) => path.startsWith(rule));
}

async function fetchPage(url: string): Promise<(CrawledPage & { bodyHtml: string }) | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "ChatFlowBot/1.0 (+https://chatflow.example/bot)" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) return null;

    const html = await res.text();
    return { url, title: extractTitle(html), text: extractText(html), bodyHtml: html };
  } catch {
    return null;
  }
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim().slice(0, 200) : "";
}

/** Very small DOM-free extractor: strips script/style/nav/footer, converts <p> to newlines. */
export function extractText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export function extractLinks(html: string, origin: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="([^"#]+)"/gi)) {
    try {
      const url = new URL(m[1], origin);
      if (url.origin === origin && !/\.(jpg|jpeg|png|gif|css|js|pdf|zip|mp4)$/i.test(url.pathname)) {
        out.add(url.toString().replace(/\?.*$/, ""));
      }
    } catch {
      /* relative junk */
    }
  }
  return [...out];
}

/** Greedy sliding window of paragraphs sized ≈ CHUNK_WORDS words. */
export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let words = 0;

  for (const p of paragraphs) {
    const pWords = p.split(/\s+/).length;
    if (words + pWords > CHUNK_WORDS && current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [p];
      words = pWords;
    } else {
      current.push(p);
      words += pWords;
    }
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks.slice(0, 200); // cap so one huge site can't flood the embedding budget
}

export { EMBEDDING_DIMENSIONS, embedTexts };
