// Reads the usage limits of Claude and Codex so Jarvis can show them live.
//
// Claude: every `claude -p --output-format stream-json` run emits a
//   {"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.84,"resetsAt":...},"seven_day":{...}}}}
//   event, so every agent run updates the reading for free. When no task has run for a
//   while, a one-word request to the cheapest model refreshes it (see probeClaudeLimits).
// Codex: every session log (rollout-*.jsonl) holds `rate_limits` with a primary (5-hour)
//   and secondary (weekly) window. The newest log has the newest reading; nothing is spent.
//
// Neither source contains a credential, and nothing but the percentages, reset times,
// plan name and status leaves this file.

import { spawn } from "node:child_process";
import { mkdtemp, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentLimits, LimitWindow } from "../app/src/pcTasks/protocol.ts";
import { isStartupCrash } from "./steps.ts";

const FIVE_HOURS = 300;
const WEEK = 10080;

/** Fresh, unexpired windows only. Old readings must not strand an otherwise usable provider. */
export function quotaPressure(limits: AgentLimits | undefined, now = Date.now()): number | undefined {
  if (!limits || now - Date.parse(limits.updatedAt) > 35 * 60_000 || Date.parse(limits.updatedAt) > now + 5 * 60_000) return;
  const resets = [limits.fiveHour, limits.week].filter(w => w && Number.isFinite(w.usedPercent) && w.usedPercent >= 90 && w.resetsAt * 1000 > now).map(w => w!.resetsAt * 1000);
  return resets.length ? Math.max(...resets) : undefined;
}

const percent = (fraction: number): number => Math.round(fraction * 1000) / 10;

/** One parsed Claude stream event to a reading, or undefined for any other event. */
export function claudeLimitsFromEvent(event: unknown, now = new Date()): AgentLimits | undefined {
  const e = event as { type?: string; rate_limit_info?: Record<string, any> } | null;
  const info = e?.type === "rate_limit_event" ? e.rate_limit_info : undefined;
  if (!info || typeof info !== "object") return;
  const win = (w: any, minutes: number): LimitWindow | undefined =>
    w && Number.isFinite(w.utilization) && Number.isFinite(w.resetsAt) ? { usedPercent: percent(w.utilization), resetsAt: Math.floor(w.resetsAt), minutes } : undefined;
  const windows = (info.unifiedWindows ?? {}) as Record<string, any>;
  let fiveHour = win(windows.five_hour, FIVE_HOURS), week = win(windows.seven_day, WEEK);
  // Older shape: a single window named by rateLimitType.
  if (!fiveHour && info.rateLimitType === "five_hour") fiveHour = win(info, FIVE_HOURS);
  if (!week && info.rateLimitType === "seven_day") week = win(info, WEEK);
  if (!fiveHour && !week) return;
  return { ...(fiveHour ? { fiveHour } : {}), ...(week ? { week } : {}), ...(typeof info.status === "string" ? { status: info.status } : {}), updatedAt: now.toISOString() };
}

/** The newest reading in a Codex session log (text), or undefined. */
export function codexLimitsFromText(text: string): AgentLimits | undefined {
  let best: AgentLimits | undefined;
  for (const line of text.split("\n")) {
    if (!line.includes("rate_limits")) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const payload = e?.payload ?? e;
    const limits = payload?.rate_limits ?? payload?.info?.rate_limits;
    if (!limits || typeof limits !== "object") continue;
    let fiveHour: LimitWindow | undefined, week: LimitWindow | undefined;
    for (const w of [limits.primary, limits.secondary]) {
      if (!w || !Number.isFinite(w.used_percent) || !Number.isFinite(w.resets_at)) continue;
      const minutes = Number.isFinite(w.window_minutes) ? Number(w.window_minutes) : undefined;
      const window: LimitWindow = { usedPercent: Number(w.used_percent), resetsAt: Math.floor(w.resets_at), ...(minutes ? { minutes } : {}) };
      // Sort by window length; fall back to primary = 5-hour, secondary = weekly.
      const isWeek = minutes ? minutes >= 2880 : w === limits.secondary;
      if (isWeek) week ??= window; else fiveHour ??= window;
    }
    if (!fiveHour && !week) continue;
    const stamp = Date.parse(e?.timestamp);
    best = { ...(fiveHour ? { fiveHour } : {}), ...(week ? { week } : {}), ...(typeof limits.plan_type === "string" ? { plan: limits.plan_type } : {}),
      updatedAt: new Date(Number.isFinite(stamp) ? stamp : Date.now()).toISOString() };
  }
  return best;
}

