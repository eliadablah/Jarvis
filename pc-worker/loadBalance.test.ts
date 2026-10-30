// Tests for sending work to the engine (Claude Code or Codex) that has run fewer tasks lately.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parsePcIntent } from "../app/src/pcTasks/intent.ts";
import { enqueuePcTask, claimNextPcTask, heartbeatPcTask, finishPcTask, providerLoad, type PcTask } from "../app/src/pcTasks/store.ts";
import { emptyReport, type ExecutorStatus, type PcPlan } from "../app/src/pcTasks/protocol.ts";
import { balanceNote, chooseAgents } from "./agents.ts";
import { validateClaim } from "./worker.ts";

const now = new Date("2026-10-30T12:00:00Z");
const both: ExecutorStatus[] = [
  { id: "claude-chrome", capabilities: ["jobs", "browser"], features: ["job-files-v1", "task-sync-v1", "full-tools-v2"], state: "ready", reason: "", remainingTokens: null },
  { id: "claude-files", capabilities: ["workspace"], state: "ready", reason: "", remainingTokens: null },
  { id: "codex-computer", capabilities: ["jobs", "browser"], features: ["job-files-v1", "task-sync-v1", "full-tools-v2"], state: "ready", reason: "", remainingTokens: null },
  { id: "codex-local", capabilities: ["workspace"], state: "ready", reason: "", remainingTokens: null },
];
const plan = (request: string): PcPlan => { const intent = parsePcIntent(request); if (intent?.type !== "task") throw new Error("not a task: " + request); return intent.plan; };
const row = (executor: string | undefined, hoursAgo: number): PcTask => ({ id: randomUUID(), kind: "jobs", request: "x", status: "completed", createdAt: now.toISOString(), executor, startedAt: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString() });

test("the engine that has run fewer tasks goes first", () => {
  const search = plan("Find support jobs");
  assert.deepEqual(chooseAgents(search, both, {}, now.getTime(), { claude: 5, codex: 2 }), ["codex-computer", "claude-chrome"]);
  assert.deepEqual(chooseAgents(search, both, {}, now.getTime(), { claude: 1, codex: 4 }), ["claude-chrome", "codex-computer"]);
  const code = plan("In my assistant workspace, fix the build");
  assert.deepEqual(chooseAgents(code, both, {}, now.getTime(), { claude: 3, codex: 0 }), ["codex-local", "claude-files"]);
});

test("equal or unknown counts keep the old order, and an engine that can't do the task is never chosen", () => {
  const search = plan("Find support jobs");
  assert.deepEqual(chooseAgents(search, both, {}, now.getTime(), { claude: 2, codex: 2 }), ["claude-chrome", "codex-computer"]);
  assert.deepEqual(chooseAgents(search, both), ["claude-chrome", "codex-computer"]);
  const codexDown = both.map(e => e.id.startsWith("codex-") ? { ...e, state: "cooldown" as const } : e);
  assert.deepEqual(chooseAgents(search, codexDown, {}, now.getTime(), { claude: 9, codex: 0 }), ["claude-chrome"], "fewer tasks doesn't beat being unavailable");
});

test("the live view says why the other engine was picked", () => {
  assert.match(balanceNote("codex-computer", { claude: 5, codex: 2 })!, /Claude has run 5 tasks.*Codex 2.*Codex takes this one/);
  assert.match(balanceNote("claude-chrome", { claude: 0, codex: 1 })!, /Codex has run 1 task in/);
  assert.equal(balanceNote("claude-chrome", { claude: 3, codex: 2 }), undefined, "no note when the busier engine is chosen anyway");
  assert.equal(balanceNote("claude-chrome", { claude: 2, codex: 2 }), undefined);
  assert.equal(balanceNote("windows", { claude: 9, codex: 0 }), undefined);
});

test("the server counts each engine's tasks from the last 24 hours only", () => {
  const load = providerLoad([row("claude-chrome", 1), row("claude-computer", 5), row("codex-local", 2), row("claude-chrome", 30), row(undefined, 1), row("windows", 1)], now);
  assert.deepEqual(load, { claude: 2, codex: 1 });
});

test("a claim carries the counts, and the worker keeps only sane numbers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-load-test-"));
  try {
    for (const n of [1, 2]) {
      await enqueuePcTask(dir, "Find support jobs", undefined, now);
      const done = (await claimNextPcTask(dir, "worker", both, now))!;
      assert.deepEqual(done.load, { claude: n - 1, codex: 0 }, "counts before this task");
      await heartbeatPcTask(dir, done.id, "worker", done.lease!, "working", "claude-chrome", now);
      await finishPcTask(dir, done.id, "worker", done.lease!, randomUUID(), { ...emptyReport("completed", "ok"), evidence: [{ action: "searched", target: "x", detail: "y" }] }, now);
    }
    await enqueuePcTask(dir, "Find support jobs", undefined, now);
    const next = (await claimNextPcTask(dir, "worker", both, now))!;
    assert.deepEqual(next.load, { claude: 2, codex: 0 });
    const claimed = validateClaim({ ...next, workerId: next.workerId, load: { claude: 2, codex: -4, extra: 1 } }, next.workerId!);
    assert.deepEqual(claimed.load, { claude: 2, codex: 0 });
    const bare = { ...next } as Record<string, unknown>; delete bare.load;
    assert.equal("load" in validateClaim(bare, next.workerId!), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
