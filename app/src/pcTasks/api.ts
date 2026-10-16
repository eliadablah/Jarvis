// HTTP side of the PC task queue.
//   GET  /api/pc/tasks              recent tasks + whether the worker is online (browser)
//   POST /api/pc/tasks/claim        worker: take the next queued task (204 if none)
//   POST /api/pc/tasks/<id>/result  worker: report { ok, result }
// Worker calls need "Authorization: Bearer <PC_WORKER_TOKEN>". Without a
// token configured, the worker endpoints stay closed.

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { ChatRequestError, readBody } from "../api/chatRequest.ts";
import { dashboardDir } from "../dashboard.ts";
import { appHeaders } from "../http/securityHeaders.ts";
import { claimNextPcTask, finishPcTask, readPcTasks, workerOnline, type PcTask } from "./store.ts";

function json(res: ServerResponse, status: number, value?: unknown): void {
  res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}

/** Constant-time token check (hashing first makes the lengths equal). */
export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(token));
}

export async function handlePcTasks(req: IncomingMessage, res: ServerResponse, path: string, config: AppConfig): Promise<void> {
  const method = req.method ?? "GET";
  const dir = dashboardDir(config);
  try {
    if (path === "/api/pc/tasks" && (method === "GET" || method === "HEAD")) {
      const state = await readPcTasks(dir);
      json(res, 200, { enabled: Boolean(config.pcWorkerToken), workerOnline: workerOnline(state), tasks: state.tasks.slice(-20).reverse() });
      return;
    }

    if (method !== "POST") { json(res, 405, { error: "Method not allowed" }); return; }
    if (!tokenMatches(req.headers.authorization, config.pcWorkerToken)) { json(res, 401, { error: "Worker token required." }); return; }

    if (path === "/api/pc/tasks/claim") {
      const task = await claimNextPcTask(dir);
      if (task) json(res, 200, { task }); else json(res, 204);
      return;
    }

    const match = /^\/api\/pc\/tasks\/([0-9a-f-]{36})\/result$/.exec(path);
    if (!match?.[1]) { json(res, 404, { error: "Not found" }); return; }
    let body: { ok?: unknown; result?: unknown };
    try { body = JSON.parse(await readBody(req)); } catch (err) { if (err instanceof ChatRequestError) throw err; throw new ChatRequestError(400, "Invalid JSON."); }
    if (typeof body?.ok !== "boolean" || typeof body.result !== "string") throw new ChatRequestError(400, "Expected { ok, result }.");
    const task = await finishPcTask(dir, match[1], body.ok, body.result);
    if (task) json(res, 200, { task }); else json(res, 404, { error: "No running task with that ID." });
  } catch (error) {
    if (error instanceof ChatRequestError) json(res, error.status, { error: error.message });
    else { console.error("pc task storage failed"); json(res, 500, { error: "Could not save. Please try again." }); }
  }
}

/** Recent PC task results, as data for the chat engines (never instructions). */
export function pcTaskContext(tasks: PcTask[]): string {
  const recent = tasks.slice(-5).map(t => ({ request: t.request.slice(0, 300), status: t.status, createdAt: t.createdAt,
    finishedAt: t.finishedAt, report: t.result?.slice(0, 1500) }));
  return JSON.stringify({ source: "Errands Jarvis handed to Eli's PC worker", recent })
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
