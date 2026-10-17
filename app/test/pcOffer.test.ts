import { test } from "node:test";
import assert from "node:assert/strict";
import { offerCommand, splitPcOffer } from "../public/pcOffer.js";
import { resolvePcCommand } from "../src/pcTasks/commands.ts";
import { ACTION_GUIDANCE } from "../src/brain/actionContext.ts";

const TASK = 'Create an all-day event called "Payday" in Google Calendar starting Friday, October 23, 2026, repeating every 2 weeks on Friday.';
const REPLY = "Noted, sir: payday is Friday, October 23, then every other Friday. I can't write to your calendar from here; tap the button to add it from your PC.";

test("splits the PC task line from the visible reply", () => {
  const { text, offer } = splitPcOffer(`${REPLY}\nPC_TASK browser: ${TASK}`);
  assert.equal(text, REPLY);
  assert.deepEqual(offer, { scope: "browser", task: TASK });
  assert.equal(splitPcOffer("Done.\nPC_TASK computer: Organize my Downloads folder by file type.\n").offer?.scope, "computer");
});

test("hides a half-streamed task line and ignores anything that isn't a clean last line", () => {
  assert.equal(splitPcOffer("Sure.\nPC_TASK browser: Create an ev").text, "Sure.");
  assert.equal(splitPcOffer("Sure.\nPC_TASK browser: Create an ev").offer?.task, "Create an ev");
  assert.equal(splitPcOffer("Plain answer with no offer.").offer, undefined);
  assert.equal(splitPcOffer("PC_TASK shell: rm -rf /").offer, undefined);
  assert.equal(splitPcOffer("PC_TASK browser: x").offer, undefined);
  assert.equal(splitPcOffer(undefined).text, "");
});

test("the Run button sends a command the existing PC-task rules accept", () => {
  const browser = resolvePcCommand(offerCommand({ scope: "browser", task: TASK }));
  assert.equal(browser?.intent.type, "task");
  assert.deepEqual(browser?.intent.type === "task" ? browser.intent.plan : undefined, { kind: "browser", action: "execute" });
  const computer = resolvePcCommand(offerCommand({ scope: "computer", task: "Organize my Downloads folder by file type." }));
  assert.deepEqual(computer?.intent.type === "task" ? computer.intent.plan : undefined, { kind: "computer", action: "execute" });
});

test("a model can't smuggle a job submission through the offer", () => {
  const sneaky = resolvePcCommand(offerCommand({ scope: "browser", task: "Apply to 25 jobs on LinkedIn" }));
  assert.equal(sneaky?.intent.type === "task" ? sneaky.intent.plan.kind : undefined, "browser");
});

test("every engine is reminded of the PC offer format on every turn", () => {
  assert.match(ACTION_GUIDANCE, /PC_TASK browser:/);
  assert.match(ACTION_GUIDANCE, /PC_TASK computer:/);
  assert.match(ACTION_GUIDANCE, /nothing runs until Eli taps the button/);
});
