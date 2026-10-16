// Windows PC execution loop. Protocol 2 prevents old, unscoped workers from claiming new tasks.
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PC_PROTOCOL, emptyReport, type PcReport } from "../app/src/pcTasks/protocol.ts";
import { parsePcIntent } from "../app/src/pcTasks/intent.ts";
import { agentStatuses, chooseAgents, canFallback, runAgent, type ClaimedTask, type WorkerSettings } from "./agents.ts";
import { readState, saveState, acquireWorkerLock, type LocalState } from "./persistence.ts";
export { jobPrompt } from "./agents.ts";
const STATE_DIR = join(homedir(), ".jarvis");
const POLL_MS = 15_000;
const HEARTBEAT_MS = 15_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function log(message: string): void {
  const line = new Date().toISOString() + " " + message;
  console.log(line); void appendFile(join(STATE_DIR, "pc-worker.log"), line + "\n").catch(() => {});
}
export async function loadSettings(): Promise<WorkerSettings> {
  const path = join(STATE_DIR, "pc-worker.json");
  const settings = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")) as WorkerSettings;
  const url = new URL(settings.server);
  if (url.protocol !== "https:" || url.username || url.password || !settings.token || !settings.jobsDir) throw new Error("Invalid PC worker settings.");
  settings.maxApplications = Math.min(25, Math.max(1, Number.isFinite(settings.maxApplications) ? settings.maxApplications! : 10));
  return settings;
}
async function call(settings: WorkerSettings, path: string, body: unknown): Promise<Response> {
  return fetch(new URL(path, settings.server), {
    method: "POST", redirect: "error",
    headers: { Authorization: "Bearer " + settings.token, "Content-Type": "application/json" },
    body: JSON.stringify({ protocol: PC_PROTOCOL, ...body as object }), signal: AbortSignal.timeout(20_000),
  });
}
export function validateClaim(value: unknown, workerId: string): ClaimedTask {
  const task = value as ClaimedTask;
  if (!task || typeof task.id !== "string" || !/^[a-f0-9-]{36}$/i.test(task.id) ||
      typeof task.lease !== "string" || !/^[a-f0-9-]{36}$/i.test(task.lease) ||
      task.workerId !== workerId || typeof task.request !== "string" || task.request.length > 2000)
    throw new Error("Invalid task claim.");
  const intent = parsePcIntent(task.request);
  if (intent?.type !== "task" || JSON.stringify(intent.plan) !== JSON.stringify(task.plan)) throw new Error("Task scope does not match its request.");
  return task;
}
export async function deliverReport(settings: WorkerSettings, state: LocalState): Promise<void> {
  const item = state.outbox; if (!item) return;
  const response = await call(settings, "/api/pc/tasks/" + item.task.id + "/result", {
    workerId: state.workerId, lease: item.task.lease, reportId: item.reportId, report: item.report,
  });
  if (!response.ok) throw new Error("Report retained locally; server returned HTTP " + response.status + ".");
}
async function execute(settings: WorkerSettings, state: LocalState, task: ClaimedTask): Promise<PcReport> {
  const controller = new AbortController();
  let progress = "Choosing a capable agent.", executor: string | undefined, lastContact = Date.now(), finished = false;
  const heartbeat = async () => {
    try {
      const response = await call(settings, "/api/pc/tasks/" + task.id + "/heartbeat",
        { workerId: state.workerId, lease: task.lease, progress, executor });
      if (response.status === 409 || response.status === 401) { controller.abort("ownership_lost"); return; }
      if (!response.ok) throw new Error();
      lastContact = Date.now();
      if ((await response.json() as {cancelRequested?: boolean}).cancelRequested) controller.abort("cancel_requested");
    } catch { if (Date.now() - lastContact > 60_000) controller.abort("connection_lost"); }
  };
  await heartbeat();
  const pump = (async () => { while (!finished && !controller.signal.aborted) { await sleep(HEARTBEAT_MS); if (!finished) await heartbeat(); } })();
  try {
    let result = emptyReport("needs_input", "No available agent has this task's tools.");
    for (const id of chooseAgents(task.plan, agentStatuses(settings, state.cooldowns))) {
      if (controller.signal.aborted) break;
      executor = id; progress = "Starting " + id + "."; await heartbeat();
      const run = await runAgent(id, settings, task, controller.signal, text => { progress = text; });
      result = run.report;
      if (run.failure) {
        const wait = { until: Date.now() + (run.failure === "quota" ? 15 * 60_000 : 60_000), reason: run.report.summary };
        state.cooldowns[id] = wait;
        if (id.startsWith("claude-")) { state.cooldowns["claude-files"] = wait; state.cooldowns["claude-chrome"] = wait; }
        await saveState(STATE_DIR, state);
      }
      if (!canFallback(run)) break;
      progress = id + " unavailable before using tools; trying another capable agent.";
    }
    if (controller.signal.aborted) return emptyReport(controller.signal.reason === "cancel_requested" ? "cancelled" : "needs_input",
      controller.signal.reason === "cancel_requested" ? "PC confirmed the agent stopped. Already completed actions may remain; review before retrying." :
      "Stopped after losing the server connection or task ownership. Some actions may already have happened; review before retrying.");
    return result;
  } finally { finished = true; await pump; }
}
async function main(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  const settings = await loadSettings();
  const lock = await acquireWorkerLock(settings.lockPort ?? 47831);
  // Retain the lock for the entire process lifetime, including error/recovery holds.
  lock.on("error", error => log("lock error: " + error.message));
  const state = await readState(STATE_DIR);
  if (state.active && !state.outbox) {
    state.outbox = { task: state.active, reportId: randomUUID(),
      report: emptyReport("needs_input", "PC worker restarted during execution. Check the application or files before retrying; no task was automatically repeated.") };
    state.recoveryHold = true;
  }
  await saveState(STATE_DIR, state);
  log("protocol 2 started; local agents and durable reports enabled.");
  for (;;) {
    try {
      if (state.outbox) {
        await deliverReport(settings, state);
        log("report acknowledged: " + state.outbox.task.id + " " + state.outbox.report.outcome);
        delete state.outbox; delete state.active; await saveState(STATE_DIR, state);
      }
      const executors = agentStatuses(settings, state.cooldowns).map(e => state.recoveryHold ?
        { ...e, state: "unavailable" as const, reason: "Interrupted run needs local review. Worker is paused to prevent duplicate actions." } : e);
      const response = await call(settings, "/api/pc/tasks/claim", { workerId: state.workerId, executors });
      if (response.status === 204) { await sleep(POLL_MS); continue; }
      if (!response.ok) throw new Error("Claim failed: HTTP " + response.status);
      const task = validateClaim((await response.json() as {task: unknown}).task, state.workerId);
      state.active = task; await saveState(STATE_DIR, state); // Durable BEFORE starting any action.
      log("claimed: " + task.id + " " + task.plan.kind);
      let report: PcReport;
      try { report = await execute(settings, state, task); }
      catch (e) {
        report = emptyReport("needs_input", "Worker could not complete or verify execution. Review local activity before retrying.");
        state.recoveryHold = true;
        log("execution paused: " + (e instanceof Error ? e.message : "unknown failure"));
      }
      state.outbox = { task, reportId: randomUUID(), report };
      await saveState(STATE_DIR, state); // Durable BEFORE the network: retry delivery, never execution.
    } catch (e) {
      log(e instanceof Error ? e.message : "Worker error.");
      await sleep(POLL_MS);
    }
  }
}
if (import.meta.main) await main().catch(e => {
  log("stopped: " + (e instanceof Error ? e.message : String(e))); process.exitCode = 1;
  // No child task was launched on startup failure. Close only this worker process.
  process.exit(1);
});
