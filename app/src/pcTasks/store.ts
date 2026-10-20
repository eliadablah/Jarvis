import {readSubmissions} from "../jobs/submissions.ts";
import {approvalWireAnswer} from "./approvalInput.ts";
import {rememberedToolConsent,type ToolTrust} from "./toolTrust.ts";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parsePcIntent } from "./intent.ts";
import { MAX_REQUEST_CHARS, capabilityFor, validateReport, type PcPlan, type PcReport, type ExecutorStatus, type PcLimits, type ToolProfile, type PcApproval } from "./protocol.ts";
export { MAX_REQUEST_CHARS } from "./protocol.ts";
export type PcTaskStatus = "queued" | "running" | "cancelling" | "completed" | "partial" | "needs_input" | "needs_attention" | "failed" | "cancelled" | "done";
export interface PcTask {
  id: string; kind: PcPlan["kind"]; request: string; displayRequest?: string; plan?: PcPlan; status: PcTaskStatus;
  createdAt: string; startedAt?: string; finishedAt?: string; result?: string;
  workerId?: string; lease?: string; heartbeatAt?: string; executor?: string; progress?: string;
  /** The last few distinct live steps the PC reported, newest last (for the dashboard's live view). */
  activity?: { at: string; text: string }[];
  cancelRequested?: boolean; report?: PcReport; reportId?: string; requestId?: string;
  retryOf?: string; retryTaskId?: string;
  requiredFeature?: "job-files-v1" | "task-sync-v1" | "personal-tools-v1" | "full-tools-v2";
  toolProfile?: ToolProfile;
  approvals?: PcApproval[];
  applicationScope?: {rootTaskId:string;requested:number;confirmedUrls:string[];startedAt:string};
}
export const MAX_ACTIVITY = 12;
export interface PcTaskState { tasks: PcTask[]; workerSeenAt?: string; workerId?: string; executors?: ExecutorStatus[]; limits?: PcLimits; toolTrust?:ToolTrust; }
export const LEASE_MS = 120_000;
const pending = new Map<string, Promise<unknown>>();
const active = (t: PcTask) => ["queued", "running", "cancelling"].includes(t.status);
export async function readPcTasks(dir: string): Promise<PcTaskState> {
  try {
    const state = JSON.parse(await readFile(join(dir, "pc-tasks.json"), "utf8"));
    if (!Array.isArray(state.tasks)) throw new Error("Invalid PC task state");
    return state;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { tasks: [] }; throw e; }
}
function expire(state: PcTaskState, now: Date): void {
  for (const task of state.tasks) {
    const last = task.heartbeatAt ?? task.startedAt;
    const limit = task.lease ? LEASE_MS : 3 * 60 * 60_000;
    if (["running", "cancelling"].includes(task.status) && last && now.getTime() - Date.parse(last) > limit) {
      task.status = "needs_attention";
      task.progress = "PC stopped reporting. Check the result before retrying; this task will not run twice automatically.";
    }
  }
}
async function mutate<T>(dir: string, change: (state: PcTaskState) => T | Promise<T>, now = new Date()): Promise<T> {
  const run = async () => {
    const state = await readPcTasks(dir); expire(state, now);
    const value = await change(state);
    const recent = new Set(state.tasks.filter(t => !active(t)).slice(-100).map(t => t.id));
    state.tasks = state.tasks.filter(t => active(t) || recent.has(t.id));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, "pc-tasks-" + randomUUID() + ".tmp");
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
    await rename(temp, join(dir, "pc-tasks.json"));
    return value;
  };
  const result = (pending.get(dir) ?? Promise.resolve()).catch(() => {}).then(run);
  pending.set(dir, result);
  try { return await result; } finally { if (pending.get(dir) === result) pending.delete(dir); }
}
export function pcSnapshot(dir: string, now = new Date()): Promise<PcTaskState> { return mutate(dir, s => s, now); }
export function enqueuePcTask(dir: string, request: string, requestId?: string, now = new Date(), displayRequest?: string, toolProfile: ToolProfile = "personal"): Promise<PcTask> {
  if (request.length > MAX_REQUEST_CHARS) throw new Error("PC request exceeds 2000 characters; shorten it without removing limits.");
  const intent = parsePcIntent(request);
  if (intent?.type !== "task") throw new Error("Name an explicit PC action.");
  return mutate(dir, state => {
    const existing = requestId && state.tasks.find(t => t.requestId === requestId);
    if (existing) { if (existing.request !== request) throw new Error("Request ID already used."); return existing; }
    if (state.tasks.filter(active).length >= 100) throw new Error("PC queue is full.");
    const task: PcTask = { id: randomUUID(), kind: intent.plan.kind, plan: intent.plan, request,
      toolProfile,
      ...(intent.plan.kind === "jobs" && intent.plan.action === "submit" ? {requiredFeature:"task-sync-v1" as const} : {}),
      ...(toolProfile === "personal" && intent.plan.kind !== "desktop" ? {requiredFeature:"full-tools-v2" as const} : {}),
      status: "queued", createdAt: now.toISOString(), ...(displayRequest ? { displayRequest: displayRequest.slice(0, MAX_REQUEST_CHARS) } : {}), ...(requestId ? { requestId } : {}) };
    state.tasks.push(task); return task;
  }, now);
}
/** A new explicit user retry is a separate run, idempotent for the original task. */
export function retryPcTask(dir: string, id: string, now = new Date()): Promise<PcTask | undefined> {
  return mutate(dir, async state => {
    const source = state.tasks.find(t => t.id === id);
    if (!source) return;
    const existing = state.tasks.find(t => t.retryOf === id);
    if (existing) return existing;
    if (!source.plan || !["needs_input", "failed", "partial", "cancelled"].includes(source.status)) throw new Error("This task cannot be retried yet. Review any uncertain result first.");
    if (state.tasks.filter(active).length >= 100) throw new Error("PC queue is full.");
    let request = source.request;
    if (source.plan.kind === "jobs" && source.plan.action === "submit") {
      const journal=await readSubmissions(dir);
      const confirmed=new Set([...(source.report?.evidence.filter(e=>e.action==="submitted").map(e=>e.target)??[]),...journal.filter(r=>r.taskId===source.id).map(r=>r.url)]);
      const remaining = source.plan.maxApplications - confirmed.size;
      if (remaining <= 0) throw new Error("All requested applications were already submitted.");
      request = "Apply to " + remaining + " job applications. Original task constraints: " + source.request;
    }
    request += "\nUser requested a retry. First check current files, application history and confirmation pages. Skip completed actions and duplicate applications; finish only remaining authorized work.";
    if (request.length > MAX_REQUEST_CHARS) throw new Error("Retry request is too long. Send a shorter command preserving its original limits.");
    const intent = parsePcIntent(request);
    if (intent?.type !== "task") throw new Error("Retry needs an explicit scoped task.");
    const task: PcTask = {id:randomUUID(),kind:intent.plan.kind,plan:intent.plan,request,status:"queued",createdAt:now.toISOString(),retryOf:id,
      toolProfile: source.toolProfile ?? "scoped",
      displayRequest:"Try again: " + (source.displayRequest ?? source.request).slice(0,1800), ...(intent.plan.kind === "jobs" ? { requiredFeature: "task-sync-v1" as const } : {})};
    if(task.toolProfile === "personal" && task.plan?.kind !== "desktop") task.requiredFeature = "full-tools-v2";
    source.retryTaskId = task.id;
    state.tasks.push(task); return task;
  },now);
}
export function claimNextPcTask(dir: string, workerId: string, executors: ExecutorStatus[], now = new Date()): Promise<PcTask | undefined> {
  return mutate(dir, async state => {
    state.workerSeenAt = now.toISOString(); state.workerId = workerId; state.executors = executors;
    if (state.tasks.some(t => ["running", "cancelling"].includes(t.status))) return;
    const task = state.tasks.find(t => t.status === "queued"); if (!task) return;
    if (!task.plan) { task.status = "needs_input"; task.result = "Older task needs an explicit search, prepare, or submit request."; return; }
    if(task.toolProfile==="personal" && task.requiredFeature==="personal-tools-v1")task.requiredFeature="full-tools-v2";
    const candidates = executors.filter(e => e.capabilities.includes(capabilityFor(task.plan!)) && (!task.requiredFeature || e.features?.includes(task.requiredFeature)));
    if (task.requiredFeature && !candidates.length) { task.progress = task.requiredFeature === "personal-tools-v1" || task.requiredFeature === "full-tools-v2" ? "Waiting for the updated worker to connect your Claude Code and Codex tools. Restart the idle PC worker to activate them." : "Waiting for the updated worker with task-scoped submission receipts. Restart the idle PC worker to activate the fix."; return; }
    if (!candidates.some(e => e.state === "ready")) {
      task.progress = candidates.some(e => e.state === "cooldown") ? "Waiting for a capable agent's usage limit to reset." : "No ready agent has the required tools. Check PC agents.";
      if (!candidates.length && ["computer", "browser.execute"].includes(capabilityFor(task.plan))) { task.progress = "Waiting for the updated PC worker to connect its action tools. Restart the idle worker to activate them."; }
      else if (!candidates.some(e => e.state === "cooldown")) { task.status = "needs_input"; task.result = task.progress; }
      return;
    }
    task.status = "running"; task.startedAt = now.toISOString(); task.heartbeatAt = now.toISOString();
    if(task.plan.kind==="jobs" && task.plan.action==="submit") {
      let root=task;const seen=new Set<string>();
      while(root.retryOf && !seen.has(root.id)){seen.add(root.id);const parent=state.tasks.find(t=>t.id===root.retryOf);if(!parent)break;root=parent;}
      const family=new Set([root.id]);let changed=true;
      while(changed){changed=false;for(const t of state.tasks)if(t.retryOf&&family.has(t.retryOf)&&!family.has(t.id)){family.add(t.id);changed=true;}}
      const journal=await readSubmissions(dir);
      const confirmedUrls=[...new Set([...state.tasks.filter(t=>family.has(t.id)).flatMap(t=>t.report?.evidence.filter(e=>e.action==="submitted").map(e=>e.target)??[]),...journal.filter(r=>family.has(r.taskId)).map(r=>r.url)])];
      task.applicationScope={rootTaskId:root.id,requested:root.plan?.kind==="jobs"?root.plan.maxApplications:task.plan.maxApplications,confirmedUrls,startedAt:root.createdAt};
    }
    task.workerId = workerId; task.lease = randomUUID(); task.progress = "Claimed by PC; choosing an agent.";
    return task;
  }, now);
}
export function heartbeatPcTask(dir: string, id: string, workerId: string, lease: string, progress: string, executor?: string, now = new Date()) {
  return mutate(dir, state => {
    const task = state.tasks.find(t => t.id === id && t.workerId === workerId && t.lease === lease);
    if (!task || !["running", "cancelling"].includes(task.status)) return;
    state.workerSeenAt = now.toISOString(); task.heartbeatAt = now.toISOString();
    task.progress = progress.slice(0, 300); if (executor) task.executor = executor.slice(0, 60);
    // Keep each new step once (a repeated heartbeat with the same text adds nothing).
    const feed = task.activity ??= [];
    if (feed.at(-1)?.text !== task.progress) feed.push({ at: now.toISOString(), text: task.progress });
    if (feed.length > MAX_ACTIVITY) feed.splice(0, feed.length - MAX_ACTIVITY);
    return { cancelRequested: task.cancelRequested === true };
  }, now);
}
export function finishPcTask(dir: string, id: string, workerId: string, lease: string, reportId: string, value: unknown, now = new Date()) {
  return mutate(dir, async state => {
    const task = state.tasks.find(t => t.id === id && t.workerId === workerId && t.lease === lease);
    if (!task?.plan) return;
    if (task.reportId === reportId) return task;
    if (task.reportId || !["running", "cancelling", "needs_attention"].includes(task.status)) return;
    let report = validateReport(value, task.plan);
    const receipts=(await readSubmissions(dir)).filter(r=>r.taskId===task.id);
    if(task.plan.kind==="jobs" && task.plan.action==="submit" && receipts.length>report.submitted){
      report={...report,submitted:receipts.length,evidence:[...report.evidence.filter(e=>e.action!=="submitted").slice(0,30-receipts.length),...receipts.map(r=>({action:"submitted",target:r.url,detail:(r.company+" / "+r.role+": "+r.confirmation).slice(0,1000)}))],summary:receipts.length+" new applications confirmed for this attempt. Google sync status is shown separately on the job tracker.",outcome:receipts.length>=task.plan.maxApplications?"completed":"partial",needsInput:report.needsInput.filter(s=>!/^No (?:new submissions|applications were confirmed)/i.test(s))};
      report=validateReport(report,task.plan);
    }
    task.report = report; task.reportId = reportId; task.status = report.outcome;
    task.result = report.summary; task.finishedAt = now.toISOString();
    task.progress = task.cancelRequested && report.outcome !== "cancelled" ? "Finished before cancellation took effect; review the report." : report.summary.slice(0, 300);
    state.workerSeenAt = now.toISOString(); return task;
  }, now);
}
export function cancelPcTask(dir: string, id: string, now = new Date()) {
  return mutate(dir, state => {
    const task = state.tasks.find(t => t.id === id); if (!task) return;
    if (task.status === "queued") { task.status = "cancelled"; task.finishedAt = now.toISOString(); task.result = "Cancelled before execution."; }
    else if (["running", "cancelling"].includes(task.status)) { task.cancelRequested = true; task.status = "cancelling"; task.progress = "Stop requested. Waiting for the PC to confirm; completed actions cannot be undone."; }
    return task;
  }, now);
}
/** Saves the newest usage-limit readings the PC reported (per provider, the later reading wins). */
export function setPcLimits(dir: string, limits: PcLimits, now = new Date()) {
  return mutate(dir, state => {
    const merged: PcLimits = { ...(state.limits ?? {}) };
    for (const provider of ["claude", "codex"] as const) {
      const next = limits[provider];
      if (next && (!merged[provider] || Date.parse(next.updatedAt) >= Date.parse(merged[provider]!.updatedAt))) merged[provider] = next;
    }
    state.limits = merged;
  }, now);
}
export function workerOnline(state: PcTaskState, now = Date.now()): boolean {
  return Boolean(state.workerSeenAt && now - Date.parse(state.workerSeenAt) < LEASE_MS);
}
export function setToolTrust(dir:string,mode:unknown,now=new Date()){
 if(mode!=="ask"&&mode!=="trusted")throw Error("Invalid tool permission preference.");
 return mutate(dir,state=>{state.toolTrust={mode,updatedAt:now.toISOString()};return state.toolTrust;},now);
}
function useToolTrust(state:PcTaskState,task:PcTask,row:PcApproval,now:Date){
 if(state.toolTrust?.mode==="trusted"&&task.toolProfile==="personal"&&!row.decision&&Date.parse(row.expiresAt)>now.getTime()&&rememberedToolConsent(row)){
  row.decision="allow";row.decidedAt=now.toISOString();row.decisionSource="saved-tool-consent";
 }
}
export function requestPcApproval(dir:string,id:string,workerId:string,lease:string,request:unknown,now=new Date()) {
 return mutate(dir,state=>{
  const task=state.tasks.find(t=>t.id===id&&t.workerId===workerId&&t.lease===lease&&t.status==="running"&&!t.cancelRequested&&t.toolProfile==="personal");if(!task)return;
  const value=request as Partial<PcApproval>;
  if(!value||typeof value.id!=="string"||!/^[a-f0-9-]{36}$/i.test(value.id)||!["claude","codex"].includes(value.provider??"")||typeof value.tool!=="string"||!value.tool||value.tool.length>200||typeof value.details!=="string"||!value.details||value.details.length>12000||typeof value.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(value.fingerprint))throw Error("Invalid approval request.");
  const rows=task.approvals??=[];const existing=rows.find(r=>r.id===value.id);
  if(existing){if(existing.fingerprint!==value.fingerprint||existing.tool!==value.tool||existing.details!==value.details||existing.provider!==value.provider)throw Error("Approval request changed.");return existing;}
  if(state.toolTrust?.mode==="trusted")while(rows.length>=100){const old=rows.findIndex(r=>r.decisionSource==="saved-tool-consent"&&r.collectedAt);if(old<0)break;rows.splice(old,1);}
  if(rows.length>=100||rows.filter(r=>!r.decision&&Date.parse(r.expiresAt)>now.getTime()).length>=10)throw Error("Too many approval requests.");
  const row:PcApproval={id:value.id,provider:value.provider as PcApproval["provider"],tool:value.tool,details:value.details,fingerprint:value.fingerprint,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+15*60000).toISOString()};useToolTrust(state,task,row,now);rows.push(row);return row;
 },now);
}
export function readPcApproval(dir:string,id:string,workerId:string,lease:string,approvalId:string,now=new Date()) {
 return mutate(dir,state=>{const task=state.tasks.find(t=>t.id===id&&t.workerId===workerId&&t.lease===lease&&t.status==="running"&&!t.cancelRequested);const row=task?.approvals?.find(r=>r.id===approvalId);if(task&&row){useToolTrust(state,task,row,now);if(row.decision)row.collectedAt??=now.toISOString();}return row?{...row,answer:approvalWireAnswer(row),...(Date.parse(row.expiresAt)<=now.getTime()?{decision:"deny" as const}: {})}:undefined;},now);
}
export function decidePcApproval(dir:string,id:string,approvalId:string,decision:unknown,answer:unknown,now=new Date()) {
 return mutate(dir,state=>{
  if(!["allow","deny"].includes(String(decision))||answer!==undefined&&(typeof answer!=="string"||answer.length>4000))throw Error("Invalid approval answer.");
  const task=state.tasks.find(t=>t.id===id&&t.status==="running"&&!t.cancelRequested);const row=task?.approvals?.find(r=>r.id===approvalId);if(!row)return;
  if(Date.parse(row.expiresAt)<=now.getTime())throw Error("Approval expired. The task must request it again.");
  if(row.decision&&(row.decision!==decision||row.answer!==answer))throw Error("Approval was already answered.");
  row.decision=decision as "allow"|"deny";if(typeof answer==="string")row.answer=answer;row.decidedAt??=now.toISOString();return row;
 },now);
}
/** Do not expose the bearer-equivalent claim lease to browsers or chat models. */
export function publicTask(task: PcTask): Omit<PcTask, "lease" | "workerId" | "reportId" | "requestId" | "displayRequest"> {
  const { lease, workerId, reportId, requestId, displayRequest, ...view } = task; return { ...view, request: displayRequest ?? view.request };
}
