import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parsePcIntent } from "./intent.ts";
import { MAX_REQUEST_CHARS, capabilityFor, validateReport, type PcPlan, type PcReport, type ExecutorStatus } from "./protocol.ts";
export { MAX_REQUEST_CHARS } from "./protocol.ts";
export type PcTaskStatus = "queued" | "running" | "cancelling" | "completed" | "partial" | "needs_input" | "needs_attention" | "failed" | "cancelled" | "done";
export interface PcTask {
  id: string; kind: PcPlan["kind"]; request: string; displayRequest?: string; plan?: PcPlan; status: PcTaskStatus;
  createdAt: string; startedAt?: string; finishedAt?: string; result?: string;
  workerId?: string; lease?: string; heartbeatAt?: string; executor?: string; progress?: string;
  cancelRequested?: boolean; report?: PcReport; reportId?: string; requestId?: string;
}
export interface PcTaskState { tasks: PcTask[]; workerSeenAt?: string; workerId?: string; executors?: ExecutorStatus[]; }
export const LEASE_MS = 120_000;
const pending = new Map<string, Promise<unknown>>();
const active = (t: PcTask) => ["queued", "running", "cancelling"].includes(t.status);
export async function readPcTasks(dir: string): Promise<PcTaskState> {
  try {
    const state = JSON.parse(await readFile(join(dir, "pc-tasks.json"), "utf8"));
    if (!Array.isArray(state.tasks)) throw new Error("Invalid PC task state");
    return state;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { tasks: [] }; throw e; }
}
function expire(state: PcTaskState, now: Date): void {
  for (const task of state.tasks) {
    const last = task.heartbeatAt ?? task.startedAt;
    const limit = task.lease ? LEASE_MS : 3 * 60 * 60_000;
    if (["running", "cancelling"].includes(task.status) && last && now.getTime() - Date.parse(last) > limit) {
      task.status = "needs_attention";
      task.progress = "PC stopped reporting. Check the result before retrying; this task will not run twice automatically.";
    }
  }
}
async function mutate<T>(dir: string, change: (state: PcTaskState) => T, now = new Date()): Promise<T> {
  const run = async () => {
    const state = await readPcTasks(dir); expire(state, now);
    const value = change(state);
    const recent = new Set(state.tasks.filter(t => !active(t)).slice(-100).map(t => t.id));
    state.tasks = state.tasks.filter(t => active(t) || recent.has(t.id));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, "pc-tasks-" + randomUUID() + ".tmp");
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
    await rename(temp, join(dir, "pc-tasks.json"));
    return value;
  };
  const result = (pending.get(dir) ?? Promise.resolve()).catch(() => {}).then(run);
  pending.set(dir, result);
  try { return await result; } finally { if (pending.get(dir) === result) pending.delete(dir); }
}
export function pcSnapshot(dir: string, now = new Date()): Promise<PcTaskState> { return mutate(dir, s => s, now); }
export function enqueuePcTask(dir: string, request: string, requestId?: string, now = new Date(), displayRequest?: string): Promise<PcTask> {
  if (request.length > MAX_REQUEST_CHARS) throw new Error("PC request exceeds 2000 characters; shorten it without removing limits.");
  const intent = parsePcIntent(request);
  if (intent?.type !== "task") throw new Error("Name an explicit PC action.");
  return mutate(dir, state => {
    const existing = requestId && state.tasks.find(t => t.requestId === requestId);
    if (existing) { if (existing.request !== request) throw new Error("Request ID already used."); return existing; }
    if (state.tasks.filter(active).length >= 100) throw new Error("PC queue is full.");
    const task: PcTask = { id: randomUUID(), kind: intent.plan.kind, plan: intent.plan, request,
      status: "queued", createdAt: now.toISOString(), ...(displayRequest ? { displayRequest: displayRequest.slice(0, MAX_REQUEST_CHARS) } : {}), ...(requestId ? { requestId } : {}) };
    state.tasks.push(task); return task;
  }, now);
}
export function claimNextPcTask(dir: string, workerId: string, executors: ExecutorStatus[], now = new Date()): Promise<PcTask | undefined> {
  return mutate(dir, state => {
    state.workerSeenAt = now.toISOString(); state.workerId = workerId; state.executors = executors;
    if (state.tasks.some(t => ["running", "cancelling"].includes(t.status))) return;
    const task = state.tasks.find(t => t.status === "queued"); if (!task) return;
    if (!task.plan) { task.status = "needs_input"; task.result = "Older task needs an explicit search, prepare, or submit request."; return; }
    const candidates = executors.filter(e => e.capabilities.includes(capabilityFor(task.plan!)));
    if (!candidates.some(e => e.state === "ready")) {
      task.progress = candidates.some(e => e.state === "cooldown") ? "Waiting for a capable agent's usage limit to reset." : "No ready agent has the required tools. Check PC agents.";
      if (!candidates.some(e => e.state === "cooldown")) { task.status = "needs_input"; task.result = task.progress; }
      return;
    }
    task.status = "running"; task.startedAt = now.toISOString(); task.heartbeatAt = now.toISOString();
    task.workerId = workerId; task.lease = randomUUID(); task.progress = "Claimed by PC; choosing an agent.";
    return task;
  }, now);
}
export function heartbeatPcTask(dir: string, id: string, workerId: string, lease: string, progress: string, executor?: string, now = new Date()) {
  return mutate(dir, state => {
    const task = state.tasks.find(t => t.id === id && t.workerId === workerId && t.lease === lease);
    if (!task || !["running", "cancelling"].includes(task.status)) return;
    state.workerSeenAt = now.toISOString(); task.heartbeatAt = now.toISOString();
    task.progress = progress.slice(0, 300); if (executor) task.executor = executor.slice(0, 60);
    return { cancelRequested: task.cancelRequested === true };
  }, now);
}
export function finishPcTask(dir: string, id: string, workerId: string, lease: string, reportId: string, value: unknown, now = new Date()) {
  return mutate(dir, state => {
    const task = state.tasks.find(t => t.id === id && t.workerId === workerId && t.lease === lease);
    if (!task?.plan) return;
    if (task.reportId === reportId) return task;
    if (task.reportId || !["running", "cancelling", "needs_attention"].includes(task.status)) return;
    const report = validateReport(value, task.plan);
    task.report = report; task.reportId = reportId; task.status = report.outcome;
    task.result = report.summary; task.finishedAt = now.toISOString();
    task.progress = task.cancelRequested && report.outcome !== "cancelled" ? "Finished before cancellation took effect; review the report." : report.summary.slice(0, 300);
    state.workerSeenAt = now.toISOString(); return task;
  }, now);
}
export function cancelPcTask(dir: string, id: string, now = new Date()) {
  return mutate(dir, state => {
    const task = state.tasks.find(t => t.id === id); if (!task) return;
    if (task.status === "queued") { task.status = "cancelled"; task.finishedAt = now.toISOString(); task.result = "Cancelled before execution."; }
    else if (["running", "cancelling"].includes(task.status)) { task.cancelRequested = true; task.status = "cancelling"; task.progress = "Stop requested. Waiting for the PC to confirm; completed actions cannot be undone."; }
    return task;
  }, now);
}
export function workerOnline(state: PcTaskState, now = Date.now()): boolean {
  return Boolean(state.workerSeenAt && now - Date.parse(state.workerSeenAt) < LEASE_MS);
}
/** Do not expose the bearer-equivalent claim lease to browsers or chat models. */
export function publicTask(task: PcTask): Omit<PcTask, "lease" | "workerId" | "reportId" | "requestId" | "displayRequest"> {
  const { lease, workerId, reportId, requestId, displayRequest, ...view } = task; return { ...view, request: displayRequest ?? view.request };
}
