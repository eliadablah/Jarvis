// Tests for request routing and config parsing. Run with `npm test`
// (Node's built-in test runner, no extra packages).

import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/routes.ts";
import { loadConfig, type AppConfig } from "../src/config.ts";

const config: AppConfig = { port: 3000, env: "dev", version: "abc1234" };

test("health check reports ok with env and version", () => {
  const res = handleRequest("GET", "/healthz", config);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { status: "ok", env: "dev", version: "abc1234" });
});

test("home page shows the environment and version", () => {
  const res = handleRequest("GET", "/", config);
  assert.equal(res.status, 200);
  assert.match(res.contentType, /text\/html/);
  assert.match(res.body, /Dev/);
  assert.match(res.body, /abc1234/);
});

test("unknown paths return 404", () => {
  assert.equal(handleRequest("GET", "/nope", config).status, 404);
});

test("only GET and HEAD are allowed", () => {
  assert.equal(handleRequest("POST", "/", config).status, 405);
});

test("home page escapes the version string", () => {
  const res = handleRequest("GET", "/", { ...config, version: "<script>" });
  assert.doesNotMatch(res.body, /<script>/);
  assert.match(res.body, /&lt;script&gt;/);
});

test("config falls back to safe defaults", () => {
  const cfg = loadConfig({ PORT: "abc", APP_ENV: "staging" });
  assert.deepEqual(cfg, { port: 3000, env: "local", version: "unknown" });
});

test("config reads real values", () => {
  const cfg = loadConfig({ PORT: "8080", APP_ENV: "prod", APP_VERSION: " 1a2b3c " });
  assert.deepEqual(cfg, { port: 8080, env: "prod", version: "1a2b3c" });
});
