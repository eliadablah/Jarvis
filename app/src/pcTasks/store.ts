// Queue of jobs Jarvis hands to my PC (for now: finding and applying to
// jobs in my own signed-in Chrome). The server only stores requests and
// results; the PC worker (pc-worker/) does the work and reports back.
// Saved next to the dashboard state, one JSON file, written atomically.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type PcTaskStatus = "queued" | "running" | "done" | "failed";

export interface PcTask {
  id: string;
  kind: "jobs";
  /** What I asked Jarvis, verbatim (bounded). */
  request: string;
  status: PcTaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** The worker's final report, bounded. */
  result?: string;
}

export interface PcTaskState { tasks: PcTask[]; workerSeenAt?: string; }

const FILE = "pc-tasks.json";
const MAX_TASKS = 100;
export const MAX_REQUEST_CHARS = 2000;
export const MAX_RESULT_CHARS = 8000;
/** A running task with no report after this long is marked failed. */
const STALE_RUNNING_MS = 3 * 60 * 60_000;

const pending = new Map<string, Promise<unknown>>();

export async function readPcTasks(dir: string): Promise<PcTaskState> {
  try {
    const value = JSON.parse(await readFile(join(dir, FILE), "utf8"));
    if (!Array.isArray(value.tasks)) throw new Error("Invalid PC task state");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tasks: [] };
    throw error;
  }
}

/** Runs one read-modify-write at a time per folder, then saves atomically. */
async function mutate<T>(dir: string, change: (state: PcTaskState) => T): Promise<T> {
  const run = async () => {
    const state = await readPcTasks(dir);
    const value = change(state);
    state.tasks = state.tasks.slice(-MAX_TASKS);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `pc-tasks-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, join(dir, FILE));
    return value;
  };
  const result = (pending.get(dir) ?? Promise.resolve()).catch(() => {}).then(run);
  pending.set(dir, result);
  try { return await result; } finally { if (pending.get(dir) === result) pending.delete(dir); }
}

export function enqueuePcTask(dir: string, request: string, now = new Date()): Promise<PcTask> {
  return mutate(dir, state => {
    const task: PcTask = { id: randomUUID(), kind: "jobs", request: request.slice(0, MAX_REQUEST_CHARS),
      status: "queued", createdAt: now.toISOString() };
    state.tasks.push(task);
    return task;
  });
}

/** Called by the worker: marks it seen and hands over the oldest queued task, if any. */
export function claimNextPcTask(dir: string, now = new Date()): Promise<PcTask | undefined> {
  return mutate(dir, state => {
    state.workerSeenAt = now.toISOString();
    for (const task of state.tasks) {
      if (task.status === "running" && task.startedAt && now.getTime() - Date.parse(task.startedAt) > STALE_RUNNING_MS) {
        task.status = "failed";
        task.finishedAt = now.toISOString();
        task.result = "The PC worker stopped reporting (PC asleep or restarted?).";
      }
    }
    const task = state.tasks.find(t => t.status === "queued");
    if (task) { task.status = "running"; task.startedAt = now.toISOString(); }
    return task;
  });
}

export function finishPcTask(dir: string, id: string, ok: boolean, result: string, now = new Date()): Promise<PcTask | undefined> {
  return mutate(dir, state => {
    const task = state.tasks.find(t => t.id === id);
    if (!task || task.status !== "running") return undefined;
    task.status = ok ? "done" : "failed";
    task.finishedAt = now.toISOString();
    task.result = result.slice(0, MAX_RESULT_CHARS);
    return task;
  });
}

/** The worker polls every 30 s; two minutes of silence means it's off. */
export function workerOnline(state: PcTaskState, now = Date.now()): boolean {
  return Boolean(state.workerSeenAt && now - Date.parse(state.workerSeenAt) < 2 * 60_000);
}
