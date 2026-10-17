// GET /api/jobs: my job tracker (Google Sheet) as JSON for the dashboard's
// Job search section. Read-only; errors are short messages with no
// credentials, sheet IDs, or Google response bodies.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { appHeaders } from "../http/securityHeaders.ts";
import { TrackerReader } from "./tracker.ts";

const readers = new WeakMap<AppConfig, TrackerReader>();

function readerFor(config: AppConfig): TrackerReader {
  let reader = readers.get(config);
  if (!reader) { reader = new TrackerReader(config.jobTracker); readers.set(config, reader); }
  return reader;
}

function json(res: ServerResponse, status: number, value: unknown, head: boolean): void {
  res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(head ? undefined : JSON.stringify(value));
}

export async function handleJobs(req: IncomingMessage, res: ServerResponse, config: AppConfig): Promise<void> {
  const method = req.method ?? "GET";
  const head = method === "HEAD";
  if (method !== "GET" && !head) { json(res, 405, { error: "Method not allowed" }, false); return; }
  const reader = readerFor(config);
  if (!reader.enabled) { json(res, 200, { enabled: false }, head); return; }
  try {
    json(res, 200, { enabled: true, sheetUrl: "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(config.jobTracker.sheetId) + "/edit", ...await reader.snapshot() }, head);
  } catch (error) {
    console.error("job tracker read failed:", error instanceof Error ? error.message : "unknown");
    json(res, 200, { enabled: true, error: error instanceof Error && /shared|sign-in/.test(error.message) ? error.message : "The tracker could not be read right now." }, head);
  }
}
