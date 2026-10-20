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
const syncs = new WeakMap<AppConfig, Promise<void>>();
function readerFor(config: AppConfig): TrackerReader {
  let reader = readers.get(config);
  if (!reader) { reader = new TrackerReader(config.jobTracker); readers.set(config, reader); }
  return reader;
}

export async function syncPendingReceipts(dir: string, writer: Pick<TrackerReader, "record">): Promise<void> {
  for (const row of (await readSubmissions(dir)).filter(r => r.sync !== "synced" && (r.retryAt ?? 0) <= Date.now()).slice(0, 10)) {
    try { await writer.record(row); await markSynced(dir, row.id); }
    catch (error) { await markSynced(dir, row.id, error instanceof Error ? error.message : "Google sync failed; retrying automatically."); }
  }
}
export function syncTracker(config: AppConfig): Promise<void> {
  const existing = syncs.get(config); if (existing) return existing;
  const reader = readerFor(config);
  if (!reader.enabled) return Promise.resolve();
  const pending = syncPendingReceipts(dashboardDir(config), reader).catch(() => { console.error("Tracker receipt synchronization failed; retained for retry."); }).finally(() => { syncs.delete(config); });
  syncs.set(config, pending);
  return pending;
}

export function sharedTrackerView(snapshot: TrackerSnapshot, offset = 0) {
  return { source: "Google job tracker; history prevents duplicates and is not progress for this request.", summary: snapshot.summary, updatedAt: snapshot.updatedAt,
    jobs: snapshot.jobs.slice(offset, offset + 100).map(({ company, role, stage, url }) => ({ company, role, stage, url })),
    nextOffset: offset + 100 < snapshot.jobs.length ? offset + 100 : null };
}
export async function sharedTrackerState(config: AppConfig, offset: number) {
  const reader = readerFor(config);
  if (!reader.enabled) throw Error("Google tracker is not configured.");
  const snapshot = await reader.snapshot();
  if (snapshot.stale) throw Error("Google tracker is unavailable; history is stale. Retry after the connection recovers.");
  return sharedTrackerView(snapshot, offset);
}

export function startTrackerUpdates(config: AppConfig): () => void {
  const reader = readerFor(config);
  if (!reader.enabled) return () => {};
  const check = trackerChangeCheck(() => reader.snapshot(), () => publishUpdate("jobs"));
  void check();
  void syncTracker(config);
  const timer = setInterval(() => { void check(); void syncTracker(config); }, 3_000);
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
    pendingApplications: pending.map(({ company, role, url, error }) => ({ company, role, url, error })),
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
