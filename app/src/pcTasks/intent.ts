// Decides when a chat message is a job-hunting errand for the PC worker
// ("apply to DevOps jobs", "find me some support roles and apply").

const ROLE = String.raw`(jobs?|roles?|positions?|openings?|postings?|vacanc(y|ies))`;
const ACTION = String.raw`(apply|applying|find|search|look(ing)? for|hunt|go after)`;
const PATTERN = new RegExp(String.raw`\b${ACTION}\b[^.?!]{0,80}\b${ROLE}\b|\b${ROLE}\b[^.?!]{0,80}\b(apply|applying)\b`, "i");

// "How did the job applying go?" asks for a report; it isn't a new errand.
const STATUS_QUESTION = /^\s*(how|did|what|what's|whats|when|which|where|any update|status)\b/i;

/** True for requests to find or apply to jobs. */
export function isJobErrand(message: string): boolean {
  return PATTERN.test(message) && !STATUS_QUESTION.test(message);
}
