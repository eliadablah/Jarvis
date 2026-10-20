import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { parsePcIntent } from "../src/pcTasks/intent.ts";
import { enqueuePcTask, readPcTasks } from "../src/pcTasks/store.ts";
import { describeMorning, isDue, morningRequest, nextRun, parseTime, setMorningEnabled, tickMorning } from "../src/schedules/morning.ts";
import { lastLabel, whenLabel } from "../public/schedulePanel.js";

const chicago = { time: "07:00", count: 10, timezone: "America/Chicago" };

test("times parse strictly and the next run respects the Dallas clock", () => {
  assert.equal(parseTime("07:00"), 420);
  assert.equal(parseTime("7:30"), 450);
  assert.equal(parseTime("24:00"), undefined);
  assert.equal(parseTime("seven"), undefined);
  // October 19, 2026 is daylight time (UTC-5): 7:00 AM Dallas = 12:00 UTC.
  assert.equal(nextRun(new Date("2026-10-19T10:00:00Z"), chicago).toISOString(), "2026-10-19T12:00:00.000Z");
  assert.equal(nextRun(new Date("2026-10-19T13:00:00Z"), chicago).toISOString(), "2026-10-20T12:00:00.000Z");
  // Daylight time ends on November 1: the morning after, 7:00 AM Dallas = 13:00 UTC.
  assert.equal(nextRun(new Date("2026-10-31T20:00:00Z"), chicago).toISOString(), "2026-11-01T13:00:00.000Z");
});

test("a run is due only from the scheduled time for three hours", () => {
  assert.equal(isDue(new Date("2026-10-19T11:59:00Z"), chicago), false); // 6:59 AM
  assert.equal(isDue(new Date("2026-10-19T12:00:00Z"), chicago), true);  // 7:00 AM
  assert.equal(isDue(new Date("2026-10-19T14:59:00Z"), chicago), true);  // 9:59 AM
  assert.equal(isDue(new Date("2026-10-19T15:00:00Z"), chicago), false); // 10:00 AM
  assert.equal(isDue(new Date("2026-10-19T20:00:00Z"), chicago), false); // 3 PM: a deploy then starts nothing
});

test("the scheduled request is a normal, validated job request for exactly N applications", () => {
  assert.deepEqual(parsePcIntent(morningRequest(10)), { type: "task", plan: { kind: "jobs", action: "submit", maxApplications: 10 } });
  assert.deepEqual(parsePcIntent(morningRequest(25)), { type: "task", plan: { kind: "jobs", action: "submit", maxApplications: 25 } });
  assert.equal(loadConfig({ MORNING_RUN_COUNT: "99" }).morningRun.count, 25);
  assert.equal(loadConfig({ MORNING_RUN_TIME: "banana" }).morningRun.time, "07:00");
  assert.equal(loadConfig({}).morningRun.timezone, "America/Chicago");
});

test("the server queues the morning run once a day, can be paused, and drops stale runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-morning-"));
  const previous = process.env.JARVIS_DATA_DIR;
  process.env.JARVIS_DATA_DIR = dir;
  try {
    const config = loadConfig({ PC_WORKER_TOKEN: "t" });
    const at = (iso: string) => new Date(iso);
    assert.equal(await tickMorning(config, at("2026-10-19T11:00:00Z")), undefined); // 6:00 AM, not yet
    const task = await tickMorning(config, at("2026-10-19T12:01:00Z"));
    assert.equal(task?.requestId, "scheduled-morning-2026-10-19");
    assert.equal(task?.request, "Apply to 10 job applications. Scheduled morning run.");
    assert.deepEqual(task?.plan, { kind: "jobs", action: "submit", maxApplications: 10 });
    assert.equal(await tickMorning(config, at("2026-10-19T12:05:00Z")), undefined); // already queued today
    assert.equal((await readPcTasks(dir)).tasks.length, 1);

    // Paused: nothing is queued the next day.
    await setMorningEnabled(config, false);
    assert.equal(await tickMorning(config, at("2026-10-20T12:01:00Z")), undefined);
    assert.equal((await describeMorning(config, at("2026-10-20T12:02:00Z"))).enabled, false);
    await setMorningEnabled(config, true);

    // A scheduled run still waiting from yesterday (PC was off) is cancelled, not run late.
    const next = await tickMorning(config, at("2026-10-21T12:01:00Z"));
    assert.equal(next?.toolProfile,"scoped");
    assert.equal(next?.requestId, "scheduled-morning-2026-10-21");
    const tasks = (await readPcTasks(dir)).tasks;
    assert.equal(tasks.find(t => t.requestId === "scheduled-morning-2026-10-19")?.status, "cancelled");
    assert.equal(tasks.find(t => t.requestId === "scheduled-morning-2026-10-21")?.status, "queued");

    // No worker token: the feature is off.
    assert.equal(await tickMorning(loadConfig({}), at("2026-10-22T12:01:00Z")), undefined);
    const view = await describeMorning(config, at("2026-10-21T13:00:00Z"));
    assert.equal(view.available, true);
    assert.equal(view.count, 10);
    assert.equal(view.last?.status, "queued");
    assert.equal(typeof (await enqueuePcTask(dir, "Open Calculator", undefined, at("2026-10-21T13:00:00Z"))).id, "string");
  } finally {
    if (previous === undefined) delete process.env.JARVIS_DATA_DIR; else process.env.JARVIS_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("the dashboard words the next run and the last result", () => {
  const now = new Date(2026, 9, 19, 6, 0);
  assert.match(whenLabel(new Date(2026, 9, 19, 7, 0).toISOString(), now), /^today 7 AM/);
  assert.match(whenLabel(new Date(2026, 9, 20, 7, 0).toISOString(), now), /^tomorrow 7 AM/);
  assert.equal(lastLabel(undefined), "no run yet");
  const finished = new Date(Date.now() - 2 * 3600_000).toISOString();
  assert.equal(lastLabel({ status: "partial", submitted: 5, createdAt: finished, finishedAt: finished }), "Partly completed · 5 submitted · 2h ago");
  assert.equal(lastLabel({ status: "running", createdAt: new Date().toISOString() }), "Running now · 0m ago");
});
