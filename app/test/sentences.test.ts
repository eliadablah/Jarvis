// Tests for splitting streamed answers into speakable sentences.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SentenceSplitter, speakable } from "../client/sentences.ts";

test("returns sentences as they complete across chunks", () => {
  const s = new SentenceSplitter();
  assert.deepEqual(s.push("Good evening, s"), []);
  assert.deepEqual(s.push("ir. All systems "), ["Good evening, sir."]);
  assert.deepEqual(s.push("online! What next? "), ["All systems online!", "What next?"]);
  assert.deepEqual(s.flush(), []);
});

test("keeps an unfinished sentence until flush", () => {
  const s = new SentenceSplitter();
  assert.deepEqual(s.push("Working on it"), []);
  assert.deepEqual(s.flush(), ["Working on it"]);
});

test("line breaks end a sentence (list items, headings)", () => {
  const s = new SentenceSplitter();
  assert.deepEqual(s.push("Three items:\n- Network+\n- CCNA\n"), ["Three items:", "- Network+", "- CCNA"]);
});

test("decimals and file names don't split mid-word", () => {
  const s = new SentenceSplitter();
  assert.deepEqual(s.push("Version 2.1 runs on v1.2.3 fine. "), ["Version 2.1 runs on v1.2.3 fine."]);
  assert.deepEqual(s.push("See Active Priorities.md for more"), []);
});

test("speakable strips markdown", () => {
  assert.equal(speakable("**Bold** and `code` in [a link](https://x.y)"), "Bold and code in a link");
  assert.equal(speakable("## Heading"), "Heading");
  assert.equal(speakable("- item"), "item");
  assert.equal(speakable("```\nconst x = 1;\n```"), "");
});
