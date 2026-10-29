// GET /api/news: headlines from the fixed feeds in feeds.ts, cached for 30
// minutes. If a feed is down it is skipped; if everything fails the last good
// copy is served. The browser never supplies an address to fetch.

import type { IncomingMessage, ServerResponse } from "node:http";
import { appHeaders } from "../http/securityHeaders.ts";
import { NEWS_SOURCES, mergeNews, parseFeed, type NewsItem } from "./feeds.ts";

const CACHE_MS = 30 * 60_000;
const MAX_FEED_CHARS = 1_500_000;
type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; text(): Promise<string> }>;
interface NewsResult { items: NewsItem[]; updatedAt: string; failed: string[]; }

let cache: { at: number; value: NewsResult } | undefined;
let inFlight: Promise<NewsResult> | undefined;

/** Reads every feed in parallel (6 s each). Exported so tests can pass a fake fetcher. */
export async function loadNews(fetcher: Fetcher = fetch as unknown as Fetcher, now = Date.now()): Promise<NewsResult> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  inFlight ??= (async () => {
    const failed: string[] = [];
    const lists = await Promise.all(NEWS_SOURCES.map(async source => {
      try {
        const response = await fetcher(source.url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Jarvis/1.0 (personal dashboard)", Accept: "application/rss+xml, application/atom+xml, text/xml" } });
        if (!response.ok) throw new Error("bad status");
        return parseFeed((await response.text()).slice(0, MAX_FEED_CHARS), source.name);
      } catch { failed.push(source.name); return []; }
    }));
    const items = mergeNews(lists);
    // Keep showing the last good headlines rather than an empty card when everything failed.
    if (!items.length && cache) return { ...cache.value, failed };
    const value = { items, updatedAt: new Date(now).toISOString(), failed };
    if (items.length) cache = { at: now, value };
    return value;
  })().finally(() => { inFlight = undefined; });
  return inFlight;
}

export function resetNewsCache(): void { cache = undefined; inFlight = undefined; }

export async function handleNews(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = (status: number, body: unknown) => { res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  if (req.method !== "GET" && req.method !== "HEAD") { send(405, { error: "Method not allowed" }); return; }
  try { send(200, await loadNews()); } catch { send(502, { error: "News is unavailable right now." }); }
}
