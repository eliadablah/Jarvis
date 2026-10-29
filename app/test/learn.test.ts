import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QUESTIONS, TOPICS, publicQuestion } from "../src/learn/questions.ts";
import { buildQuiz, dayKey, pickDaily, streakOf, summarize, type AnswerRecord } from "../src/learn/engine.ts";
import { recordAnswer, todayView } from "../src/learn/api.ts";

const TZ = "America/Chicago";
const rec = (id: string, correct: boolean, day: string, at = day + "T12:00:00Z"): AnswerRecord => ({ id, correct, choice: 0, day, at, mode: "daily" });

test("the question bank is well formed", () => {
  assert.ok(QUESTIONS.length >= 50);
  assert.equal(new Set(QUESTIONS.map(q => q.id)).size, QUESTIONS.length, "ids are unique");
  for (const q of QUESTIONS) {
    assert.equal(new Set(q.choices).size, 4, q.id + " has four different choices");
    assert.ok([0, 1, 2, 3].includes(q.answer), q.id);
    assert.ok(q.q.length > 10 && q.why.length > 20, q.id);
  }
  for (const topic of TOPICS) assert.ok(QUESTIONS.filter(q => q.topic === topic).length >= 5, topic);
  const positions = [0, 1, 2, 3].map(i => QUESTIONS.filter(q => q.answer === i).length);
  assert.ok(positions.every(n => n >= 8), "the right answer is spread across positions: " + positions);
});

test("the browser view of a question never contains the answer", () => {
  const view = publicQuestion(QUESTIONS[0]!);
  assert.deepEqual(Object.keys(view).sort(), ["choices", "id", "q", "topic"]);
});

test("days are counted in your time zone", () => {
  assert.equal(dayKey(new Date("2026-10-29T03:30:00Z"), TZ), "2026-10-28");
  assert.equal(dayKey(new Date("2026-10-29T06:30:00Z"), TZ), "2026-10-29");
});

test("the first daily question starts at the first topic, then rotates to the least-practiced topic", () => {
  const first = pickDaily([], "2026-10-28");
  assert.equal(first.topic, "Networking");
  const second = pickDaily([rec(first.id, true, "2026-10-28")], "2026-10-29");
  assert.equal(second.topic, "Linux");
});

test("a missed question comes back after two days, not before", () => {
  const history = [rec("net-01", false, "2026-10-28", "2026-10-28T12:00:00Z")];
  assert.notEqual(pickDaily(history, "2026-10-29").id, "net-01");
  assert.equal(pickDaily(history, "2026-10-30").id, "net-01");
});

test("the streak counts consecutive days and survives not having answered yet today", () => {
  const history = [rec("a", true, "2026-10-26"), rec("b", true, "2026-10-27"), rec("c", false, "2026-10-28")];
  assert.equal(streakOf(history, "2026-10-28"), 3);
  assert.equal(streakOf(history, "2026-10-29"), 3, "yesterday still counts until today ends");
  assert.equal(streakOf(history, "2026-10-30"), 0, "a missed day resets it");
  assert.equal(streakOf([], "2026-10-28"), 0);
});

test("a quiz has five questions from different topics and prefers questions you missed", () => {
  const quiz = buildQuiz([rec("tf-01", false, "2026-10-20")], 5, () => 0.5);
  assert.equal(quiz.length, 5);
  assert.equal(new Set(quiz.map(q => q.topic)).size, 5);
  assert.ok(quiz.some(q => q.id === "tf-01"), "the missed question is included");
  assert.equal(summarize([rec("net-01", true, "2026-10-28")], "2026-10-28").byTopic[0]!.correct, 1);
});

test("a topic quiz only asks that topic, and a topic with fewer questions than five still works", () => {
  const k8s = QUESTIONS.filter(q => q.topic === "Kubernetes");
  const quiz = buildQuiz([], 5, () => 0.3, k8s);
  assert.equal(quiz.length, 5);
  assert.ok(quiz.every(q => q.topic === "Kubernetes"));
  assert.equal(new Set(quiz.map(q => q.id)).size, 5);
  assert.equal(buildQuiz([], 5, () => 0.3, k8s.slice(0, 3)).length, 3);
});

test("answering: the answer is revealed only after, results are saved, and the daily can't be answered twice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-learn-"));
  const now = new Date("2026-10-28T18:00:00Z");
  try {
    const today = await todayView(dir, TZ, now);
    assert.equal(today.daily.answered, false);
    assert.equal("answer" in today.daily, false);
    assert.equal("why" in today.daily, false);
    const id = today.daily.id, right = QUESTIONS.find(q => q.id === id)!.answer;

    const wrongChoice = (right + 1) % 4;
    const miss = await recordAnswer(dir, { id, choice: wrongChoice, mode: "daily" }, TZ, now);
    assert.equal(miss.correct, false);
    assert.equal(miss.answer, right);
    const again = await recordAnswer(dir, { id, choice: right, mode: "daily" }, TZ, now);
    assert.equal(again.alreadyAnswered, true);
    assert.equal(again.correct, false, "the first answer stands");

    const after = await todayView(dir, TZ, now);
    assert.equal(after.daily.answered, true);
    assert.equal(after.answeredToday, 1);
    assert.equal(after.streak, 1);

    await assert.rejects(recordAnswer(dir, { id: "nope", choice: 0, mode: "quiz" }, TZ, now), /Unknown question/);
    await assert.rejects(recordAnswer(dir, { id, choice: 7, mode: "quiz" }, TZ, now), /one of the four/);
    await assert.rejects(recordAnswer(dir, { id: "tf-01", choice: 0, mode: "daily" }, TZ, now), /today's question/);
    const practice = await recordAnswer(dir, { id: "tf-01", choice: QUESTIONS.find(q => q.id === "tf-01")!.answer, mode: "quiz" }, TZ, now);
    assert.equal(practice.correct, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
