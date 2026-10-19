// Read-only view of my Google Sheets job tracker.
//
// The server signs in as a Google service account (a robot user) that I
// shared the sheet with as Viewer, so it can read that one sheet and nothing
// else. No new dependencies: the sign-in JWT is signed with node:crypto and
// the Sheets REST API is called with fetch. Results are cached briefly, and a
// slightly stale copy is served if Google is briefly unreachable.
//
// Columns (row 1 is the header): Date Applied, Company, Role, Pay, Location,
// Stage, Next Step / Needs You, Last Update, CV Used, Apply Via, Posting URL,
// Notes. CV Used and Notes are never sent to the browser.

import { createSign } from "node:crypto";

export interface TrackerConfig { sheetId: string; range: string; serviceAccountB64: string; }

export interface TrackerJob {
  company: string; role: string; stage: string; pay: string; location: string;
  applied: string; updated: string; nextStep: string; via: string; url: string;
}

export interface TrackerSummary {
  total: number;
  /** Submitted or further along. */
  submitted: number;
  /** Prepared, waiting for my approval. */
  ready: number;
  /** Needs a code, an answer, or me. */
  needsYou: number;
  /** Recruiter contact, interviews, offers. */
  responses: number;
  closed: number;
  /** Applications dated within the last 7 days / today (America/Chicago). */
  last7Days: number;
  today: number;
}

export interface TrackerSnapshot { summary: TrackerSummary; jobs: TrackerJob[]; updatedAt: string; stale?: boolean; }

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CACHE_MS = 60_000;
const STALE_MS = 10 * 60_000;
const MAX_JOBS = 60;

const HEADERS = ["Date Applied", "Company", "Role", "Pay", "Location", "Stage", "Next Step / Needs You",
  "Last Update", "CV Used", "Apply Via", "Posting URL", "Notes"];

export const MORE_ADVANCED = ["Recruiter contact", "Interview scheduled", "Interviewed", "Offer"];
export const NEEDS_YOU = ["Needs code", "Needs answer", "Needs You"];

const clean = (value: unknown, max = 300): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Maps the sheet's rows to jobs, finding columns by header name so reordering columns is safe. */
export function parseRows(values: unknown[][]): TrackerJob[] {
  const [head, ...rows] = values;
  if (!head) return [];
  const index = (name: string) => head.findIndex(h => clean(h).toLowerCase() === name.toLowerCase());
  const col = Object.fromEntries(HEADERS.map(h => [h, index(h)]));
  if (col["Company"]! < 0 || col["Stage"]! < 0) throw new Error("Tracker headers not found.");
  const cell = (row: unknown[], name: string, max?: number) => col[name]! >= 0 ? clean(row[col[name]!], max) : "";
  return rows
    .filter(row => cell(row, "Company"))
    .map(row => {
      const url = cell(row, "Posting URL", 500);
      return {
        company: cell(row, "Company", 120), role: cell(row, "Role", 160), stage: cell(row, "Stage", 40),
        pay: cell(row, "Pay", 80), location: cell(row, "Location", 120), applied: cell(row, "Date Applied", 20),
        updated: cell(row, "Last Update", 20), nextStep: cell(row, "Next Step / Needs You", 200),
        via: cell(row, "Apply Via", 60), url: /^https:\/\//i.test(url) ? url : "",
      };
    });
}

/** Today's date in America/Chicago as YYYY-MM-DD (the sheet's date format). */
export function chicagoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);
}

export function summarize(jobs: TrackerJob[], now = new Date()): TrackerSummary {
  const today = chicagoDate(now);
  const weekAgo = chicagoDate(new Date(now.getTime() - 6 * 86_400_000));
  const stageOf = (job: TrackerJob) => job.stage.toLowerCase();
  const isIn = (job: TrackerJob, list: string[]) => list.some(s => s.toLowerCase() === stageOf(job));
  return {
    total: jobs.length,
    submitted: jobs.filter(j => stageOf(j) === "submitted" || isIn(j, MORE_ADVANCED)).length,
    ready: jobs.filter(j => stageOf(j) === "ready for approval").length,
    needsYou: jobs.filter(j => isIn(j, NEEDS_YOU)).length,
    responses: jobs.filter(j => isIn(j, MORE_ADVANCED)).length,
    closed: jobs.filter(j => ["closed", "rejected"].includes(stageOf(j))).length,
    last7Days: jobs.filter(j => j.applied >= weekAgo && j.applied <= today).length,
    today: jobs.filter(j => j.applied === today).length,
  };
}

