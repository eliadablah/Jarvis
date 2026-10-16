// Tests for the chat request checks: the source checks that block other
// websites, and the body checks that block bad input before Claude Code.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChatRequestError,
  MAX_MESSAGE_CHARS,
  checkRequestSource,
  isValidSessionId,
  parseChatRequest,
} from "../src/api/chatRequest.ts";

const goodHeaders = {
  "x-jarvis-chat": "1",
  "content-type": "application/json",
  host: "dev-jarvis.eliadablah.com",
  origin: "https://dev-jarvis.eliadablah.com",
};

/** Asserts the call throws a ChatRequestError with this status. */
function assertStatus(fn: () => unknown, status: number): void {
  assert.throws(fn, (err: unknown) => err instanceof ChatRequestError && err.status === status);
}

test("accepts requests from Jarvis's own page", () => {
  assert.doesNotThrow(() => checkRequestSource(goodHeaders));
});

test("rejects a missing chat header", () => {
  assertStatus(() => checkRequestSource({ ...goodHeaders, "x-jarvis-chat": undefined }), 403);
});

test("rejects non-JSON bodies", () => {
  assertStatus(() => checkRequestSource({ ...goodHeaders, "content-type": "text/plain" }), 415);
});

test("rejects another website's origin", () => {
  assertStatus(() => checkRequestSource({ ...goodHeaders, origin: "https://evil.example" }), 403);
});

test("parses a message and trims it", () => {
  assert.deepEqual(parseChatRequest('{"message":"  hi  "}'), { message: "hi", sessionId: undefined });
});

test("keeps a valid session ID", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  assert.equal(parseChatRequest(JSON.stringify({ message: "hi", sessionId: id })).sessionId, id);
});

test("rejects a session ID that could be a flag", () => {
  assertStatus(() => parseChatRequest(JSON.stringify({ message: "hi", sessionId: "--dangerous" })), 400);
  assert.equal(isValidSessionId("--resume"), false);
});

test("rejects empty, missing, and oversized messages", () => {
  assertStatus(() => parseChatRequest('{"message":"   "}'), 400);
  assertStatus(() => parseChatRequest("{}"), 400);
  assertStatus(() => parseChatRequest("not json"), 400);
  assertStatus(() => parseChatRequest(JSON.stringify({ message: "x".repeat(MAX_MESSAGE_CHARS + 1) })), 413);
});

test("automatic routing accepts separate provider sessions", () => {
  const sessions = { claude: "11111111-2222-3333-4444-555555555555", codex: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
  assert.deepEqual(parseChatRequest(JSON.stringify({message:"hello",provider:"auto",sessions})),
    {message:"hello",provider:"auto",sessionId:undefined,sessions});
});

test("automatic routing refuses an ambiguous legacy session", () => {
  assertStatus(() => parseChatRequest(JSON.stringify({message:"hello",provider:"auto",sessionId:"11111111-2222-3333-4444-555555555555"})), 400);
});

test("provider session validation rejects wrong shapes, unknown engines and injected flags", () => {
  for (const sessions of [null, [], "--resume", {other:"11111111-2222-3333-4444-555555555555"}, {claude:"--last"}, {codex:23}]) {
    assertStatus(() => parseChatRequest(JSON.stringify({message:"hello",provider:"auto",sessions})), 400);
  }
});

test("empty provider sessions do not accidentally resume another engine", () => {
  assert.deepEqual(parseChatRequest('{"message":"hello","provider":"auto","sessions":{"claude":null}}').sessions, {});
});
