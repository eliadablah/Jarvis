// Tests for the quick lane: opening a link or an app runs next to a long task instead of waiting behind it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parsePcIntent, safeLink } from "../app/src/pcTasks/intent.ts";
import { resolvePcCommand } from "../app/src/pcTasks/commands.ts";
import { emptyReport, type ExecutorStatus } from "../app/src/pcTasks/protocol.ts";
import { enqueuePcTask, claimNextPcTask, finishPcTask, pcSnapshot } from "../app/src/pcTasks/store.ts";
import { agentStatuses } from "./agents.ts";
import { quickPass } from "./worker.ts";
import type { LocalState } from "./persistence.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/1ZmuYTwQOtk-A09bLGyGi6QlfR18OfTduacYHVA8uLUk/edit";
const clock = new Date("2026-10-30T12:00:00Z");
const worker: ExecutorStatus[] = [
  { id: "claude-chrome", capabilities: ["jobs", "browser"], features: ["job-files-v1", "task-sync-v1", "full-tools-v2"], state: "ready", reason: "", remainingTokens: null },
  { id: "windows", capabilities: ["desktop.launch"], features: ["quick-lane-v1"], state: "ready", reason: "", remainingTokens: null },
];
async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-quick-test-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("only plain https links to a real host are opened", () => {
  assert.equal(safeLink(SHEET), SHEET);
  assert.equal(safeLink(SHEET + "."), SHEET, "a sentence's full stop is not part of the link");
  for (const bad of ["http://example.com/a", "https://user:pass@example.com/", "https://127.0.0.1/admin", "https://localhost/", "https://example.com:8443/", "javascript:alert(1)", "https://" + "a".repeat(600) + ".com"])
    assert.equal(safeLink(bad), undefined, bad);
});

test("an open-link request becomes a desktop plan that the worker can re-check", () => {
  const intent = parsePcIntent("Open this link on my PC: " + SHEET);
  assert.deepEqual(intent, { type: "task", plan: { kind: "desktop", action: "open_url", url: SHEET } });
  assert.notEqual(parsePcIntent("Open this link on my PC: http://example.com/")?.type, "task", "plain http is never opened by the quick lane");
  assert.equal(parsePcIntent("Open this link on my PC: https://user:pw@example.com/")?.type, "clarify");
});

test("asking to open a link or the job tracker goes to the quick lane, not to an agent", () => {
  const withUrl = resolvePcCommand("go ahead and open my job tracker Google Sheet at " + SHEET);
  assert.equal(withUrl?.intent.type, "task");
  assert.deepEqual(withUrl?.intent.type === "task" && withUrl.intent.plan, { kind: "desktop", action: "open_url", url: SHEET });
  for (const phrase of ["show me my job tracker", "open my job tracker", "take me to my application tracker sheet"]) {
    const tracker = resolvePcCommand(phrase, undefined, { tracker: SHEET });
    assert.deepEqual(tracker?.intent.type === "task" && tracker.intent.plan, { kind: "desktop", action: "open_url", url: SHEET }, phrase);
  }
  // Without a known sheet, or when the request does more than open a page, it still needs an agent.
  assert.notDeepEqual(resolvePcCommand("show me my job tracker")?.intent.type === "task" && (resolvePcCommand("show me my job tracker")!.intent as { plan: { kind: string } }).plan.kind, "desktop");
  const more = resolvePcCommand("open " + SHEET + " and then update the first row");
  assert.equal(more?.intent.type === "task" && more.intent.plan.kind, "browser");
  const http = resolvePcCommand("open http://example.com/page");
  assert.equal(http?.intent.type === "task" && http.intent.plan.kind, "browser");
});

