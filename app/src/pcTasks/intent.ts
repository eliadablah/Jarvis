import type { PcPlan } from "./protocol.ts";
export type PcIntent = { type: "task"; plan: PcPlan } | { type: "clarify"; message: string } | { type: "cancel" };
/** Narrow action grammar: discussion, quoted commands and vague drafts never execute. */
export function parsePcIntent(message: string): PcIntent | undefined {
  const text = message.trim().replace(/[’]/g, "'").replace(/^(?:hey\s+)?jarvis[,!:\s]+/i, "")
    .replace(/^(?:please\s+)?(?:(?:can|could|would) you\s+|i want you to\s+)?(?:please\s+)?/i, "");
  if (/^(?:cancel|stop) (?:my |the )?(?:pc|computer|running) (?:task|errand)[.!]?$/i.test(text)) return { type: "cancel" };
  if (/^(?:don't|do not|never|stop|cancel|how|what|why|when|did|is|are|if|imagine|explain|tell me|remind|help|plan|should|would)\b/i.test(text)) return;
  if (/\b(?:ignore|bypass|disable|override)\b.{0,35}\b(?:permission|guardrail|rule|safety|sandbox)/i.test(text)) return;
  const app = /^(?:open|launch|start) (?:my |the )?(calculator|notepad|file explorer)(?: on my (?:pc|computer))?[.!]?$/i.exec(text);
  if (app) return { type: "task", plan: { kind: "desktop", action: "open_app", app: app[1]!.toLowerCase() === "file explorer" ? "explorer" : app[1]!.toLowerCase() as "calculator" | "notepad" } };
  const workspace = /^(?:in|inside) (?:my |the )?([a-z][a-z0-9_-]{0,40}) (?:workspace|project|repo)[,:]?\s+(.+)/i.exec(text);
  if (workspace && /^(?:create|write|edit|fix|build|test|run|organize|read|summari[sz]e|review|check|list|update)\b/i.test(workspace[2]!))
    return { type: "task", plan: { kind: "workspace", action: "execute", workspace: workspace[1]!.toLowerCase() } };
  if (/^(?:in (?:my )?(?:chrome|browser)[,:]?\s+|on my (?:pc|computer)[,:]?\s+)/i.test(text)) {
    if (/^in (?:my )?(?:chrome|browser)[,:]?\s+(?:open|find|search|read|check|summari[sz]e|compare|navigate)\b/i.test(text))
      return { type: "task", plan: { kind: "browser", action: "browse" } };
    return { type: "clarify", message: 'For files, name an approved workspace: "in my assistant workspace, create a budget template". For browser work: "in my Chrome, find ...". I can open Calculator, Notepad, or File Explorer. Other desktop controls are not connected yet.' };
  }
  const jobContext = /\b(?:jobs?|roles?|positions?|openings?|vacancies|job applications?|application tracker|job tracker)\b/i.test(text);
  if (!jobContext) {
    if (/^(?:submit|send|finish)\b.*\b(?:drafts?|applications?)\b/i.test(text))
      return { type: "clarify", message: 'Name what you want submitted, for example "submit my prepared job applications for Acme". Nothing has been queued.' };
    return;
  }
  const noSubmit = /\b(?:don't|do not|never|without|not)\s+(?:(?:ever|actually)\s+)?(?:apply(?:ing)?|submit(?:ting)?|send(?:ing)?)\b|\b(?:search|find|prepare|draft) only\b/i.test(text);
  let action: "search" | "prepare" | "submit" | "track" | undefined;
  if (/^(?:find|search|look for|search for)\b/i.test(text)) action = /\b(?:and|then)\s+(?:apply|submit)\b/i.test(text) && !noSubmit ? "submit" : "search";
  else if (/^(?:prepare|draft|tailor|fill out|fill in)\b/i.test(text)) action = "prepare";
  else if (/^(?:apply|submit)\b/i.test(text) || /^(?:finish|complete)\b.*\bjob applications?\b/i.test(text)) {
    if (noSubmit) return { type: "clarify", message: "That request mixes applying with a no-submit instruction. Say search, prepare, or submit job applications. Nothing has been queued." };
    action = "submit";
  } else if (/^(?:update|log|add)\b.*\b(?:job|application) tracker\b/i.test(text)) action = "track";
  if (!action) return;
  const count = /\b(?:apply to|submit|finish|complete|up to)\s+(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(text);
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const amount = count ? (/^\d+$/.test(count[1]!) ? Number(count[1]) : words.indexOf(count[1]!.toLowerCase())) : 10;
  if (action === "submit" && amount === 0) return { type: "clarify", message: "You requested zero applications, so nothing has been queued." };
  const maxApplications = action === "submit" ? Math.min(25, amount) : 0;
  return { type: "task", plan: { kind: "jobs", action, maxApplications } };
}
export function isJobErrand(message: string): boolean {
  const intent = parsePcIntent(message); return intent?.type === "task" && intent.plan.kind === "jobs";
}
