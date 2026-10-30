import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askPerplexity, buildPerplexityBody, classifyPerplexityError, createCitationFilter, formatSources, parsePerplexityLine, sourcesOf } from "../src/brain/perplexity.ts";
import { ChatRouter, preferredProvider } from "../src/brain/router.ts";
import type { ChatEngine } from "../src/brain/router.ts";
import type { ChatEvent } from "../src/brain/events.ts";
import { loadConfig } from "../src/config.ts";
import { parseChatRequest } from "../src/api/chatRequest.ts";
import { renderHomePage } from "../src/views/homePage.ts";

const data = (value: unknown) => `data: ${JSON.stringify(value)}`;
const signal = () => new AbortController().signal;
async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const result: ChatEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
const fake = (events: ChatEvent[], calls: string[] = []): ChatEngine => ({ enabled: true, async *ask(message) { calls.push(message); yield* events; } });

test("reads the response ID, text deltas, completion and sources from the stream", () => {
  assert.deepEqual(parsePerplexityLine(data({ type: "response.created", response: { id: "resp_1" } })), { kind: "created", id: "resp_1" });
  assert.deepEqual(parsePerplexityLine(data({ type: "response.output_text.delta", delta: "Hello " })), { kind: "text", text: "Hello " });
  const done = parsePerplexityLine(data({ type: "response.completed", response: { id: "resp_1", output: [{ type: "message", content: [{ type: "output_text", text: "x", annotations: [{ title: "Doc", url: "https://example.com/a" }] }] }] } }));
  assert.deepEqual(done, { kind: "completed", id: "resp_1", sources: [{ title: "Doc", url: "https://example.com/a" }] });
});

test("ignores progress events, keep-alives and anything that isn't data", () => {
  for (const line of ["event: response.output_text.delta", "data: [DONE]", "data: {not json", data({ type: "response.reasoning.started" }), data({ type: "response.output_text.delta", delta: "" }), ""])
    assert.equal(parsePerplexityLine(line).kind, "ignore", line);
});

test("maps Perplexity's errors to quota, sign-in, or unavailable", () => {
  assert.equal(classifyPerplexityError(429, undefined), "quota");
  assert.equal(classifyPerplexityError(402, undefined), "quota", "an empty API balance");
  assert.equal(classifyPerplexityError(undefined, "insufficient_credits"), "quota");
  assert.equal(classifyPerplexityError(401, undefined), "authentication");
  assert.equal(classifyPerplexityError(403, "forbidden"), "authentication");
  assert.equal(classifyPerplexityError(500, undefined), "unavailable");
  assert.deepEqual(parsePerplexityLine(data({ type: "response.failed", response: { error: { code: "rate_limit_exceeded" } } })), { kind: "error", code: "quota" });
});

test("citation markers are removed even when a chunk splits them, and real brackets stay", () => {
  const filter = createCitationFilter();
  const out = filter.push("Kubernetes 1.40 shipped [1] and [web") + filter.push(":2]. See [the docs](https://k8s.io) and a[0].") + filter.flush();
  assert.equal(out, "Kubernetes 1.40 shipped  and . See [the docs](https://k8s.io) and a[0].");
  const open = createCitationFilter();
  assert.equal(open.push("ends with [") + open.flush(), "ends with [", "a lone bracket at the end is not lost");
});

test("sources: cited first, then search results, https only, no repeats, at most five", () => {
  const response = { output: [
    { type: "search_results", results: [{ title: "B", url: "https://b.example/" }, { title: "Plain", url: "http://insecure.example/" }, { title: "A", url: "https://a.example/" }] },
    { type: "message", content: [{ annotations: [{ title: "A", url: "https://a.example/" }, { url: "javascript:alert(1)" }, { title: "", url: "https://c.example/x" }] }] },
  ] };
  assert.deepEqual(sourcesOf(response).map(s => s.url), ["https://a.example/", "https://c.example/x", "https://b.example/"]);
  assert.equal(sourcesOf(response)[1]!.title, "c.example", "a missing title falls back to the host");
  assert.deepEqual(sourcesOf(undefined), []);
  const many = { output: [{ type: "search_results", results: Array.from({ length: 9 }, (_, i) => ({ title: "t" + i, url: `https://s${i}.example/` })) }] };
  assert.equal(sourcesOf(many).length, 5);
  assert.equal(formatSources([]), "");
  assert.match(formatSources([{ title: "A", url: "https://a.example/" }]), /^\n\nSources:\n1\. A - https:\/\/a\.example\/$/);
});

test("a conversation continues only when there is a previous response", () => {
  assert.equal("previous_response_id" in buildPerplexityBody("fast", "hi", "sys"), false);
  const body = buildPerplexityBody("fast", "hi", "sys", "resp_1");
  assert.equal(body.previous_response_id, "resp_1");
  assert.equal(body.stream, true);
  assert.equal(body.effort, "fast");
  assert.equal(body.instructions, "sys");
});

test("the engine is on only with an API key, and the effort setting is checked", () => {
  assert.equal(loadConfig({}).perplexity?.enabled, false);
  assert.equal(loadConfig({ PERPLEXITY_API_KEY: "pplx-test" }).perplexity?.enabled, true);
  assert.equal(loadConfig({ PERPLEXITY_API_KEY: "pplx-test", PERPLEXITY_ENABLED: "false" }).perplexity?.enabled, false);
  assert.equal(loadConfig({}).perplexity?.effort, "fast");
  assert.equal(loadConfig({ PERPLEXITY_EFFORT: "low" }).perplexity?.effort, "low");
  assert.equal(loadConfig({ PERPLEXITY_EFFORT: "x; rm -rf" }).perplexity?.effort, "fast");
  assert.equal(loadConfig({}).perplexity?.shareVault, false);
});

