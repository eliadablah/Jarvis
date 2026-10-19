// Shared by the private server and Windows worker. No credentials here.
export const PC_PROTOCOL = 2;
export const MAX_REQUEST_CHARS = 2000;
export const CAPABILITIES = ["jobs", "browser", "browser.execute", "workspace", "computer", "desktop.launch"] as const;
export type Capability = typeof CAPABILITIES[number];
export type PcPlan =
  | { kind: "jobs"; action: "search" | "prepare" | "submit" | "track"; maxApplications: number }
  | { kind: "browser"; action: "browse" | "execute" }
  | { kind: "computer"; action: "execute" }
  | { kind: "workspace"; action: "execute"; workspace: string }
  | { kind: "desktop"; action: "open_app"; app: "calculator" | "notepad" | "explorer" };
export type Outcome = "completed" | "partial" | "needs_input" | "failed" | "cancelled";
export interface Evidence { action: string; target: string; detail: string }
export interface PcReport { outcome: Outcome; summary: string; evidence: Evidence[]; needsInput: string[]; submitted: number }
export interface ExecutorStatus {
  id: string; capabilities: Capability[]; state: "ready" | "cooldown" | "unavailable";
  features?: ("job-files-v1")[];
  reason: string; retryAt?: string; remainingTokens: null;
}
export function capabilityFor(plan: PcPlan): Capability { return plan.kind === "desktop" ? "desktop.launch" : plan.kind === "browser" && plan.action === "execute" ? "browser.execute" : plan.kind; }
export const REPORT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["outcome", "summary", "evidence", "needsInput", "submitted"],
  properties: {
    outcome: { type: "string", enum: ["completed", "partial", "needs_input", "failed"] },
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["action", "target", "detail"], properties: {
        action: { type: "string" }, target: { type: "string" }, detail: { type: "string" },
      } } },
    needsInput: { type: "array", items: { type: "string" } },
    submitted: { type: "integer", minimum: 0, maximum: 25 },
  },
} as const;
export function emptyReport(outcome: Outcome, summary: string): PcReport {
  return { outcome, summary, evidence: [], needsInput: [], submitted: 0 };
}
/** A successful process exit alone proves no action. */
export function validateReport(value: unknown, plan: PcPlan): PcReport {
  if (!value || typeof value !== "object") throw new Error("Missing structured result.");
  const r = value as Record<string, unknown>;
  if (JSON.stringify(value).length > 24000) throw new Error("Task report is too large.");
  if (!["completed", "partial", "needs_input", "failed", "cancelled"].includes(String(r.outcome)) ||
      typeof r.summary !== "string" || !r.summary.trim() || r.summary.length > 4000 ||
      !Number.isInteger(r.submitted) || Number(r.submitted) < 0 || Number(r.submitted) > 25 ||
      !Array.isArray(r.evidence) || r.evidence.length > 30 || !Array.isArray(r.needsInput) || r.needsInput.length > 25 ||
      !r.needsInput.every(v => typeof v === "string" && v.length <= 500) ||
      !r.evidence.every(v => v && typeof v === "object" && ["action", "target", "detail"].every(k =>
        typeof v[k] === "string" && v[k].trim() && v[k].length <= 1000))) throw new Error("Invalid structured result.");
  const report: PcReport = { outcome: r.outcome as Outcome, summary: r.summary,
    evidence: r.evidence as Evidence[], needsInput: r.needsInput as string[], submitted: r.submitted as number };
  const allowed = plan.kind === "jobs" && plan.action === "submit" ? plan.maxApplications : 0;
  if (report.submitted > allowed) throw new Error("Reported submissions exceed this task's authorization.");
  if (report.evidence.filter(e => e.action === "submitted").length !== report.submitted)
    throw new Error("Submission count must match confirmation evidence.");
  const submissions = report.evidence.filter(e => e.action === "submitted");
  if (new Set(submissions.map(e => e.target)).size !== submissions.length || submissions.some(e => !/^https:\/\//i.test(e.target))) throw new Error("Every submission needs a distinct application URL.");
  if (report.outcome === "completed" && !report.evidence.length) {
    report.outcome = "needs_input";
    report.needsInput.push("The agent did not provide evidence that the requested action happened.");
  }
  if (plan.kind === "jobs" && plan.action === "submit" && report.outcome === "completed" && !report.submitted) {
    report.outcome = "needs_input"; report.needsInput.push("No applications were confirmed submitted.");
  }
  if (report.outcome === "completed" && report.needsInput.length) report.outcome = report.evidence.length ? "partial" : "needs_input";
  if (plan.kind === "jobs" && plan.action === "submit" && report.outcome === "completed" && report.submitted < plan.maxApplications) report.outcome = "partial";
  return report;
}

// --- Agent usage limits (shown live on the dashboard) ---
// Claude reports its 5-hour and weekly usage in every stream; Codex writes the same two
// windows to its session logs. The PC worker reads them and sends them to the server.
export interface LimitWindow { usedPercent: number; /** Unix seconds. */ resetsAt: number; minutes?: number }
export interface AgentLimits { fiveHour?: LimitWindow; week?: LimitWindow; plan?: string; status?: string; updatedAt: string }
export interface PcLimits { claude?: AgentLimits; codex?: AgentLimits }

function cleanWindow(value: unknown): LimitWindow | undefined {
  const w = value as Partial<LimitWindow> | null;
  if (!w || typeof w !== "object" || typeof w.usedPercent !== "number" || typeof w.resetsAt !== "number") return;
  if (!Number.isFinite(w.usedPercent) || !Number.isFinite(w.resetsAt) || w.usedPercent < 0 || w.usedPercent > 100) return;
  if (w.resetsAt < 1e9 || w.resetsAt > 4e9) return;
  const minutes = typeof w.minutes === "number" && Number.isFinite(w.minutes) && w.minutes > 0 && w.minutes <= 20000 ? Math.round(w.minutes) : undefined;
  return { usedPercent: Math.round(w.usedPercent * 10) / 10, resetsAt: Math.floor(w.resetsAt), ...(minutes ? { minutes } : {}) };
}

/** Keeps only well-formed limit numbers and short labels. Anything else is dropped, never trusted. */
export function sanitizeLimits(value: unknown, now = new Date()): PcLimits {
  const out: PcLimits = {};
  if (!value || typeof value !== "object") return out;
  for (const provider of ["claude", "codex"] as const) {
    const raw = (value as Record<string, unknown>)[provider] as Partial<AgentLimits> | undefined;
    if (!raw || typeof raw !== "object") continue;
    const fiveHour = cleanWindow(raw.fiveHour), week = cleanWindow(raw.week);
    if (!fiveHour && !week) continue;
    const stamp = typeof raw.updatedAt === "string" ? Date.parse(raw.updatedAt) : NaN;
    const updatedAt = Number.isFinite(stamp) && stamp <= now.getTime() + 5 * 60_000 ? new Date(stamp).toISOString() : now.toISOString();
    const plan = typeof raw.plan === "string" && /^[a-z0-9_-]{1,20}$/i.test(raw.plan) ? raw.plan : undefined;
    const status = typeof raw.status === "string" && /^[a-z0-9_-]{1,30}$/i.test(raw.status) ? raw.status : undefined;
    out[provider] = { ...(fiveHour ? { fiveHour } : {}), ...(week ? { week } : {}), ...(plan ? { plan } : {}), ...(status ? { status } : {}), updatedAt };
  }
  return out;
}
