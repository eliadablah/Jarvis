// GET  /api/schedules          the schedules with next run and last result
// POST /api/schedules/morning  { enabled: boolean } pause or resume the morning run
// POSTs need the same-origin chat header, like the dashboard task API.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { ChatRequestError, checkRequestSource, readBody } from "../api/chatRequest.ts";
import { appHeaders } from "../http/securityHeaders.ts";
import { describeMorning, setMorningEnabled } from "./morning.ts";

function json(res: ServerResponse, status: number, value: unknown, head = false): void {
  res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(head ? undefined : JSON.stringify(value));
}

export async function handleSchedules(req: IncomingMessage, res: ServerResponse, path: string, config: AppConfig): Promise<void> {
  const method = req.method ?? "GET";
  try {
    if (path === "/api/schedules" && (method === "GET" || method === "HEAD")) {
      json(res, 200, { schedules: [await describeMorning(config)] }, method === "HEAD");
      return;
    }
    if (path === "/api/schedules/morning" && method === "POST") {
      checkRequestSource(req.headers);
      let body: { enabled?: unknown };
      try { body = JSON.parse(await readBody(req)); } catch (err) { if (err instanceof ChatRequestError) throw err; throw new ChatRequestError(400, "Invalid JSON."); }
      if (typeof body?.enabled !== "boolean") throw new ChatRequestError(400, "enabled must be true or false.");
      await setMorningEnabled(config, body.enabled);
      json(res, 200, { schedules: [await describeMorning(config)] });
      return;
    }
    json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error instanceof ChatRequestError) json(res, error.status, { error: error.message });
    else { console.error("schedule request failed"); json(res, 500, { error: "Could not save. Please try again." }); }
  }
}
