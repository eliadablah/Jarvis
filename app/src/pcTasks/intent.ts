// Decides when a chat message is a job-search errand for the PC worker:
// finding and applying ("apply to DevOps jobs"), finishing or submitting
// prepared applications ("submit the Dexian application", "submit all
// drafts"), and updating the tracker sheet.

const ROLE = String.raw`(jobs?|roles?|positions?|openings?|postings?|vacanc(y|ies))`;
const ACTION = String.raw`(apply|applying|find|search|look(ing)? for|hunt|go after)`;
const APPLY = new RegExp(String.raw`\b${ACTION}\b[^.?!]{0,80}\b${ROLE}\b|\b${ROLE}\b[^.?!]{0,80}\b(apply|applying)\b`, "i");
const SUBMIT = /\b(submit|send( in)?|finish|complete|fill( out| in)?)\b[^.?!]{0,60}\b(applications?|apps|drafts?)\b|\bsubmit (all|them|those|it|\d)/i;
const TRACKER = /\b(update|fill( in)?|log|add)\b[^.?!]{0,40}\b(job |application )?tracker\b/i;

// "How did the job applying go?" asks for a report; it isn't a new errand.
const STATUS_QUESTION = /^\s*(how|did|what|what's|whats|when|which|where|any update|status)\b/i;

/** True for job-search errands the PC worker should carry out. */
export function isJobErrand(message: string): boolean {
  if (STATUS_QUESTION.test(message)) return false;
  return APPLY.test(message) || SUBMIT.test(message) || TRACKER.test(message);
}
