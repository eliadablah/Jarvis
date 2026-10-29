// The DevOps teacher's API.
//   GET  /api/learn         today's question, your streak and progress
//   GET  /api/learn/quiz    five questions for a practice round
//   POST /api/learn/answer  {id, choice, mode} -> right or wrong, the answer, why
// History is saved on the server (learn.json beside the dashboard tasks), and a
// question's answer is only sent after you have answered it.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { ChatRequestError, checkRequestSource, readBody } from "../api/chatRequest.ts";
import { dashboardDir } from "../dashboard.ts";
import { appHeaders } from "../http/securityHeaders.ts";
import { buildQuiz, dayKey, pickDaily, summarize, streakOf, type AnswerRecord } from "./engine.ts";
import { publicQuestion, questionById } from "./questions.ts";

interface LearnState { answers: AnswerRecord[]; daily?: { day: string; id: string }; }
const MAX_HISTORY = 2000;
const pending = new Map<string, Promise<unknown>>();

async function readState(dir: string): Promise<LearnState> {
  try {
    const value = JSON.parse(await readFile(join(dir, "learn.json"), "utf8"));
    return { answers: Array.isArray(value.answers) ? value.answers : [], daily: value.daily };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { answers: [] };
    throw error;
  }
}

/** Runs one read-change-write at a time so two quick answers can't overwrite each other. */
function update<T>(dir: string, change: (state: LearnState) => T): Promise<T> {
  const run = async () => {
    const state = await readState(dir);
    const result = change(state);
    state.answers = state.answers.slice(-MAX_HISTORY);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `learn-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, join(dir, "learn.json"));
    return result;
  };
  const result = (pending.get(dir) ?? Promise.resolve()).catch(() => {}).then(run);
  pending.set(dir, result);
  return result.finally(() => { if (pending.get(dir) === result) pending.delete(dir); });
}

/** Today's question, with the saved result if you've already answered it. */
export async function todayView(dir: string, timeZone: string, now = new Date()) {
  const day = dayKey(now, timeZone);
  return update(dir, state => {
    if (state.daily?.day !== day) state.daily = { day, id: pickDaily(state.answers, day).id };
    const question = questionById(state.daily.id)!;
    const done = [...state.answers].reverse().find(a => a.mode === "daily" && a.day === day && a.id === question.id);
    return {
      day, daily: { ...publicQuestion(question), ...(done ? { answered: true, choice: done.choice, correct: done.correct, answer: question.answer, why: question.why } : { answered: false }) },
      ...summarize(state.answers, day),
    };
  });
}

export async function recordAnswer(dir: string, input: { id: unknown; choice: unknown; mode: unknown }, timeZone: string, now = new Date()) {
  const question = typeof input.id === "string" ? questionById(input.id) : undefined;
  if (!question) throw new ChatRequestError(404, "Unknown question.");
  if (!Number.isInteger(input.choice) || (input.choice as number) < 0 || (input.choice as number) > 3) throw new ChatRequestError(400, "Pick one of the four answers.");
  const mode = input.mode === "daily" ? "daily" : "quiz";
  const day = dayKey(now, timeZone), choice = input.choice as number;
  return update(dir, state => {
    if (mode === "daily") {
      if (state.daily?.day !== day || state.daily.id !== question.id) throw new ChatRequestError(400, "That isn't today's question.");
      const earlier = state.answers.find(a => a.mode === "daily" && a.day === day && a.id === question.id);
      if (earlier) return { correct: earlier.correct, answer: question.answer, why: question.why, streak: streakOf(state.answers, day), alreadyAnswered: true };
    }
    const correct = choice === question.answer;
    state.answers.push({ id: question.id, correct, choice, day, at: now.toISOString(), mode });
    return { correct, answer: question.answer, why: question.why, streak: streakOf(state.answers, day) };
  });
}

export async function handleLearn(req: IncomingMessage, res: ServerResponse, path: string, config: AppConfig): Promise<void> {
  const send = (status: number, body: unknown) => { res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  const dir = dashboardDir(config), tz = config.morningRun.timezone, method = req.method ?? "GET";
  try {
    if (path === "/api/learn" && (method === "GET" || method === "HEAD")) { send(200, await todayView(dir, tz)); return; }
    if (path === "/api/learn/quiz" && (method === "GET" || method === "HEAD")) {
      const state = await readState(dir);
      send(200, { questions: buildQuiz(state.answers).map(publicQuestion) }); return;
    }
    if (path === "/api/learn/answer" && method === "POST") {
      checkRequestSource(req.headers);
      let body: unknown;
      try { body = JSON.parse(await readBody(req)); } catch (err) { if (err instanceof ChatRequestError) throw err; throw new ChatRequestError(400, "Invalid JSON."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ChatRequestError(400, "Expected an object.");
      send(200, await recordAnswer(dir, body as Record<string, unknown> as { id: unknown; choice: unknown; mode: unknown }, tz)); return;
    }
    send(405, { error: "Method not allowed" });
  } catch (error) {
    if (error instanceof ChatRequestError) send(error.status, { error: error.message });
    else { console.error("learn storage failed"); send(500, { error: "The teacher could not save that. Please try again." }); }
  }
}
