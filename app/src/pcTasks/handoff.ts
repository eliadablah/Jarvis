import { randomUUID } from "node:crypto";
import type { ChatEvent } from "../brain/events.ts";
import type { PcIntent } from "./intent.ts";
import { enqueuePcTask, pcSnapshot, cancelPcTask, workerOnline } from "./store.ts";
export async function* handOffPcErrand(dir: string, message: string, intent: PcIntent, requestId?: string): AsyncGenerator<ChatEvent> {
  let text: string;
  if (intent.type === "clarify") text = intent.message;
  else if (intent.type === "cancel") {
    const candidates = (await pcSnapshot(dir)).tasks.filter(t => ["queued", "running", "cancelling"].includes(t.status));
    if (candidates.length !== 1) text = candidates.length ? "There is more than one PC task. Use the cancel button beside the task you want to stop." : "There are no queued or running PC tasks to cancel.";
    else {
      const task = await cancelPcTask(dir, candidates[0]!.id);
      text = task?.status === "cancelled" ? "Cancelled before it started." : "Stop requested. I'll show confirmation from your PC. Actions already completed cannot be undone.";
    }
  } else {
    try {
      const state = await pcSnapshot(dir);
      const task = await enqueuePcTask(dir, message, requestId);
      const scope = intent.plan.kind === "jobs" ? ({ search: "Search only; no applications will be submitted.", prepare: "Prepare drafts only; no applications will be submitted.", submit: "Submit only the job applications you requested, with confirmation evidence.", track: "Update the job tracker only." })[intent.plan.action] : intent.plan.kind === "workspace" ? "Work only in the approved " + intent.plan.workspace + " workspace." : intent.plan.kind === "browser" ? "Read and navigate in Chrome; no sending, purchasing, or account changes." : "Open " + intent.plan.app + " on your PC.";
      text = "Queued on your PC. " + scope + (workerOnline(state) ? " The worker will choose a capable available agent." : " Your PC worker is offline; it will wait for your PC.") + " Follow progress in PC activity.";
      yield { type: "pc_task", taskId: task.id };
    } catch (e) { text = e instanceof Error ? e.message : "Could not queue the PC task."; }
  }
  yield { type: "text", text };
  yield { type: "done", sessionId: randomUUID() };
}
