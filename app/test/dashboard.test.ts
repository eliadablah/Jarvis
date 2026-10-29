import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDashboard, updateTask } from "../src/dashboard.ts";
test("a reminder is a tagged task with a normalized time, and bad times are refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-reminders-"));
  try {
    const state = await updateTask(dir, "add", { title: "Call the dentist", remindAt: "2026-11-02T15:00:00-06:00" });
    const saved = state.tasks[0]!;
    assert.equal(saved.tag, "Reminder");
    assert.equal(saved.remindAt, "2026-11-02T21:00:00.000Z");
    await assert.rejects(updateTask(dir, "add", { title: "No time", remindAt: "soon" }));
    await assert.rejects(updateTask(dir, "add", { title: "Number time", remindAt: 5 }));
    const plain = (await updateTask(dir, "add", { title: "Plain task" })).tasks[1]!;
    assert.equal(plain.tag, "Personal");
    assert.equal("remindAt" in plain, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("dashboard tasks survive reload and concurrent additions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-tasks-"));
  try {
    assert.deepEqual(await readDashboard(dir), { tasks: [] });
    await Promise.all([updateTask(dir, "add", { title: "First" }), updateTask(dir, "add", { title: "Second" })]);
    const saved = await readDashboard(dir);
    assert.equal(saved.tasks.length, 2);
    await updateTask(dir, "update", { done: true }, saved.tasks[0]!.id);
    assert.equal((await readDashboard(dir)).tasks[0]!.done, true);
    await assert.rejects(updateTask(dir, "add", { title: " " }));
    await assert.rejects(updateTask(dir, "update", { done: "true" }, saved.tasks[0]!.id));
    await updateTask(dir, "delete", {}, saved.tasks[0]!.id);
    assert.equal((await readDashboard(dir)).tasks.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
