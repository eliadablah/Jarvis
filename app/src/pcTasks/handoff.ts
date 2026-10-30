import { randomUUID } from "node:crypto";
import type { ChatEvent } from "../brain/events.ts";
import type { PcIntent } from "./intent.ts";
import { enqueuePcTask, pcSnapshot, cancelPcTask, workerOnline } from "./store.ts";
export async function* handOffPcErrand(dir: string, message: string, intent: PcIntent, requestId?: string, displayRequest?: string): AsyncGenerator<ChatEvent> {
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
      const task = await enqueuePcTask(dir, message, requestId, undefined, displayRequest);
      const scope = intent.plan.kind === "jobs" ? ({ search: "Search only; no applications will be submitted.", prepare: "Prepare drafts only; no applications will be submitted.", submit: "Submit only the requested job applications, up to " + intent.plan.maxApplications + ", with confirmation evidence.", track: "Update the job tracker only." })[intent.plan.action] : intent.plan.kind === "workspace" ? "Work only in the approved " + intent.plan.workspace + " workspace." : intent.plan.kind === "browser" ? (intent.plan.action === "execute" ? "Complete the browser actions you requested in signed-in Chrome." : "Open and read the requested pages in Chrome.") : intent.plan.kind === "computer" ? "Carry out your requested Windows app, file or command task using a capable local agent." : intent.plan.action === "open_app" ? "Open " + intent.plan.app + " on your PC." : "Open the link on your PC.";
      if (intent.plan.kind === "desktop") {
        // Opening a link or an app doesn't wait behind a long task: Hands does it right away on its quick lane.
        yield { type: "pc_task", taskId: task.id };
        yield { type: "text", text: (intent.plan.action === "open_url" ? "Opening that link on your PC now." : "Opening " + intent.plan.app + " on your PC now.") + (workerOnline(state) ? " It runs right away, even while another task is working." : " Hands is offline; it will open when your PC connects.") };
        yield { type: "done", sessionId: randomUUID() };
        return;
      }
      text = "Queued on your PC. " + scope + (workerOnline(state) ? " Hands will pass it to Claude Code or Codex, whichever is available." : " Hands is offline; it will wait for your PC.") + " Follow progress in PC activity.";
      yield { type: "pc_task", taskId: task.id };
    } catch (e) { text = e instanceof Error ? e.message : "Could not queue the PC task."; }
  }
  yield { type: "text", text };
  yield { type: "done", sessionId: randomUUID() };
}
