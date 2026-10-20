// The daily morning job run, scheduled inside Jarvis.
//
// Every morning at MORNING_RUN_TIME (default 7:00 AM Dallas time) the server
// queues one PC task: "Apply to N job applications" (N = MORNING_RUN_COUNT,
// default 10). The PC worker picks it up like any other task, so the live
// view, reports, cancel and the safety rules all apply. Rules:
//  - One run per day (the request ID carries the date, so a restart or a
//    second tick can never queue it twice).
//  - It only queues inside a window after the scheduled time, so deploying at
//    3 PM does not start a surprise run.
//  - A scheduled task still waiting from an earlier day (PC was off) is
//    cancelled instead of running late.
//  - It can be paused from the dashboard; the choice is saved on the server.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.ts";
import { dashboardDir } from "../dashboard.ts";
import { cancelPcTask, enqueuePcTask, readPcTasks, type PcTask } from "../pcTasks/store.ts";

export const MORNING_ID = "morning";
const REQUEST_PREFIX = "scheduled-morning-";
/** How long after the scheduled time a run may still be queued. */
export const WINDOW_MINUTES = 180;
/** A scheduled task still queued this long after it was created is stale. */
const STALE_QUEUED_MS = 12 * 3600_000;

export interface MorningSettings { time: string; count: number; timezone: string; }
export interface ScheduleState { enabled: boolean; }

// --- Time helpers (pure) ---
/** "07:00" -> 420 minutes after midnight; undefined for anything else. */
export function parseTime(value: string): number | undefined {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

function partsIn(date: Date, timeZone: string): { date: string; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** The local date and minutes-after-midnight in a time zone. */
export function localNow(now: Date, timeZone: string) { return partsIn(now, timeZone); }

/** The UTC moment when a time zone's clock shows `date` at `minutes`. */
function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let instant = guess;
  for (let i = 0; i < 2; i++) { // twice, so a daylight-saving change between the guess and the answer is handled
    const shown = partsIn(new Date(instant), timeZone);
    const [sy, sm, sd] = shown.date.split("-").map(Number) as [number, number, number];
    const shownAsUtc = Date.UTC(sy, sm - 1, sd, Math.floor(shown.minutes / 60), shown.minutes % 60);
    instant += guess - shownAsUtc;
  }
  return new Date(instant);
}

/** The next time the schedule fires at or after `now`. */
export function nextRun(now: Date, s: MorningSettings): Date {
  const at = parseTime(s.time) ?? 420;
  const today = zonedInstant(localNow(now, s.timezone).date, at, s.timezone);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  return zonedInstant(localNow(tomorrow, s.timezone).date, at, s.timezone);
}

/** True from the scheduled time until WINDOW_MINUTES later, on the same local day. */
export function isDue(now: Date, s: MorningSettings): boolean {
  const at = parseTime(s.time) ?? 420;
  const { minutes } = localNow(now, s.timezone);
  return minutes >= at && minutes < at + WINDOW_MINUTES;
}

// --- The queued request ---
export const morningRequest = (count: number): string => `Apply to ${count} job applications. Scheduled morning run.`;
export const morningDisplay = (count: number): string => `Morning job run (scheduled): apply to ${count} jobs`;
export const morningRequestId = (date: string): string => REQUEST_PREFIX + date;
const isMorningTask = (t: PcTask): boolean => Boolean(t.requestId?.startsWith(REQUEST_PREFIX));

// --- Saved on/off choice ---
const stateFile = (config: AppConfig) => join(dashboardDir(config), "schedules.json");

export async function readScheduleState(config: AppConfig): Promise<ScheduleState> {
  try {
    const value = JSON.parse(await readFile(stateFile(config), "utf8"));
    return { enabled: value?.morning?.enabled !== false };
  } catch { return { enabled: true }; }
}

export async function setMorningEnabled(config: AppConfig, enabled: boolean): Promise<ScheduleState> {
  const dir = dashboardDir(config);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `schedules-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify({ morning: { enabled } }, null, 2), { mode: 0o600 });
  await rename(temp, stateFile(config));
  return { enabled };
}

// --- One check, called once a minute ---
/** Queues today's run when it is due, and cancels scheduled runs left waiting from an earlier day. */
export async function tickMorning(config: AppConfig, now = new Date()): Promise<PcTask | undefined> {
  if (!config.pcWorkerToken) return;
  const dir = dashboardDir(config);
  const state = await readPcTasks(dir);
  for (const task of state.tasks) {
    if (isMorningTask(task) && task.status === "queued" && now.getTime() - Date.parse(task.createdAt) > STALE_QUEUED_MS) await cancelPcTask(dir, task.id, now);
  }
  const settings = config.morningRun;
  if (!(await readScheduleState(config)).enabled || !isDue(now, settings)) return;
  const date = localNow(now, settings.timezone).date;
  if (state.tasks.some(t => t.requestId === morningRequestId(date))) return;
  return enqueuePcTask(dir, morningRequest(settings.count), morningRequestId(date), now, morningDisplay(settings.count), "scoped");
}

// --- What the dashboard shows ---
export async function describeMorning(config: AppConfig, now = new Date()) {
  const settings = config.morningRun;
  const state = await readScheduleState(config);
  const tasks = (await readPcTasks(dashboardDir(config))).tasks.filter(isMorningTask);
  const last = tasks.at(-1);
  return {
    id: MORNING_ID, label: "Morning job run", time: settings.time, timezone: settings.timezone, count: settings.count,
    available: Boolean(config.pcWorkerToken), enabled: state.enabled,
    nextRun: nextRun(now, settings).toISOString(),
    last: last ? { status: last.status, createdAt: last.createdAt, finishedAt: last.finishedAt, submitted: last.report?.submitted, summary: (last.report?.summary ?? last.progress ?? "").slice(0, 240) } : undefined,
  };
}

/** Starts the once-a-minute check. Errors are logged without request text and never stop the server. */
export function startScheduler(config: AppConfig): () => void {
  const run = () => tickMorning(config).catch(() => console.error("morning schedule check failed"));
  void run();
  const timer = setInterval(run, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
