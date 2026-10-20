// Google is authoritative for the dashboard's counts and rows. Local receipts
// awaiting Google stay separate and never inflate those counts.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { appHeaders } from "../http/securityHeaders.ts";
import { TrackerReader, type TrackerSnapshot } from "./tracker.ts";
import { readSubmissions, markSynced, applicationKey, type Submission } from "./submissions.ts";
import { dashboardDir } from "../dashboard.ts";
import { publishUpdate } from "../live.ts";
import { trackerChangeCheck } from "./watch.ts";

const readers = new WeakMap<AppConfig, TrackerReader>();
function readerFor(config: AppConfig): TrackerReader {
  let reader = readers.get(config);
  if (!reader) { reader = new TrackerReader(config.jobTracker); readers.set(config, reader); }
  return reader;
}

export function startTrackerUpdates(config: AppConfig): () => void {
  const reader = readerFor(config);
  if (!reader.enabled) return () => {};
  const check = trackerChangeCheck(() => reader.snapshot(), () => publishUpdate("jobs"));
  void check();
  const timer = setInterval(() => { void check(); }, 3_000);
  timer.unref();
  return () => clearInterval(timer);
}

function json(res: ServerResponse, status: number, value: unknown, head: boolean): void {
  res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(head ? undefined : JSON.stringify(value));
}

export function trackerView(snapshot: TrackerSnapshot | undefined, pending: Submission[]) {
  return {
    ...(snapshot ? { ...snapshot, jobs: snapshot.jobs.slice(0, 60) } : { trackerUnavailable: true }),
    pendingGoogleSync: pending.length,
    pendingApplications: pending.map(({ company, role, url }) => ({ company, role, url })),
    syncMessage: pending.length ? "Applications recorded in Jarvis but not yet confirmed in Google. They are not included in the tracker counts." : "",
  };
}

export async function handleJobs(req: IncomingMessage, res: ServerResponse, config: AppConfig): Promise<void> {
  const method = req.method ?? "GET", head = method === "HEAD";
  if (method !== "GET" && !head) { json(res, 405, { error: "Method not allowed" }, false); return; }
  const reader = readerFor(config);
  if (!reader.enabled) { json(res, 200, { enabled: false }, head); return; }
  const sheetUrl = "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(config.jobTracker.sheetId) + "/edit";
  const journal = await readSubmissions(dashboardDir(config));
  const pending = journal.filter(row => row.sync !== "synced");
  try {
    const snapshot = await reader.snapshot();
    const missing: Submission[] = [];
    for (const row of pending) {
      const sheetRow = snapshot.jobs.find(j => j.url && applicationKey(j.url) === applicationKey(row.url) && ["submitted", "recruiter contact", "interview scheduled", "interviewed", "offer"].includes(j.stage.toLowerCase()));
      if (sheetRow && !snapshot.stale) await markSynced(dashboardDir(config), row.id);
      else missing.push(row);
    }
    json(res, 200, { enabled: true, sheetUrl, ...trackerView(snapshot, missing), ...(snapshot.stale ? { error: "Google is temporarily unavailable. Showing the last confirmed tracker counts; retrying automatically." } : {}) }, head);
  } catch (error) {
    console.error("job tracker read failed:", error instanceof Error ? error.message : "unknown");
    json(res, 200, { enabled: true, sheetUrl, ...trackerView(undefined, pending), error: "Google tracker is unavailable. Live counts cannot be verified; retrying automatically." }, head);
  }
}
