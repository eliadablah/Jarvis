import { parsePcIntent, type PcIntent } from "./intent.ts";
import { isHypotheticalQuestion, normalizeCommand } from "./phrasing.ts";

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
  if (!/\b(?:jobs?|roles?|positions?|openings?|vacancies|applications?|job tracker|application tracker)\b/i.test(action) && !/linkedin|indeed/i.test(text)) return;
  const request = action + (mixed || actionText !== text ? "\nOriginal requested context: " + text : "");
  const intent = parsePcIntent(request);
  if (intent?.type === "clarify") return { request, intent };
  if (intent?.type !== "task" || intent.plan.kind !== "jobs") {
    if (mixed && /^(?:apply|submit)\b/i.test(action) && /linkedin|indeed/i.test(text)) {
      const canonical = "Apply to 1 job applications. " + text;
      return { request: canonical, intent: parsePcIntent(canonical)! };
    }
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
  // Everyday ways of giving an order ("go ahead and ...", "can you please ...",
  // "I need you to ...") reduce to the plain command; statements stay statements.
  if (isHypotheticalQuestion(message)) return;
  let text = normalizeCommand(message);
  // Questions that explicitly need local PC state are read requests for the
  // desktop executor; they do not authorize changing that state.
  if (/^(?:what(?:'s| is| are)?|where|which|show|list|check|read|find|search)\b/i.test(text) && /\b(?:on my (?:pc|computer)|my (?:desktop|downloads|documents folder)|running programs|open windows)\b/i.test(text)) {
    const request = "On my PC, execute this task: " + text;
    return { request, intent: parsePcIntent(request)! };
  }
  // Never turn discussion, quotes, negation or permission bypasses into actions.
  if (/^(?:don't|do not|not|never|how|what|why|when|did|is|are|if|imagine|explain|tell me|remind|help|plan|should|would|["'“])\b/i.test(text) || /^["'“]/.test(text)) return;
  if (/\b(?:ignore|bypass|disable|override)\b.{0,35}\b(?:permission|guardrail|rule|safety|sandbox)/i.test(text)) return;
  const ruflo = /^use ruflo in (?:my |the )?([a-z][a-z0-9_-]{0,40}) (?:workspace|project|repo)\s+(?:to\s+)?(.+)/i.exec(text);
  if (ruflo && /^(?:create|write|edit|fix|build|test|run|organize|read|summari[sz]e|review|check|list|update)\b/i.test(ruflo[2]!)) {
    const request = "In my " + ruflo[1]!.toLowerCase() + " workspace, " + ruflo[2] + ". Use the connected Ruflo task and memory tools to organize this work.";
    return { request, intent: parsePcIntent(request)! };
  }
  // Explicit project continuation is already a command, not a model-suggested offer.
  // A named workspace still has to be approved in the local worker configuration.
  const continuation = /^(?:continue|resume|finish)\s+(?:the\s+)?([a-z][a-z0-9_-]{0,40})\b.{0,100}\b(?:project|repo|workspace|demo)\b/i.exec(text);
  if (continuation) {
    const request = "In my " + continuation[1]!.toLowerCase() + " workspace, update the existing project. Original user request: " + text;
    return { request, intent: parsePcIntent(request)! };
  }
  if (/^(?:draft|prepare|write)\b/i.test(text) && /\blinked\s*in\b/i.test(text) && /\b(?:replies|reply|messages?)\b/i.test(text)) {
    const request = "In my Chrome, execute this task: " + text;
    return { request, intent: parsePcIntent(request)! };
  }
  text = text.replace(/^on my (?:pc|computer)[,:]?\s+(?=(?:open|pull up|bring up|launch|visit|navigate to|go to)\b)/i, "");
  const job = resolveJobCommand(text);
  if (job) return job;
  const native = /^on my (?:pc|computer)[,:]?\s+(.+)/i.exec(text);
  const browser = /^in (?:my )?(?:chrome|browser)[,:]?\s+(.+)/i.exec(text);
  if (native && !/^execute this task:/i.test(native[1]!)) {
    const request = "On my PC, execute this task: " + native[1];
    return { request, intent: parsePcIntent(request)! };
  }
  const browserAction = /^(?:send|reply|forward|upload|download|fill|submit|book|schedule|update|edit|change|delete|save|click|type|press|create|add|move|rename)\b/i;
  if (browser && (browserAction.test(browser[1]!) || /\b(?:and|then)\s+(?:send|reply|forward|upload|fill|submit|book|schedule|update|edit|change|delete|save|click|type|press|create|add)\b/i.test(browser[1]!))) {
    const request = "In my Chrome, execute this task: " + browser[1];
    return { request, intent: parsePcIntent(request)! };
  }
  if (browserAction.test(text) && /\b(?:gmail|emails?|inbox|google (?:sheets?|calendar|docs)|spreadsheet|calendar|website|webpage|in (?:my )?(?:chrome|browser)|https?:\/\/)/i.test(text)) {
    const request = "In my Chrome, execute this task: " + text;
    return { request, intent: parsePcIntent(request)! };
  }
  if (/^(?:open|launch|start|close|switch|move|rename|copy|paste|delete|create|write|edit|fix|build|test|run|install|uninstall|download|upload|organize|clean|fill|update|turn|enable|disable|set)\b/i.test(text) &&
      /\b(?:excel|word|outlook|notepad|calculator|file explorer|windows|powershell|terminal|my (?:pc|computer|desktop|downloads|documents)|files?|folders?)\b|\b[a-z]:[\\/]/i.test(text) && !/^(?:open|launch|start) (?:my |the )?(?:calculator|notepad|file explorer)[.!]?$/i.test(text)) {
    const request = "On my PC, execute this task: " + text;
    return { request, intent: parsePcIntent(request)! };
  }
  const direct = parsePcIntent(text);
  if (direct) return { request: text, intent: direct };
  const open = /^(?:open|pull up|bring up|launch|visit|navigate to|go to)\s+(.+?)\s*[.!]?$/i.exec(text);
  if (open) {
    let target = open[1]!;
    if (/^(?:it|that|this|that link|this link|the link)[.!]?$/i.test(target)) {
      if (!previousLink) return clarify("Which link should I open on your PC? Paste it here or name the website or tracker.");
      target = previousLink;
    }
    if (/^(?:javascript|data|chrome|about):/i.test(target)) return clarify("Send a normal http or https website link.");
    if (!/https?:\/\/|\b(?:gmail|linkedin|google|website|webpage|tracker|sheets?|calendar)\b|[a-z0-9-]+\.(?:com|org|net|io|dev|edu)\b/i.test(target)) {
      const request = "On my PC, execute this task: open " + target;
      return { request, intent: parsePcIntent(request)! };
    }
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
    const changes = /\b(?:and|then)\s+(?:send|reply|forward|upload|fill|submit|book|schedule|update|edit|change|delete|save|click|type|press|create|add)\b/i.test(target);
    const request = "In my Chrome, " + (changes ? "execute this task: open " : "open ") + target + tracker;
    return { request, intent: parsePcIntent(request)! };
  }
  if (/^(?:search(?: for)?|find|look up|look for|read|check|summari[sz]e|compare)\b/i.test(text) &&
      /\b(?:in (?:my )?(?:chrome|browser)|website|web page|webpage|gmail|email|inbox|google (?:sheet|calendar)|https?:\/\/)/i.test(text)) {
    const request = "In my Chrome, " + text.replace(/^look (?:up|for)\b/i, "find");
    return { request, intent: parsePcIntent(request)! };
  }
  if (/^(?:send|reply|forward|upload|download|book|schedule|click|type|press|move|rename|copy|paste|install|uninstall)\b/i.test(text)) {
    const request = "On my PC, execute this task: " + text;
    return { request, intent: parsePcIntent(request)! };
  }
  if (/^(?:send|reply|forward|delete|purchase|buy|pay|install|download|click|type|move|rename)\b/i.test(text) || /^(?:create|write|edit|fix|run)\b/i.test(text) && /\b(?:pc|computer|files?|folders?|workspace|repo|project)\b|\.[a-z0-9]{1,6}\b/i.test(text))
    return clarify('Tell me the target for that action: for local files, say "in my assistant workspace, ..."; for job applications, say "apply to ... jobs". For desktop work, say "on my PC, ...". For browser actions, say "in my Chrome, ...". The worker chooses an available agent with the required tools. Nothing has been queued.');
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
