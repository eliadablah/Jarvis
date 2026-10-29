import { test } from "node:test";
import assert from "node:assert/strict";
import { describeProgress, recentSteps } from "../public/liveIsland.js";
import { dueLabel, sortReminders, isReminder } from "../public/remindersPanel.js";
import { ago } from "../public/newsPanel.js";
import { scoreLine, parseQuizCommand } from "../public/quizModal.js";

test("quiz commands open a quiz, with an optional topic, and ordinary chat does not", () => {
  for (const phrase of ["quiz me", "Quiz me!", "Jarvis, quiz me", "can you quiz me", "test me", "give me a quiz", "start a quick quiz", "ask me a devops question", "go ahead and quiz me please"])
    assert.deepEqual(parseQuizCommand(phrase), { topic: null }, phrase);
  assert.deepEqual(parseQuizCommand("quiz me on kubernetes"), { topic: "Kubernetes" });
  assert.deepEqual(parseQuizCommand("Jarvis quiz me about k8s"), { topic: "Kubernetes" });
  assert.deepEqual(parseQuizCommand("quiz me on Network+"), { topic: "Networking" });
  assert.deepEqual(parseQuizCommand("test me on terraform"), { topic: "Terraform" });
  assert.deepEqual(parseQuizCommand("quiz me on docker containers"), { topic: "Docker" });
  assert.deepEqual(parseQuizCommand("quiz me on github actions"), { topic: "CI/CD" });
  assert.deepEqual(parseQuizCommand("quiz me on AWS"), { topic: "AWS" });
  assert.deepEqual(parseQuizCommand("quiz me on cooking"), { unknown: "cooking" });
  for (const phrase of ["what is a quiz", "I took a quiz yesterday", "add task study for quiz", "open my tasks", "fix the quiz bug", "", "quiz"])
    assert.equal(parseQuizCommand(phrase), null, phrase);
  assert.equal(parseQuizCommand(42), null);
});

test("news ages read naturally and quiz scores come with a comment", () => {
  const now = Date.parse("2026-10-28T20:00:00Z");
  assert.equal(ago("2026-10-28T19:59:30Z", now), "just now");
  assert.equal(ago("2026-10-28T19:48:00Z", now), "12 min ago");
  assert.equal(ago("2026-10-28T17:00:00Z", now), "3 h ago");
  assert.equal(ago("2026-10-26T20:00:00Z", now), "2 d ago");
  assert.equal(ago("garbage", now), "");
  assert.match(scoreLine(5, 5), /^5 of 5\. Perfect/);
  assert.match(scoreLine(3, 5), /^3 of 5\. Solid/);
  assert.match(scoreLine(1, 5), /^1 of 5\. Keep going/);
});

const NOW = Date.parse("2026-10-28T20:00:00Z");

test("a running errand shows a plain title, step count and elapsed time", () => {
  const info = describeProgress({
    request: "On my PC, execute this task: fix the login bug in Jarvis", status: "running", progress: "Editing app/src/login.ts",
    startedAt: "2026-10-28T19:58:30Z", heartbeatAt: "2026-10-28T19:59:50Z", activity: [{ text: "Reading files", at: "x" }, { text: "Editing app/src/login.ts", at: "y" }],
  }, NOW);
  assert.equal(info.title, "fix the login bug in Jarvis");
  assert.equal(info.step, 2);
  assert.equal(info.ratio, null);
  assert.equal(info.elapsedMs, 90000);
  assert.equal(info.quiet, false);
  assert.equal(info.waiting, false);
});

test("job applications show a real progress ratio, capped at the limit", () => {
  const plan = { kind: "jobs", action: "submit", maxApplications: 4 };
  const base = { request: "Apply to 4 job applications.", status: "running", startedAt: "2026-10-28T19:00:00Z", plan };
  assert.equal(describeProgress({ ...base, confirmedThisTask: 1 }, NOW).ratio, 0.25);
  assert.equal(describeProgress({ ...base, confirmedThisTask: 9 }, NOW).ratio, 1);
  assert.equal(describeProgress({ ...base, confirmedThisTask: 1 }, NOW).counted, "1 of 4 applications");
  assert.equal(describeProgress({ ...base, plan: { kind: "jobs", action: "search", maxApplications: 0 } }, NOW).ratio, null);
});

test("a silent agent is flagged quiet and a pending approval is flagged waiting", () => {
  const stale = describeProgress({ request: "x", status: "running", startedAt: "2026-10-28T19:00:00Z", heartbeatAt: "2026-10-28T19:57:00Z" }, NOW);
  assert.equal(stale.quiet, true);
  const waiting = describeProgress({ request: "x", status: "running", startedAt: "2026-10-28T19:59:00Z", approvals: [{ id: "a", expiresAt: "2026-10-28T20:05:00Z" }] }, NOW);
  assert.equal(waiting.waiting, true);
  const decided = describeProgress({ request: "x", status: "running", startedAt: "2026-10-28T19:59:00Z", approvals: [{ id: "a", decision: "allow", expiresAt: "2026-10-28T20:05:00Z" }] }, NOW);
  assert.equal(decided.waiting, false);
});

test("recent steps list the newest first and are bounded", () => {
  const activity = Array.from({ length: 10 }, (_, i) => ({ text: `step ${i + 1}`, at: String(i) }));
  const steps = recentSteps({ activity }, 4);
  assert.deepEqual(steps.map(s => s.text), ["step 10", "step 9", "step 8", "step 7"]);
  assert.deepEqual(recentSteps({}), []);
});

test("reminder times read the way a person would say them", () => {
  const now = new Date(2026, 9, 28, 14, 0);
  assert.deepEqual(dueLabel(new Date(2026, 9, 28, 14, 20).toISOString(), now), { text: "In 20 min", state: "soon" });
  assert.deepEqual(dueLabel(new Date(2026, 9, 28, 18, 30).toISOString(), now), { text: "Today 6:30 PM", state: "today" });
  assert.deepEqual(dueLabel(new Date(2026, 9, 29, 9, 0).toISOString(), now), { text: "Tomorrow 9:00 AM", state: "later" });
  assert.deepEqual(dueLabel(new Date(2026, 9, 28, 13, 15).toISOString(), now), { text: "Overdue 45 min", state: "overdue" });
  assert.equal(dueLabel("not a date", now).text, "No time set");
});

test("reminders sort soonest first, finished ones last, and only tagged tasks count", () => {
  const list = [
    { id: "c", done: false, remindAt: "2026-11-03T10:00:00Z" },
    { id: "a", done: false, remindAt: "2026-10-30T10:00:00Z" },
    { id: "done", done: true, remindAt: "2026-10-01T10:00:00Z" },
  ];
  assert.deepEqual(sortReminders(list).map(r => r.id), ["a", "c", "done"]);
  assert.equal(isReminder({ tag: "Reminder", remindAt: "2026-10-30T10:00:00Z" }), true);
  assert.equal(isReminder({ tag: "Personal" }), false);
  assert.equal(isReminder({ tag: "Reminder" }), false);
});
