// Tests for safe file serving and the face bus injection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { contentTypeFor, resolveInside } from "../src/http/fileServing.ts";
import { injectBus } from "../src/face/visualizer.ts";

const root = resolve("visualizer");

test("resolves normal files inside the folder", () => {
  assert.equal(resolveInside(root, "core.js"), join(root, "core.js"));
  assert.equal(resolveInside(root, "faces/board/index.html"), join(root, "faces", "board", "index.html"));
});

test("refuses to leave the folder", () => {
  assert.equal(resolveInside(root, "../secret.js"), undefined);
  assert.equal(resolveInside(root, "faces/../../etc/passwd.txt"), undefined);
  assert.equal(resolveInside(root, "%2e%2e/secret.js"), undefined);
  assert.equal(resolveInside(root, "..%5csecret.js"), undefined);
});

test("refuses dotfiles, odd types, and bad encodings", () => {
  assert.equal(resolveInside(root, ".git/config"), undefined);
  assert.equal(resolveInside(root, ".env"), undefined);
  assert.equal(resolveInside(root, "server.py"), undefined);
  assert.equal(resolveInside(root, "%E0%A4%A"), undefined);
  assert.equal(resolveInside(root, "core.js%00.png"), undefined);
});

test("content types", () => {
  assert.equal(contentTypeFor("x.wasm"), "application/wasm");
  assert.match(contentTypeFor("x.mjs") ?? "", /javascript/);
  assert.equal(contentTypeFor("x.py"), undefined);
});

test("bus script goes right before core.js", () => {
  const html = '<head></head><body><script src="../../core.js"></script><script>AV.init({})</script></body>';
  const out = injectBus(html) ?? "";
  assert.ok(out.indexOf('src="/face-bus.js"') < out.indexOf('src="../../core.js"'));
  assert.ok(out.includes('src="/face-bus.js"'));
});

test("pages without core.js aren't faces", () => {
  assert.equal(injectBus("<html><body>hi</body></html>"), undefined);
});
