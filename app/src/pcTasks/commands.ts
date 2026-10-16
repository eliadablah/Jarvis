import { parsePcIntent, type PcIntent } from "./intent.ts";

export interface PcCommand { request: string; intent: PcIntent; }
const clarify = (message: string): PcCommand => ({ request: "", intent: { type: "clarify", message } });

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function countValue(value: string): number { return /^\d+$/.test(value) ? Number(value) : COUNT_WORDS.indexOf(value.toLowerCase()); }
/** An application is a jobs action even when the user first names Chrome or
 * asks to open LinkedIn. Preserve all original limits in the canonical request. */
function resolveJobCommand(text: string): PcCommand | undefined {
  const actionText = text.replace(/^in (?:my )?(?:chrome|browser)[,:]?\s+/i, "");
  const mixed = /^(?:open|visit|go to|navigate to|pull up|bring up)\s+(.+?)\s+(?:and|then)[,\s]+(.+)$/i.exec(actionText);
  const action = mixed ? mixed[2]! : actionText;
  if (!/^(?:apply|submit|finish|complete|find|search|look for|prepare|draft|tailor|fill out|fill in|update|log|add)\b/i.test(action)) return;
  if (/^apply\b.*\bjokes?\b/i.test(action))
    return clarify('I heard "apply to a joke". Did you mean apply to one job? Nothing has been queued or submitted.');
  const request = action + (mixed || actionText !== text ? "\nOriginal requested context: " + text : "");
  const intent = parsePcIntent(request);
  if (intent?.type === "clarify") return { request, intent };
  if (intent?.type !== "task" || intent.plan.kind !== "jobs") {
    if (mixed && /^(?:apply|submit)\b/i.test(action))
      return clarify('Which job should I apply to, and how many? Name the role or job link. Nothing has been queued.');
    return;
  }
  if (intent.plan.action !== "submit") return { request, intent };
  let amount = intent.plan.maxApplications;
  const primary = /\b(?:apply(?:\s+(?:to|for))?|submit|finish|complete)\s+(?:(?:my|the|these|those|up to)\s+)?(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(action);
  if (primary) amount = Math.min(25, countValue(primary[1]!));
  else if (/^(?:apply(?:\s+(?:to|for))?|submit|finish|complete)\s+(?:my\s+)?(?:a|an|this|that|the)\b.{0,90}\b(?:job|role|position|application)\b/i.test(action) ||
      /^apply\b.*https?:\/\/(?:www\.)?linkedin\.com\/jobs\/view\/\d+/i.test(action)) amount = 1;
  const limits = /\b(?:up to|at most|no more than|only|maximum(?: of)?)\s+(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=\s*(?:[.,!?;]|$)|\s+(?:[a-z-]+\s+){0,4}(?:jobs?|roles?|positions?|applications?)\b)/gi;
  for (const limit of action.matchAll(limits)) amount = Math.min(amount, countValue(limit[1]!));
  // Existing workers reparse this exact numeric cap, including zero. Keeping
  // original text means no-submit instructions still prevent a submission.
  const canonical = "Apply to " + amount + " job applications. " + request;
  return { request: canonical, intent: parsePcIntent(canonical)! };
}

/** Normalize explicit user commands before enqueueing. Keep the protocol-2 grammar
 * unchanged so an already-running worker can independently validate every plan. */
export function resolvePcCommand(message: string, previousLink?: string): PcCommand | undefined {
  let text = message.trim().replace(/’/g, "'")
    .replace(/^(?:hey\s+)?jarvis[,!:\s]+/i, "")
    .replace(/^(?:please\s+)?(?:(?:can|could|would|will) you\s+|i (?:want|need) you to\s+)?(?:please\s+)?/i, "")
    .replace(/^go (?:and )?(?!to\b)/i, "");
  // Never turn discussion, quotes, negation or permission bypasses into actions.
  if (/^(?:don't|do not|not|never|how|what|why|when|did|is|are|if|imagine|explain|tell me|remind|help|plan|should|would|["'“])\b/i.test(text) || /^["'“]/.test(text)) return;
  if (/\b(?:ignore|bypass|disable|override)\b.{0,35}\b(?:permission|guardrail|rule|safety|sandbox)/i.test(text)) return;
  text = text.replace(/^on my (?:pc|computer)[,:]?\s+(?=(?:open|pull up|bring up|launch|visit|navigate to|go to)\b)/i, "");
  const job = resolveJobCommand(text);
  if (job) return job;
  const direct = parsePcIntent(text);
  if (direct) return { request: text, intent: direct };
  const open = /^(?:open|pull up|bring up|launch|visit|navigate to|go to)\s+(.+?)\s*[.!]?$/i.exec(text);
  if (open) {
    let target = open[1]!;
    if (/^(?:it|that|this|that link|this link|the link)[.!]?$/i.test(target)) {
      if (!previousLink) return clarify("Which link should I open on your PC? Paste it here or name the website or tracker.");
      target = previousLink;
    }
    if (/\b(?:calculator|notepad|file explorer|powershell|terminal|cmd|excel|word|settings)\b/i.test(target) && !/https?:\/\//i.test(target))
      return clarify("I can open Calculator, Notepad or File Explorer directly, and websites through your Chrome worker. Control inside other Windows apps isn't connected yet. Name a website or an approved workspace for this task.");
    if (/\b(?:file|javascript|data|chrome|about):|\b[a-z]:[\\/]|\\\\/i.test(target))
      return clarify("Send a normal http or https website link, or name an approved workspace for a local file.");
    const url = /https?:\/\/[^\s<>"']+/i.exec(target)?.[0];
    if (url) {
      try { const parsed = new URL(url); if (parsed.username || parsed.password) return clarify("Remove the username or password from that link before opening it."); }
      catch { return clarify("That link isn't valid. Send the full website URL."); }
    }
    // The Chrome adapter may locate saved bookmarks/URLs in its approved jobs
    // workspace. Never invent or publish a user's private tracker URL.
    const tracker = /\b(?:job|application) tracker\b/i.test(target)
      ? " Locate its saved URL in the approved jobs workspace notes if necessary; do not invent a URL or create a replacement tracker." : "";
    const request = "In my Chrome, open " + target + tracker;
    return { request, intent: parsePcIntent(request)! };
  }
  if (/^(?:search(?: for)?|find|look up|look for|read|check|summari[sz]e|compare)\b/i.test(text) &&
      /\b(?:in (?:my )?(?:chrome|browser)|website|web page|webpage|gmail|email|inbox|google (?:sheet|calendar)|https?:\/\/)/i.test(text)) {
    const request = "In my Chrome, " + text.replace(/^look (?:up|for)\b/i, "find");
    return { request, intent: parsePcIntent(request)! };
  }
  if (/^(?:send|reply|forward|delete|purchase|buy|pay|install|download|click|type|move|rename)\b/i.test(text) || /^(?:create|write|edit|fix|run)\b/i.test(text) && /\b(?:pc|computer|files?|folders?|workspace|repo|project)\b|\.[a-z0-9]{1,6}\b/i.test(text))
    return clarify('Tell me the target for that action: for local files, say "in my assistant workspace, ..."; for job applications, say "apply to ... jobs". Chrome currently supports reading and opening pages. Other account changes and arbitrary Windows controls are not connected yet. Nothing has been queued.');
  return;
}

/** Only http(s) links explicitly returned in a previous successful reply. */
export function replyLink(text: string): string | undefined {
  const links = text.match(/https?:\/\/[^\s<>"'\]]+/gi) ?? [];
  const unique = new Set<string>();
  for (const value of links) {
    try {
      const url = new URL(value.replace(/[.,;:!?]+$/, "").replace(/\)+$/, ""));
      if (!url.username && !url.password) unique.add(url.href);
    } catch { /* not a link */ }
  }
  // Ambiguous replies must never silently choose one of several destinations.
  return unique.size === 1 ? [...unique][0] : undefined;
}
