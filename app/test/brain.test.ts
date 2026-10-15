// Tests for reading Claude Code's streamed output and building its
// command line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStreamLine, splitLines } from "../src/brain/streamParser.ts";
import { buildClaudeArgs } from "../src/brain/claudeCode.ts";
import type { ClaudeConfig } from "../src/config.ts";

const claude: ClaudeConfig = {
  bin: "claude",
  model: "opus",
  personaPath: "persona/jarvis.md",
  workDir: "/tmp",
  timeoutMs: 1000,
};

test("init line gives the session ID", () => {
  const line = JSON.stringify({ type: "system", subtype: "init", session_id: "abc" });
  assert.deepEqual(parseStreamLine(line), { kind: "session", sessionId: "abc" });
});

test("text delta gives the text", () => {
  const line = JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
  });
  assert.deepEqual(parseStreamLine(line), { kind: "text", text: "Hello" });
});

test("non-text stream events are ignored", () => {
  const line = JSON.stringify({ type: "stream_event", event: { delta: { type: "thinking_delta", thinking: "x" } } });
  assert.deepEqual(parseStreamLine(line), { kind: "ignore" });
});

test("successful result", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Hi", session_id: "s1" });
  assert.deepEqual(parseStreamLine(line), { kind: "result", isError: false, text: "Hi", sessionId: "s1" });
});

test("error result", () => {
  const line = JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, session_id: "s1" });
  const parsed = parseStreamLine(line);
  assert.equal(parsed.kind, "result");
  assert.equal(parsed.kind === "result" && parsed.isError, true);
});

test("garbage and blank lines are ignored", () => {
  assert.deepEqual(parseStreamLine("not json"), { kind: "ignore" });
  assert.deepEqual(parseStreamLine("   "), { kind: "ignore" });
  assert.deepEqual(parseStreamLine('"just a string"'), { kind: "ignore" });
});

test("splitLines keeps the unfinished line", () => {
  assert.deepEqual(splitLines('{"a":1}\n{"b":'), { lines: ['{"a":1}'], rest: '{"b":' });
});

test("args turn off every tool and never include the message", () => {
  const args = buildClaudeArgs(claude, undefined);
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--disallowedTools") + 1], "mcp__*");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.ok(!args.includes("--resume"));
});

test("args resume a session when given one", () => {
  const args = buildClaudeArgs(claude, "11111111-2222-3333-4444-555555555555");
  assert.equal(args[args.indexOf("--resume") + 1], "11111111-2222-3333-4444-555555555555");
});
