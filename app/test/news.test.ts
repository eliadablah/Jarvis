import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, mergeNews, parseFeed, NEWS_SOURCES } from "../src/news/feeds.ts";
import { loadNews, resetNewsCache } from "../src/news/api.ts";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>
<item><title><![CDATA[Terraform 1.10 &amp; the new &#8220;stacks&#8221;]]></title><link>https://example.com/a</link><pubDate>Tue, 27 Oct 2026 14:00:00 GMT</pubDate></item>
<item><title>Older post</title><link>https://example.com/b</link><pubDate>Mon, 26 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Tue, 27 Oct 2026 15:00:00 GMT</pubDate></item>
<item><title>No date</title><link>https://example.com/c</link></item>
<item><link>https://example.com/d</link><pubDate>Tue, 27 Oct 2026 16:00:00 GMT</pubDate></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Kubernetes 1.34 released</title>
<link rel="self" href="https://example.org/self"/><link rel="alternate" href="https://example.org/k8s-134"/><updated>2026-10-28T08:30:00Z</updated></entry></feed>`;

test("RSS items are cleaned, dated, sorted, and unsafe or incomplete entries are dropped", () => {
  const items = parseFeed(RSS, "Blog");
  assert.deepEqual(items.map(i => i.url), ["https://example.com/a", "https://example.com/b"]);
  assert.equal(items[0]!.title, "Terraform 1.10 & the new “stacks”");
  assert.equal(items[0]!.at, "2026-10-27T14:00:00.000Z");
  assert.equal(items[0]!.source, "Blog");
});

test("Atom entries use the alternate link, not the self link", () => {
  const [item] = parseFeed(ATOM, "K8s");
  assert.equal(item!.url, "https://example.org/k8s-134");
  assert.equal(item!.at, "2026-10-28T08:30:00.000Z");
});

test("text cleaning strips tags and decodes entities", () => {
  assert.equal(cleanText("<b>Docker</b>  &amp;   <i>Compose</i> &nbsp;v2"), "Docker & Compose v2");
});

test("merging takes the newest few per source, removes duplicates and sorts newest first", () => {
  const mk = (source: string, hours: number[]) => hours.map(h => ({ title: `${source}${h}`, url: `https://x.test/${source}${h}`, source, at: new Date(Date.UTC(2026, 9, 28, 24 - h)).toISOString() }));
  const merged = mergeNews([mk("a", [1, 2, 3, 4, 5, 6]), mk("b", [1, 3]), [{ ...mk("a", [1])[0]!, source: "dup" }]], 3, 10);
  assert.equal(merged.filter(i => i.source === "a").length, 3);
  assert.equal(new Set(merged.map(i => i.url)).size, merged.length);
  assert.ok(merged.every((item, i) => i === 0 || Date.parse(merged[i - 1]!.at) >= Date.parse(item.at)));
});

test("a feed that is down is skipped and reported, and results are cached", async () => {
  resetNewsCache();
  let calls = 0;
  const fetcher = async (url: string) => {
    calls += 1;
    if (url === NEWS_SOURCES[1]!.url) throw new Error("down");
    return { ok: true, text: async () => RSS };
  };
  const first = await loadNews(fetcher, 1_000_000);
  assert.deepEqual(first.failed, [NEWS_SOURCES[1]!.name]);
  assert.ok(first.items.length > 0);
  const before = calls;
  await loadNews(fetcher, 1_000_000 + 60_000);
  assert.equal(calls, before, "served from cache within 30 minutes");
  resetNewsCache();
});

test("every feed address is https and fixed in code", () => {
  for (const source of NEWS_SOURCES) assert.match(source.url, /^https:\/\//);
});
