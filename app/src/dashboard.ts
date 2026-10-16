import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "./config.ts";
import { getRoutingStatus } from "./brain/router.ts";
import { ChatRequestError, checkRequestSource, readBody } from "./api/chatRequest.ts";
import { appHeaders } from "./http/securityHeaders.ts";

export interface DashboardTask { id: string; title: string; done: boolean; tag: string; createdAt: string; }
interface DashboardState { tasks: DashboardTask[]; }
const pending = new Map<string, Promise<unknown>>();
export function dashboardDir(_config: AppConfig): string {
  return process.env.JARVIS_DATA_DIR?.trim() || join(homedir(), "workspace", "dashboard");
}
export async function readDashboard(dir: string): Promise<DashboardState> {
  try {
    const value = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
    if (!Array.isArray(value.tasks)) throw new Error("Invalid dashboard state");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tasks: [] };
    throw error;
  }
}
export async function updateTask(dir: string, action: "add" | "update" | "delete", input: Record<string, unknown>, id?: string): Promise<DashboardState> {
  const run = async () => {
    const state = await readDashboard(dir);
    if (action === "add") {
      if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 300) throw new ChatRequestError(400, "A task needs a title of 1–300 characters.");
      if (state.tasks.length >= 500) throw new ChatRequestError(400, "Task limit reached.");
      state.tasks.push({ id: randomUUID(), title: input.title.trim(), done: false, tag: "Personal", createdAt: new Date().toISOString() });
    } else {
      const task = state.tasks.find(task => task.id === id);
      if (!task) throw new ChatRequestError(404, "Task not found.");
      if (action === "delete") state.tasks = state.tasks.filter(task => task.id !== id);
      else {
        if (typeof input.done !== "boolean") throw new ChatRequestError(400, "done must be true or false.");
        task.done = input.done;
      }
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `state-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, join(dir, "state.json"));
    return state;
  };
  const result = (pending.get(dir) ?? Promise.resolve()).catch(() => {}).then(run);
  pending.set(dir, result);
  try { return await result; } finally { if (pending.get(dir) === result) pending.delete(dir); }
}
function json(res: ServerResponse, status: number, value: unknown, head = false): void {
  res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(head ? undefined : JSON.stringify(value));
}
export async function handleDashboard(req: IncomingMessage, res: ServerResponse, path: string, config: AppConfig): Promise<void> {
  const method = req.method ?? "GET";
  try {
    if (path === "/api/dashboard" && (method === "GET" || method === "HEAD")) {
      const state = await readDashboard(dashboardDir(config));
      json(res, 200, { ...state, bills: [], routines: [], routing: getRoutingStatus(config), env: config.env, version: config.version,
        connectors: { gmail: { state: config.codex?.connectorsEnabled ? "enabled" : "disabled", detail: "Read-only Gmail through Codex. Ask to check your inbox." }, calendar: { state: config.codex?.connectorsEnabled ? "enabled" : "disabled", detail: "Read-only Calendar through Codex. Ask to check today." } } }, method === "HEAD");
      return;
    }
    const match = /^\/api\/dashboard\/tasks(?:\/([0-9a-f-]{36}))?$/.exec(path);
    if (!match || !["POST", "PATCH", "DELETE"].includes(method) || (method !== "POST" && !match[1])) { json(res, 405, { error: "Method not allowed" }); return; }
    checkRequestSource(req.headers);
    let body: unknown;
    try { body = JSON.parse(await readBody(req)); } catch (err) { if (err instanceof ChatRequestError) throw err; throw new ChatRequestError(400, "Invalid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ChatRequestError(400, "Expected an object.");
    const state = await updateTask(dashboardDir(config), method === "POST" ? "add" : method === "PATCH" ? "update" : "delete", body as Record<string, unknown>, match[1]);
    json(res, method === "POST" ? 201 : 200, state);
  } catch (error) {
    if (error instanceof ChatRequestError) json(res, error.status, { error: error.message });
    else { console.error("dashboard storage failed"); json(res, 500, { error: "Dashboard could not save. Please try again." }); }
  }
}
