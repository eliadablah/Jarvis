// Tech news: the feed list and a small RSS/Atom reader. Pure functions, so they
// can be tested without the network. Feeds are fixed in code, never taken from a
// request, so the server only ever fetches addresses chosen here.

export interface NewsItem { title: string; url: string; source: string; at: string; }
export interface NewsSource { name: string; url: string; }

export const NEWS_SOURCES: NewsSource[] = [
  { name: "Hacker News", url: "https://hnrss.org/frontpage?points=150" },
  { name: "AWS News", url: "https://aws.amazon.com/blogs/aws/feed/" },
  { name: "Kubernetes", url: "https://kubernetes.io/feed.xml" },
  { name: "Docker", url: "https://www.docker.com/blog/feed/" },
  { name: "HashiCorp", url: "https://www.hashicorp.com/blog/feed.xml" },
  { name: "The New Stack", url: "https://thenewstack.io/feed/" },
  { name: "GitHub", url: "https://github.blog/feed/" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
];

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };

/** Turns feed text into plain text: unwraps CDATA, drops tags, decodes entities, collapses spaces. */
export function cleanText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, " ").trim();
}

/** The first element called `name` inside `block`, or undefined. */
function element(block: string, name: string): string | undefined {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1];
}

/** RSS puts the address in <link>text</link>; Atom in <link href="..."/>. */
function linkOf(block: string): string | undefined {
  const atom = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map(m => m[1]!).find(a => /href=/i.test(a) && !/rel=["'](?:self|enclosure|replies)["']/i.test(a));
  const href = atom ? /href=["']([^"']+)["']/i.exec(atom)?.[1] : undefined;
  const text = element(block, "link");
  const value = cleanText(href ?? text ?? "");
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined; } catch { return undefined; }
}

/** The newest `limit` stories in a feed. Entries without a title, a web link or a valid date are skipped. */
export function parseFeed(xml: string, source: string, limit = 8): NewsItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const items: NewsItem[] = [];
  for (const block of blocks) {
    const title = cleanText(element(block, "title") ?? "").slice(0, 200);
    const url = linkOf(block);
    const when = Date.parse(cleanText(element(block, "pubDate") ?? element(block, "published") ?? element(block, "updated") ?? element(block, "dc:date") ?? ""));
    if (!title || !url || Number.isNaN(when)) continue;
    items.push({ title, url, source, at: new Date(when).toISOString() });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

/** Newest few from every source, so one busy feed can't crowd out the rest, newest first overall. */
export function mergeNews(lists: NewsItem[][], perSource = 4, total = 24): NewsItem[] {
  const seen = new Set<string>();
  return lists.flatMap(list => list.slice(0, perSource))
    .filter(item => !seen.has(item.url) && !!seen.add(item.url))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, total);
}
