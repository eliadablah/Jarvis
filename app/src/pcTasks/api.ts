import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { ChatRequestError, readBody, checkRequestSource, isValidSessionId } from "../api/chatRequest.ts";
import { dashboardDir } from "../dashboard.ts";
import { appHeaders } from "../http/securityHeaders.ts";
import { PC_PROTOCOL, CAPABILITIES, sanitizeLimits, type ExecutorStatus } from "./protocol.ts";
import { claimNextPcTask, finishPcTask, heartbeatPcTask, cancelPcTask, pcSnapshot, publicTask, setPcLimits, workerOnline, type PcTask } from "./store.ts";
function json(res: ServerResponse, status: number, value?: unknown): void {
  res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}
export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(token));
}
async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readBody(req));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (e) { if (e instanceof ChatRequestError) throw e; throw new ChatRequestError(400, "Expected a JSON object."); }
}
function uuid(value: unknown): value is string { return typeof value === "string" && isValidSessionId(value); }
function executorsOf(value: unknown): ExecutorStatus[] {
  if (!Array.isArray(value) || value.length > 8 || !value.every(e => e && typeof e.id === "string" &&
    /^[a-z-]{1,60}$/.test(e.id) && ["ready", "cooldown", "unavailable"].includes(e.state) &&
    typeof e.reason === "string" && e.reason.length <= 300 && e.remainingTokens === null &&
    (e.retryAt === undefined || typeof e.retryAt === "string" && Number.isFinite(Date.parse(e.retryAt))) &&
    Array.isArray(e.capabilities) && e.capabilities.length <= 4 && e.capabilities.every((c: string) => CAPABILITIES.includes(c as typeof CAPABILITIES[number]))))
    throw new ChatRequestError(400, "Invalid agent capabilities.");
  return value;
}
export async function handlePcTasks(req: IncomingMessage, res: ServerResponse, path: string, config: AppConfig): Promise<void> {
  const method = req.method ?? "GET", dir = dashboardDir(config);
  try {
    if (path === "/api/pc/tasks" && (method === "GET" || method === "HEAD")) {
      const state = await pcSnapshot(dir);
      json(res, 200, { protocol: PC_PROTOCOL, enabled: Boolean(config.pcWorkerToken), workerOnline: workerOnline(state), workerSeenAt: state.workerSeenAt,
        executors: state.executors ?? [], limits: state.limits ?? {}, tasks: state.tasks.slice(-100).reverse().map(publicTask) }); return;
    }
    if (method !== "POST") { json(res, 405, { error: "Method not allowed" }); return; }
    const match = /^\/api\/pc\/tasks\/([0-9a-f-]{36})\/(result|heartbeat|cancel)$/.exec(path);
    if (match?.[2] === "cancel") {
      checkRequestSource(req.headers); await bodyOf(req);
      const task = await cancelPcTask(dir, match[1]!);
      json(res, task ? 200 : 404, task ? { task: publicTask(task) } : { error: "Task not found." }); return;
    }
    if (!tokenMatches(req.headers.authorization, config.pcWorkerToken)) { json(res, 401, { error: "Worker token required." }); return; }
    const raw = await readBody(req);
    if (!raw.trim()) { json(res, 426, { error: "Update the PC worker to protocol 2 before claiming tasks." }); return; }
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new ChatRequestError(400, "Invalid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ChatRequestError(400, "Expected an object.");
    if (body.protocol !== PC_PROTOCOL) { json(res, 426, { error: "PC worker update required." }); return; }
    if (!uuid(body.workerId)) throw new ChatRequestError(400, "Invalid worker ID.");
    // Usage limits ride along on claims and heartbeats; a bad reading is ignored, never an error.
    if (body.limits !== undefined) { const limits = sanitizeLimits(body.limits); if (limits.claude || limits.codex) await setPcLimits(dir, limits); }
    if (path === "/api/pc/tasks/claim") {
      const task = await claimNextPcTask(dir, body.workerId, executorsOf(body.executors));
      if (task) json(res, 200, { task }); else json(res, 204); return;
    }
    if (!match || !uuid(body.lease)) throw new ChatRequestError(400, "Invalid task claim.");
    if (match[2] === "heartbeat") {
      if (typeof body.progress !== "string" || body.progress.length > 300 || (body.executor !== undefined && typeof body.executor !== "string"))
        throw new ChatRequestError(400, "Invalid progress.");
      const state = await heartbeatPcTask(dir, match[1]!, body.workerId, body.lease, body.progress, body.executor as string | undefined);
      json(res, state ? 200 : 409, state ?? { error: "Claim no longer active. Stop execution." }); return;
    }
    if (!uuid(body.reportId)) throw new ChatRequestError(400, "Invalid report ID.");
    let task;
    try { task = await finishPcTask(dir, match[1]!, body.workerId, body.lease, body.reportId, body.report); }
    catch { throw new ChatRequestError(400, "Invalid structured task report."); }
    json(res, task ? 200 : 409, task ? { task: publicTask(task) } : { error: "Claim does not own this task." });
  } catch (e) {
    if (e instanceof ChatRequestError) json(res, e.status, { error: e.message });
    else { console.error("PC task storage failed"); json(res, 500, { error: "Could not save. Please try again." }); }
  }
}
export function pcTaskContext(tasks: PcTask[]): string {
  const recent = tasks.slice(-5).map(t => ({ id: t.id, request: (t.displayRequest ?? t.request).slice(0, 300), status: t.status, createdAt: t.createdAt, finishedAt: t.finishedAt,
    executor: t.executor, progress: t.progress, report: t.report ?? t.result?.slice(0, 1500) }));
  return JSON.stringify({ source: "PC agent reports, not independent verification. Legacy done means process exit only.", recent })
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