test("a quick task is claimed while a long task runs, one quick task at a time", async () => withDir(async dir => {
  await enqueuePcTask(dir, "Find support jobs", undefined, clock);
  const long = (await claimNextPcTask(dir, "worker", worker, clock))!;
  assert.equal(long.plan?.kind, "jobs");
  const open = await enqueuePcTask(dir, "Open this link on my PC: " + SHEET, undefined, clock);
  const second = await enqueuePcTask(dir, "Open this link on my PC: https://example.com/two", undefined, clock);
  assert.equal(open.requiredFeature, "quick-lane-v1");

  assert.equal(await claimNextPcTask(dir, "worker", worker, clock), undefined, "the main lane still waits for the running job");
  const quick = (await claimNextPcTask(dir, "worker", worker, clock, "quick"))!;
  assert.equal(quick.id, open.id);
  assert.equal(await claimNextPcTask(dir, "worker", worker, clock, "quick"), undefined, "one quick task at a time");

  await finishPcTask(dir, quick.id, "worker", quick.lease!, randomUUID(), { ...emptyReport("completed", "Opened"), evidence: [{ action: "opened", target: SHEET, detail: "ok" }] }, clock);
  assert.equal((await claimNextPcTask(dir, "worker", worker, clock, "quick"))?.id, second.id);
  const tasks = (await pcSnapshot(dir, clock)).tasks;
  assert.equal(tasks.find(t => t.id === long.id)?.status, "running", "the long task was never touched");
}));

test("the quick lane never takes agent work, and an old Hands without the feature never gets a link", async () => withDir(async dir => {
  await enqueuePcTask(dir, "Find support jobs", undefined, clock);
  assert.equal(await claimNextPcTask(dir, "worker", worker, clock, "quick"), undefined, "a job search is not a quick task");
  await withDir(async other => {
    await enqueuePcTask(other, "Open this link on my PC: " + SHEET, undefined, clock);
    const old = worker.map(e => e.id === "windows" ? { ...e, features: undefined } : e) as ExecutorStatus[];
    assert.equal(await claimNextPcTask(other, "worker", old, clock, "quick"), undefined);
    assert.match((await pcSnapshot(other, clock)).tasks[0]!.progress ?? "", /updated worker/i);
  });
}));

test("Hands reports itself as able to run the quick lane", () => {
  const windows = agentStatuses({ server: "https://x.test", token: "t", jobsDir: "." }, {}).find(e => e.id === "windows")!;
  assert.deepEqual(windows.features, ["quick-lane-v1"]);
});

test("quickPass claims a quick task, opens it with the windows runner and reports the result", async () => {
  const taskId = randomUUID(), lease = randomUUID(), workerId = randomUUID();
  const request = "Open this link on my PC: " + SHEET;
  const plan = { kind: "desktop", action: "open_url", url: SHEET };
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input), body = JSON.parse(String(init?.body));
    calls.push({ url, body });
    if (url.endsWith("/claim")) return calls.filter(c => c.url.endsWith("/claim")).length === 1 ? Response.json({ task: { id: taskId, request, plan, workerId, lease, toolProfile: "personal" } }) : new Response(null, { status: 204 });
    return Response.json({ task: {} });
  }) as typeof fetch;
  try {
    const ran: string[] = [];
    const run = (async (id: string, _s: unknown, task: { plan: { kind: string } }) => {
      ran.push(id + ":" + task.plan.kind);
      return { report: { ...emptyReport("completed", "Opened docs.google.com in your default browser."), evidence: [{ action: "opened", target: SHEET, detail: "ok" }] }, safeToRetry: false };
    }) as never;
    const state = { workerId, cooldowns: {} } as unknown as LocalState;
    const settings = { server: "https://jarvis.test", token: "t", jobsDir: "." };
    assert.equal(await quickPass(settings, state, run, 1), true);
    assert.deepEqual(ran, ["windows:desktop"]);
    const claim = calls[0]!;
    assert.equal(claim.body.lane, "quick");
    const result = calls.find(c => c.url.endsWith("/" + taskId + "/result"))!;
    assert.equal(result.body.lease, lease);
    assert.equal((result.body.report as { outcome: string }).outcome, "completed");
    assert.equal(await quickPass(settings, state, run, 1), false, "nothing queued: nothing done");
  } finally { globalThis.fetch = realFetch; }
});
