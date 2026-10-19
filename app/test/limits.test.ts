import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeLimits } from "../src/pcTasks/protocol.ts";
import { readPcTasks, setPcLimits } from "../src/pcTasks/store.ts";
import { ageLabel, limitView, windowView } from "../public/limits.js";

const now = new Date("2026-10-19T19:00:00Z");
const nowSeconds = now.getTime() / 1000;
const good = { claude: { fiveHour: { usedPercent: 84, resetsAt: nowSeconds + 3600, minutes: 300 }, week: { usedPercent: 70.04, resetsAt: nowSeconds + 86400 }, plan: "max", status: "allowed", updatedAt: now.toISOString() } };

test("only well-formed limit readings are accepted from the PC", () => {
  const clean = sanitizeLimits(good, now);
  assert.equal(clean.claude?.fiveHour?.usedPercent, 84);
  assert.equal(clean.claude?.week?.usedPercent, 70);
  assert.equal(clean.claude?.plan, "max");
  for (const bad of [null, "x", [], { claude: "x" }, { claude: {} }, { claude: { fiveHour: { usedPercent: 140, resetsAt: nowSeconds + 1 } } },
    { claude: { fiveHour: { usedPercent: -1, resetsAt: nowSeconds + 1 } } }, { claude: { fiveHour: { usedPercent: 5, resetsAt: 12 } } },
    { claude: { fiveHour: { usedPercent: "5", resetsAt: nowSeconds } } }, { evil: { fiveHour: { usedPercent: 5, resetsAt: nowSeconds + 1 } } }])
    assert.deepEqual(sanitizeLimits(bad, now), {});
  // Odd labels and future timestamps are dropped or clamped, never passed through.
  const odd = sanitizeLimits({ codex: { fiveHour: { usedPercent: 5, resetsAt: nowSeconds + 1 }, plan: "<script>", status: "ok", updatedAt: "2099-01-01T00:00:00Z" } }, now);
  assert.equal(odd.codex?.plan, undefined);
  assert.equal(odd.codex?.updatedAt, now.toISOString());
});

test("the server keeps the later reading per provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-limits-store-"));
  try {
    await setPcLimits(dir, sanitizeLimits(good, now), now);
    await setPcLimits(dir, sanitizeLimits({ claude: { ...good.claude, fiveHour: { usedPercent: 10, resetsAt: nowSeconds + 3600 }, updatedAt: "2026-10-19T18:00:00Z" } }, now), now);
    await setPcLimits(dir, sanitizeLimits({ codex: { week: { usedPercent: 66, resetsAt: nowSeconds + 9999 }, updatedAt: "2026-10-19T18:30:00Z" } }, now), now);
    const saved = (await readPcTasks(dir)).limits!;
    assert.equal(saved.claude?.fiveHour?.usedPercent, 84);
    assert.equal(saved.codex?.week?.usedPercent, 66);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the dashboard turns readings into bars, tones, reset times and honest ages", () => {
  const ms = now.getTime();
  assert.equal(windowView({ usedPercent: 84, resetsAt: nowSeconds + 3600 }, ms)?.tone, "mid");
  assert.equal(windowView({ usedPercent: 95, resetsAt: nowSeconds + 3600 }, ms)?.tone, "high");
  assert.equal(windowView({ usedPercent: 20, resetsAt: nowSeconds + 3600 }, ms)?.tone, "low");
  assert.match(windowView({ usedPercent: 84, resetsAt: nowSeconds + 3600 }, ms)!.text, /^84% used · resets /);
  // A window whose reset time has passed is shown as reset, not as the old number.
  assert.deepEqual(windowView({ usedPercent: 99, resetsAt: nowSeconds - 60 }, ms), { percent: 0, tone: "low", text: "reset" });
  assert.equal(windowView(undefined, ms), undefined);
  assert.equal(ageLabel(new Date(ms - 60_000).toISOString(), ms), "");
  assert.equal(ageLabel(new Date(ms - 10 * 60_000).toISOString(), ms), "as of 10m ago");
  assert.equal(ageLabel(new Date(ms - 3 * 3600_000).toISOString(), ms), "as of 3h ago");
  assert.equal(ageLabel(new Date(ms - 2 * 86400_000).toISOString(), ms), "as of 2d ago");
  const view = limitView("claude", good.claude, ms);
  assert.equal(view.name, "Claude");
  assert.deepEqual(view.rows.map(r => r.label), ["5-hour", "Week"]);
  assert.deepEqual(limitView("codex", undefined, ms).rows, []);
});
