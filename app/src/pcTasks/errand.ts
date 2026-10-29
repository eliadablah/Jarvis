// Catch-all for orders: anything that is plainly "do this" but did not match a
// narrower errand (jobs, Chrome, workspace, desktop app) still goes to Hands,
// which gives it to Claude Code or Codex. Questions, discussion and Jarvis's
// own task list stay in chat; resolvePcCommand has already filtered those and
// the unsafe phrasings before this runs.

import { parsePcIntent } from "./intent.ts";
import type { PcCommand } from "./commands.ts";

const ACTION_VERB = new RegExp("^(?:" + [
  "add", "set up", "setup", "update", "upgrade", "build", "create", "make", "write", "rewrite", "edit", "change", "replace",
  "fix", "debug", "refactor", "implement", "deploy", "ship", "publish", "push", "commit", "merge", "install", "uninstall",
  "run", "test", "review", "audit", "rename", "move", "copy", "remove", "clean(?: up)?", "organi[sz]e", "download", "upload",
  "convert", "generate", "configure", "enable", "disable", "start", "stop", "restart", "launch", "open", "close", "send",
  "email", "reply", "book", "schedule", "draft", "prepare", "translate", "analy[sz]e", "monitor", "sync", "back up", "backup",
  "migrate", "scrape", "automate", "investigate", "research", "look into", "figure out", "work on", "continue", "finish",
  "complete", "handle", "take care of",
].join("|") + ")\\b", "i");

// Jarvis's own lists and reminders are handled in chat, not on the PC.
const STAYS_IN_JARVIS = /\b(?:my (?:tasks?|to-?do(?: list)?|reminders?|dashboard|schedule)|(?:task|to-?do) list|on (?:the |my )?dashboard|remind me)\b/i;

/** "fix the login bug in Jarvis" -> a computer errand for a capable local agent. */
export function resolveGeneralErrand(text: string): PcCommand | undefined {
  if (text.length > 1500 || text.split(/\s+/).length < 2 || /\?\s*$/.test(text)) return;
  if (!ACTION_VERB.test(text) || STAYS_IN_JARVIS.test(text)) return;
  const request = "On my PC, execute this task: " + text;
  const intent = parsePcIntent(request);
  return intent ? { request, intent } : undefined;
}
