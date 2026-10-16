// POST /api/chat: checks the request, asks Claude Code, and streams the
// answer back as newline-delimited JSON events (see brain/events.ts).
// Only one answer runs at a time, to keep the small server's memory safe.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { getChatRouter } from "../brain/router.ts";
import type { ChatEvent } from "../brain/events.ts";
import { ChatRequestError, checkRequestSource, parseChatRequest, readBody } from "./chatRequest.ts";
import { dashboardDir, readDashboard, type DashboardTask } from "../dashboard.ts";
import { pcTaskContext } from "../pcTasks/api.ts";
import { handOffPcErrand } from "../pcTasks/handoff.ts";
import { parsePcIntent } from "../pcTasks/intent.ts";
import { readPcTasks } from "../pcTasks/store.ts";

let busy = false;

/** Encode task titles as data, with a hard bound before they reach a model. */
export function buildDashboardContext(tasks: DashboardTask[]): string {
  const rows: string[] = [];
  let size = 0;
  for (const task of tasks.slice(0, 50)) {
    const row = JSON.stringify({ title: String(task.title).slice(0, 300), done: task.done === true })
      .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
    if (size + row.length > 9500) break;
    rows.push(row); size += row.length + 1;
  }
  return `{"source":"Server-saved Jarvis dashboard tasks","totalTasks":${tasks.length},"includedTasks":${rows.length},"tasks":[${rows.join(",")}]}`;
}

/** Sends a plain JSON error. */
function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error: message }));
}

/** Handles one chat request end to end. */
export async function handleChat(req: IncomingMessage, res: ServerResponse, config: AppConfig): Promise<void> {
  let chat;
  try {
    checkRequestSource(req.headers);
    chat = parseChatRequest(await readBody(req));
  } catch (err) {
    if (err instanceof ChatRequestError) return sendError(res, err.status, err.message);
    throw err;
  }

  const pcIntent = parsePcIntent(chat.message);
  if (!pcIntent && chat.provider === "codex" && !config.codex?.enabled) return sendError(res, 503, "Codex is not connected yet. Select Claude.");
  if (busy) return sendError(res, 429, "Jarvis is still answering. Try again in a moment.");
  busy = true;

  // Loaded on the server. parseChatRequest ignores client serverContext.
  try {
    chat.serverContext = buildDashboardContext((await readDashboard(dashboardDir(config))).tasks);
  } catch {
    chat.serverContext = '{"source":"Server-saved Jarvis dashboard tasks","status":"Current saved tasks are unavailable. Do not invent them."}';
  }
  // Reports from the PC worker, so "how did the job applying go?" has an answer.
  try {
    const pcTasks = (await readPcTasks(dashboardDir(config))).tasks;
    if (pcTasks.length) chat.serverContext += `\n${pcTaskContext(pcTasks)}`;
  } catch { /* no reports yet */ }

  // Stop Claude Code if the browser goes away mid-answer.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  const send = (event: ChatEvent) => res.write(`${JSON.stringify(event)}\n`);

  // Job hunting is an errand for my PC (pc-worker/), not a chat answer.
  const events = pcIntent
    ? handOffPcErrand(dashboardDir(config), chat.message, config.pcWorkerToken ? pcIntent : { type: "clarify", message: "The PC worker is not enabled on this server." }, chat.requestId)
    : getChatRouter(config).answer(chat, abort.signal);

  try {
    for await (const event of events) {
      send(event);
    }
  } catch (err) {
    console.error("chat failed before completion");
    send({ type: "error", message: "Jarvis hit an internal error." });
  } finally {
    busy = false;
    res.end();
  }
}
