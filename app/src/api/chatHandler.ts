// POST /api/chat: checks the request, asks Claude Code, and streams the
// answer back as newline-delimited JSON events (see brain/events.ts).
// Only one answer runs at a time, to keep the small server's memory safe.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { askClaude } from "../brain/claudeCode.ts";
import type { ChatEvent } from "../brain/events.ts";
import { ChatRequestError, checkRequestSource, parseChatRequest, readBody } from "./chatRequest.ts";

let busy = false;

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

  if (busy) return sendError(res, 429, "Jarvis is still answering. Try again in a moment.");
  busy = true;

  // Stop Claude Code if the browser goes away mid-answer.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  const send = (event: ChatEvent) => res.write(`${JSON.stringify(event)}\n`);

  try {
    for await (const event of askClaude(config.claude, chat.message, chat.sessionId, abort.signal)) {
      send(event);
    }
  } catch (err) {
    console.error("chat failed:", err);
    send({ type: "error", message: "Jarvis hit an internal error." });
  } finally {
    busy = false;
    res.end();
  }
}