/** The newest Codex reading across session-log folders (the worker's own and the desktop app's). */
export async function readCodexLimits(sessionDirs: string[]): Promise<AgentLimits | undefined> {
  let best: AgentLimits | undefined;
  for (const dir of sessionDirs) {
    let names: string[];
    try { names = (await readdir(dir, { recursive: true })).map(String).filter(n => n.endsWith(".jsonl")); } catch { continue; }
    // Log names carry their date, so the last names sort newest.
    for (const name of names.sort().slice(-4)) {
      try {
        const path = join(dir, name);
        const size = (await stat(path)).size;
        const handle = await open(path, "r");
        try {
          const length = Math.min(size, 400_000);
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, size - length);
          const found = codexLimitsFromText(buffer.toString("utf8"));
          if (found && (!best || found.updatedAt > best.updatedAt)) best = found;
        } finally { await handle.close(); }
      } catch { /* unreadable log: skip */ }
    }
  }
  return best;
}

/** Folders to look in for Codex session logs. */
export function codexSessionDirs(codexHome?: string): string[] {
  return [...(codexHome ? [join(codexHome, "sessions")] : []), join(homedir(), ".codex", "sessions")];
}

/** The newer of two readings. */
export function newerLimits(a?: AgentLimits, b?: AgentLimits): AgentLimits | undefined {
  return !a ? b : !b ? a : b.updatedAt >= a.updatedAt ? b : a;
}

/**
 * A one-word request to the cheapest Claude model, only to read its usage windows.
 * Costs a few tokens. Started with file handles (no pipes) and retried when Windows
 * crashes the new process at startup, like the real agents.
 */
export async function probeClaudeLimits(claudeBin: string, timeoutMs = 60_000): Promise<AgentLimits | undefined> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const dir = await mkdtemp(join(tmpdir(), "jarvis-limits-"));
    try {
      const inputPath = join(dir, "in.txt"), outputPath = join(dir, "out.jsonl");
      await writeFile(inputPath, "reply with the single word ok", { mode: 0o600 });
      const input = await open(inputPath, "r"), output = await open(outputPath, "w+", 0o600);
      let exitCode: number | null = null;
      try {
        const child = spawn(claudeBin, ["-p", "--output-format", "stream-json", "--verbose", "--model", "haiku", "--tools", "", "--disable-slash-commands"], {
          cwd: dir, windowsHide: true, stdio: [input.fd, output.fd, "ignore"],
          env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: undefined, PC_WORKER_TOKEN: undefined },
        });
        const timer = setTimeout(() => child.kill(), timeoutMs);
        exitCode = await new Promise<number | null>(resolve => { child.once("error", () => resolve(null)); child.once("close", code => resolve(code)); });
        clearTimeout(timer);
        const { bytesRead, buffer } = await output.read(Buffer.alloc(200_000), 0, 200_000, 0);
        let found: AgentLimits | undefined;
        for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
          if (!line.includes("rate_limit_event")) continue;
          try { found = claudeLimitsFromEvent(JSON.parse(line)) ?? found; } catch { /* partial line */ }
        }
        if (found) return found;
      } finally { await input.close(); await output.close(); }
      // Retry only a Windows startup crash; anything else will not improve on a second try.
      if (!(exitCode === null || isStartupCrash(exitCode, { touchedTools: false, hasResult: false, elapsedMs: 0 }))) return;
    } catch { /* try again */ } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
    await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
  }
  return;
}