/** Newest first, by last update then applied date. */
export function sortJobs(jobs: TrackerJob[]): TrackerJob[] {
  return [...jobs].sort((a, b) => (b.updated || b.applied).localeCompare(a.updated || a.applied) || b.applied.localeCompare(a.applied));
}

// --- Google sign-in ---
interface ServiceAccount { client_email: string; private_key: string; }

export function readServiceAccount(b64: string): ServiceAccount {
  const key = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Partial<ServiceAccount>;
  if (!key.client_email || !key.private_key?.includes("PRIVATE KEY")) throw new Error("Invalid service account key.");
  return { client_email: key.client_email, private_key: key.private_key };
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function signJwt(account: ServiceAccount, nowSeconds: number): string {
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64url(JSON.stringify({
    iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600,
  }));
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
  return unsigned + "." + b64url(signature);
}

type Fetch = typeof fetch;

export class TrackerReader {
  private token?: { value: string; until: number };
  private cache?: { at: number; snapshot: TrackerSnapshot };
  private readonly config: TrackerConfig;
  private readonly doFetch: Fetch;
  private readonly now: () => number;

  constructor(config: TrackerConfig, doFetch: Fetch = fetch, now: () => number = Date.now) {
    this.config = config;
    this.doFetch = doFetch;
    this.now = now;
  }

  get enabled(): boolean { return Boolean(this.config.sheetId && this.config.serviceAccountB64); }
  get cachedSnapshot(): TrackerSnapshot | undefined { return this.cache && this.now()-this.cache.at<STALE_MS ? {...this.cache.snapshot,...(this.now()-this.cache.at>CACHE_MS?{stale:true}: {})} : undefined; }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    const assertion = signJwt(readServiceAccount(this.config.serviceAccountB64), Math.floor(this.now() / 1000));
    const res = await this.doFetch(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error("Google sign-in failed (HTTP " + res.status + ").");
    const body = await res.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Google sign-in returned no token.");
    this.token = { value: body.access_token, until: this.now() + (body.expires_in ?? 3600) * 1000 - 60_000 };
    return body.access_token;
  }

  private async fetchSnapshot(): Promise<TrackerSnapshot> {
    const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(this.config.sheetId) +
      "/values/" + encodeURIComponent(this.config.range) + "?majorDimension=ROWS";
    const res = await this.doFetch(url, { headers: { Authorization: "Bearer " + await this.accessToken() }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 403 || res.status === 404) throw new Error("The tracker isn't shared with the Jarvis service account.");
    if (!res.ok) throw new Error("Google Sheets returned HTTP " + res.status + ".");
    const body = await res.json() as { values?: unknown[][] };
    const jobs = parseRows(body.values ?? []);
    return { summary: summarize(jobs, new Date(this.now())), jobs: sortJobs(jobs).slice(0, MAX_JOBS), updatedAt: new Date(this.now()).toISOString() };
  }

  /** Cached for a minute; falls back to the last good copy for ten minutes if Google fails. */
  async snapshot(fresh = false): Promise<TrackerSnapshot> {
    if (!fresh && this.cache && this.now() - this.cache.at < CACHE_MS) return this.cache.snapshot;
    try {
      const snapshot = await this.fetchSnapshot();
      this.cache = { at: this.now(), snapshot };
      return snapshot;
    } catch (error) {
      if (this.cache && this.now() - this.cache.at < STALE_MS) return { ...this.cache.snapshot, stale: true };
      throw error;
    }
  }
}
