import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeStep, describeTool, isStartupCrash } from "./steps.ts";
import { enqueuePcTask, claimNextPcTask, heartbeatPcTask, publicTask, readPcTasks, MAX_ACTIVITY } from "../app/src/pcTasks/store.ts";
import type { ExecutorStatus } from "../app/src/pcTasks/protocol.ts";

const claudeCall = (name: string, input: unknown) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });

test("live steps are plain sentences and never carry typed text, commands or full URLs", () => {
  assert.equal(describeStep(claudeCall("mcp__claude-in-chrome__navigate", { url: "https://www.linkedin.com/jobs/view/123?secret=1" })), "Opening linkedin.com");
  assert.equal(describeStep(claudeCall("mcp__claude-in-chrome__navigate", { url: "back" })), "Going back");
  assert.equal(describeStep(claudeCall("mcp__claude-in-chrome__computer", { action: "type", text: "my-password-123" })), "Typing");
  assert.equal(describeStep(claudeCall("mcp__claude-in-chrome__computer", { action: "left_click", coordinate: [10, 20] })), "Clicking");
  assert.equal(describeStep(claudeCall("mcp__claude-in-chrome__computer", { action: "screenshot" })), "Looking at the page");
  assert.equal(describeStep(claudeCall("mcp__claude-in-chrome__get_page_text", {})), "Reading the page");
  assert.equal(describeStep(claudeCall("Bash", { command: "curl -H 'Authorization: Bearer abc' https://x" })), "Running a command");
  assert.equal(describeStep(claudeCall("mcp__windows__PowerShell", { command: "Get-Secret" })), "Running a PowerShell step");
  assert.equal(describeStep({ type: "item.started", item: { type: "command_execution", command: "type secrets.txt" } }), "Running a command");
  assert.equal(describeStep({ type: "item.started", item: { type: "mcp_tool_call", tool: "Snapshot", arguments: {} } }), "Looking at the screen");
  for (const event of [claudeCall("mcp__x__navigate", { url: "https://a.example/path?token=zzz" }), claudeCall("Bash", { command: "echo SECRET" })])
    assert.equal(/token|zzz|SECRET|path/.test(describeStep(event)!), false);
});

test("short narration is shown, noise is ignored, unknown tools get a readable name", () => {
  assert.equal(describeStep({ type: "assistant", message: { content: [{ type: "text", text: "  Filling in the EasyPost\n application now  " }] } }), "Filling in the EasyPost application now");
  assert.equal(describeStep({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(400) }] } })!.length, 140);
  assert.equal(describeStep({ type: "result" }), undefined);
  assert.equal(describeStep(null), undefined);
  assert.equal(describeStep({ type: "item.completed", item: { type: "agent_message" } }), undefined);
  assert.equal(describeTool("mcp__thing__do_stuff"), "Using do stuff");
});

test("only a Windows crash before any work counts as a safe startup crash", () => {
  const fresh = { touchedTools: false, hasResult: false, elapsedMs: 800 };
  assert.equal(isStartupCrash(3221225477, fresh), true);
  assert.equal(isStartupCrash(-1073741819, fresh), true);
  assert.equal(isStartupCrash(0xC0000142, fresh), true);
  assert.equal(isStartupCrash(1, fresh), false);
  assert.equal(isStartupCrash(0, fresh), false);
  assert.equal(isStartupCrash(null, fresh), false);
  assert.equal(isStartupCrash(3221225477, { ...fresh, touchedTools: true }), false);
  assert.equal(isStartupCrash(3221225477, { ...fresh, hasResult: true }), false);
  assert.equal(isStartupCrash(3221225477, { ...fresh, elapsedMs: 120_000 }), false);
});

test("the server keeps a short feed of distinct live steps for the dashboard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-steps-"));
  try {
    const agents: ExecutorStatus[] = [{ id: "claude-chrome", capabilities: ["jobs", "browser"], state: "ready", reason: "", remainingTokens: null }];
    const t0 = new Date("2026-10-19T12:00:00Z");
    const at = (s: number) => new Date(t0.getTime() + s * 1000);
    const task = await enqueuePcTask(dir, "Find support jobs", undefined, t0);
    const claimed = (await claimNextPcTask(dir, "w", agents, t0))!;
    const beat = (text: string, s: number) => heartbeatPcTask(dir, task.id, "w", claimed.lease!, text, "claude-chrome", at(s));
    await beat("Opening linkedin.com", 2);
    await beat("Opening linkedin.com", 4);
    await beat("Clicking", 6);
    for (let i = 0; i < 20; i++) await beat("Step " + i, 10 + i);
    const stored = (await readPcTasks(dir)).tasks[0]!;
    assert.equal(stored.activity!.length, MAX_ACTIVITY);
    assert.equal(stored.activity!.at(-1)!.text, "Step 19");
    assert.equal(new Set(stored.activity!.map(a => a.text)).size, MAX_ACTIVITY);
    const view = publicTask(stored) as { activity?: unknown[]; lease?: string };
    assert.equal(Array.isArray(view.activity), true);
    assert.equal(view.lease, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
