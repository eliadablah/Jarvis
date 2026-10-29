// Tests for the stall watchdog: how long an agent may be silent, and what happens to a silent one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canFallback, canRetryStartup, isAgentActivity, stallVerdict, STALL_AFTER_ACTION_MS, STALL_BEFORE_ACTION_MS, type AgentRun } from "./agents.ts";
import { emptyReport } from "../app/src/pcTasks/protocol.ts";

test("session bookkeeping lines are not activity; real agent output is", () => {
  for (const type of ["system", "rate_limit_event", "thread.started", "turn.started"]) assert.equal(isAgentActivity(type), false, type);
  for (const type of ["assistant", "user", "result", "item.started", "item.completed", "turn.completed"]) assert.equal(isAgentActivity(type), true, type);
  assert.equal(isAgentActivity(undefined), false);
});

test("before any tool is used, a silent agent is restarted after five minutes", () => {
  assert.equal(stallVerdict(0, false), "wait");
  assert.equal(stallVerdict(STALL_BEFORE_ACTION_MS - 1, false), "wait");
  assert.equal(stallVerdict(STALL_BEFORE_ACTION_MS, false), "restart");
});

test("once a tool may have acted, it is never restarted; a long silence only stops it", () => {
  assert.equal(stallVerdict(STALL_BEFORE_ACTION_MS * 2, true), "wait");
  assert.equal(stallVerdict(STALL_AFTER_ACTION_MS - 1, true), "wait");
  assert.equal(stallVerdict(STALL_AFTER_ACTION_MS, true), "stop");
});

test("a stalled start is retried and can fall back to another agent, but a stopped one cannot", () => {
  const stalled: AgentRun = { report: emptyReport("needs_input", "claude-chrome stopped responding before it did anything."), failure: "unavailable", safeToRetry: true, stalled: true };
  assert.equal(canRetryStartup(stalled), true);
  assert.equal(canFallback(stalled), true);
  const stopped: AgentRun = { report: emptyReport("needs_input", "claude-chrome went quiet for 20 minutes and was stopped."), safeToRetry: false };
  assert.equal(canRetryStartup(stopped), false);
  assert.equal(canFallback(stopped), false);
});
