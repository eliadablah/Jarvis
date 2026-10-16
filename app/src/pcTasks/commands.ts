import { parsePcIntent, type PcIntent } from "./intent.ts";

export interface PcCommand { request: string; intent: PcIntent; }
const clarify = (message: string): PcCommand => ({ request: "", intent: { type: "clarify", message } });
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