test("Perplexity is a selectable engine, disabled in the picker until it has a key", () => {
  assert.equal(parseChatRequest('{"message":"hi","provider":"perplexity"}').provider, "perplexity");
  assert.match(renderHomePage(loadConfig({})), /value="perplexity" disabled/);
  assert.doesNotMatch(renderHomePage(loadConfig({ PERPLEXITY_API_KEY: "k" })), /value="perplexity" disabled/);
});

test("Auto picks Perplexity only for live web questions", () => {
  assert.equal(preferredProvider("What's the latest news about Kubernetes?").provider, "perplexity");
  assert.equal(preferredProvider("Search the web for Network+ exam changes").provider, "perplexity");
  assert.equal(preferredProvider("Debug my TypeScript code").provider, "codex");
  assert.equal(preferredProvider("Apply to some jobs for me").provider, "claude");
  assert.notEqual(preferredProvider("What's on my calendar today?").provider, "perplexity");
});

test("when Perplexity is off Auto uses another engine, and it never stands in for an engine that failed", async () => {
  const claudeCalls: string[] = [];
  const off = new ChatRouter({ claude: fake([{ type: "text", text: "ok" }, { type: "done", sessionId: "11111111-2222-3333-4444-555555555555" }], claudeCalls), perplexity: { ...fake([]), enabled: false } });
  const result = await collect(off.answer({ message: "latest news about AWS", provider: "auto" }, signal()));
  assert.deepEqual(claudeCalls, ["latest news about AWS"]);
  assert.equal(result.at(-1)?.type, "done");

  const perplexityCalls: string[] = [];
  const failing = new ChatRouter({ claude: fake([{ type: "error", message: "usage limit" }]), codex: fake([{ type: "error", message: "quota" }]), perplexity: fake([{ type: "text", text: "x" }, { type: "done", sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }], perplexityCalls) });
  const refused = await collect(failing.answer({ message: "Rewrite my notes", provider: "auto" }, signal()));
  assert.equal(perplexityCalls.length, 0, "billed per request, so never a silent fallback");
  assert.equal(refused.at(-1)?.type, "error");
});

test("askPerplexity sends the key, streams clean text, appends sources, and remembers the thread", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-pplx-"));
  const real = globalThis.fetch;
  try {
    await writeFile(join(dir, "persona.md"), "You are Jarvis.");
    const memory = { bin: "claude", model: "opus", personaPath: join(dir, "persona.md"), workDir: dir, timeoutMs: 5000 };
    const config = { enabled: true, apiKey: "pplx-secret", effort: "fast", shareVault: false };
    const requests: { auth: string | null; body: Record<string, unknown> }[] = [];
    const sse = (events: unknown[]) => events.map(e => data(e) + "\n\n").join("");
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requests.push({ auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
      const id = "resp_" + requests.length;
      return new Response(sse([
        { type: "response.created", response: { id } },
        { type: "response.output_text.delta", delta: "Kubernetes is at 1.40 [web" },
        { type: "response.output_text.delta", delta: ":1]." },
        { type: "response.completed", response: { id, output: [{ type: "message", content: [{ annotations: [{ title: "K8s blog", url: "https://kubernetes.io/blog/" }] }] }] } },
      ]), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;

    const first = await collect(askPerplexity(config, memory, "latest kubernetes version?", undefined, signal()));
    const text = first.filter(e => e.type === "text").map(e => (e as { text: string }).text).join("");
    assert.equal(text, "Kubernetes is at 1.40 .\n\nSources:\n1. K8s blog - https://kubernetes.io/blog/");
    const done = first.at(-1) as { type: string; sessionId: string };
    assert.equal(done.type, "done");
    assert.equal(requests[0]!.auth, "Bearer pplx-secret");
    assert.equal(requests[0]!.body.stream, true);
    assert.equal("previous_response_id" in requests[0]!.body, false);
    assert.match(String(requests[0]!.body.instructions), /You are Jarvis\./);
    assert.match(String(requests[0]!.body.instructions), /can't see Eli's vault notes/, "nothing private is sent by default");

    await collect(askPerplexity(config, memory, "and the one before?", done.sessionId, signal()));
    assert.equal(requests[1]!.body.previous_response_id, "resp_1", "the follow-up continues the same thread");
  } finally { globalThis.fetch = real; await rm(dir, { recursive: true, force: true }); }
});

test("askPerplexity reports a refused key or an empty balance without leaking the key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-pplx-"));
  const real = globalThis.fetch;
  try {
    await writeFile(join(dir, "persona.md"), "You are Jarvis.");
    const memory = { bin: "claude", model: "opus", personaPath: join(dir, "persona.md"), workDir: dir, timeoutMs: 5000 };
    const config = { enabled: true, apiKey: "pplx-secret", effort: "fast", shareVault: false };
    for (const [status, code] of [[401, "authentication"], [402, "quota"], [500, "unavailable"]] as const) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "pplx-secret is bad", code: "x" } }), { status })) as typeof fetch;
      const events = await collect(askPerplexity(config, memory, "hi", undefined, signal()));
      const error = events.at(-1) as { type: string; code: string; message: string };
      assert.equal(error.type, "error");
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /pplx-secret/);
    }
  } finally { globalThis.fetch = real; await rm(dir, { recursive: true, force: true }); }
});
