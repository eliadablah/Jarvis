import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeLimitsFromEvent, codexLimitsFromText, newerLimits, readCodexLimits } from "./limits.ts";

// The shapes below are what Claude Code 2.1.301 and Codex write on this PC.
const claudeEvent = { type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1792449000, rateLimitType: "five_hour", isUsingOverage: false,
  unifiedWindows: { five_hour: { utilization: 0.84, resetsAt: 1792449000 }, seven_day: { utilization: 0.7, resetsAt: 1792702800 } } } };
const codexLine = (timestamp: string, primary: number, secondary: number) => JSON.stringify({ timestamp, type: "event_msg", payload: { type: "token_count",
  rate_limits: { limit_id: "codex", primary: { used_percent: primary, window_minutes: 300, resets_at: 1792280082 },
    secondary: { used_percent: secondary, window_minutes: 10080, resets_at: 1792650642 }, credits: { balance: "0" }, plan_type: "plus" } } });

test("Claude's stream event becomes 5-hour and weekly percentages", () => {
  const reading = claudeLimitsFromEvent(claudeEvent, new Date("2026-10-19T19:00:00Z"))!;
  assert.deepEqual(reading.fiveHour, { usedPercent: 84, resetsAt: 1792449000, minutes: 300 });
  assert.deepEqual(reading.week, { usedPercent: 70, resetsAt: 1792702800, minutes: 10080 });
  assert.equal(reading.status, "allowed");
  assert.equal(reading.updatedAt, "2026-10-19T19:00:00.000Z");
  assert.equal(claudeLimitsFromEvent({ type: "assistant" }), undefined);
  assert.equal(claudeLimitsFromEvent({ type: "rate_limit_event", rate_limit_info: {} }), undefined);
  assert.equal(claudeLimitsFromEvent(null), undefined);
  // Older single-window shape.
  const single = claudeLimitsFromEvent({ type: "rate_limit_event", rate_limit_info: { rateLimitType: "five_hour", utilization: 0.5, resetsAt: 1792449000 } })!;
  assert.equal(single.fiveHour?.usedPercent, 50);
});

test("Codex session logs give the newest reading, with windows told apart by length", () => {
  const text = [codexLine("2026-10-17T19:00:00Z", 40, 60), "not json", codexLine("2026-10-17T19:38:25.425Z", 70, 66), '{"type":"other"}'].join("\n");
  const reading = codexLimitsFromText(text)!;
  assert.equal(reading.fiveHour?.usedPercent, 70);
  assert.equal(reading.week?.usedPercent, 66);
  assert.equal(reading.fiveHour?.minutes, 300);
  assert.equal(reading.plan, "plus");
  assert.equal(reading.updatedAt, "2026-10-17T19:38:25.425Z");
  assert.equal(codexLimitsFromText("nothing here"), undefined);
  // Windows are sorted by their length even if the log lists them the other way round.
  const swapped = JSON.stringify({ timestamp: "2026-10-17T20:00:00Z", payload: { rate_limits: {
    primary: { used_percent: 10, window_minutes: 10080, resets_at: 1792650642 }, secondary: { used_percent: 90, window_minutes: 300, resets_at: 1792280082 } } } });
  assert.equal(codexLimitsFromText(swapped)?.fiveHour?.usedPercent, 90);
  assert.equal(codexLimitsFromText(swapped)?.week?.usedPercent, 10);
});

test("the newest Codex log across folders wins, and an older reading never replaces a newer one", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-limits-test-"));
  try {
    const a = join(root, "a", "2026", "10", "17"), b = join(root, "b", "2026", "10", "18");
    await mkdir(a, { recursive: true }); await mkdir(b, { recursive: true });
    await writeFile(join(a, "rollout-2026-10-17T10-00-00-x.jsonl"), codexLine("2026-10-17T10:00:00Z", 30, 40) + "\n");
    await writeFile(join(b, "rollout-2026-10-18T10-00-00-y.jsonl"), codexLine("2026-10-18T10:00:00Z", 55, 62) + "\n");
    const best = await readCodexLimits([join(root, "a"), join(root, "b"), join(root, "missing")]);
    assert.equal(best?.fiveHour?.usedPercent, 55);
    assert.equal(await readCodexLimits([join(root, "missing")]), undefined);
    const older = { fiveHour: { usedPercent: 1, resetsAt: 1792280082 }, updatedAt: "2026-10-01T00:00:00.000Z" };
    assert.equal(newerLimits(best, older), best);
    assert.equal(newerLimits(older, best), best);
    assert.equal(newerLimits(undefined, older), older);
  } finally { await rm(root, { recursive: true, force: true }); }
});
