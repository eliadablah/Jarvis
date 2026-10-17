// Tells everyday ways of giving an order from statements and questions, so
// "go ahead and pull up my tracker" works like "pull up my tracker" while
// "I'm getting paid on Friday" stays a normal chat message.
//
// The cues come from how people really phrase requests (speech-act research):
//  - direct imperatives, often softened: "please", "just", "go ahead and",
//    "feel free to", "make sure you", "let's";
//  - conventional indirect requests that are questions or wishes in form but
//    orders in practice: "can/could/would/will you ...", "I need/want/'d like
//    you to ...", "you should/need to ...";
//  - filler before the order: "okay jarvis", "so", "alright", "now", "and then";
//  - courtesy after it: "for me", "please", "thanks", "right now".
// These stay statements: "I need to ...", "I'm going to ...", "I'm getting ..."
// (the speaker's own plans or facts, no "you"), plus questions and negations.
//
// This only cleans up the wording before the existing, strict PC-task grammar
// runs. It never widens what that grammar accepts.

const FILLER = /^(?:hey|hi|hello|ok|okay|alright|all right|right|so|well|yeah|yes|yep|sure|now|then|also|and|just|actually|um|uh|oh)\b[,.!\s]*/i;
const NAME = /^jarvis\b[,.!:\s]*/i;
const POLITE = /^(?:please|kindly)\b[,\s]*/i;
// "can you (please) (go ahead and) ...": a request in the form of a question.
const MODAL_REQUEST = /^(?:can|could|would|will) you (?:please |kindly )?(?:just |go ahead and |go on and )?/i;
const DIRECTIVE_LEAD = new RegExp("^(?:" + [
  "i (?:want|need|ask|request|am asking) you to", "i'm asking you to", "i(?:'d| would) (?:like|love|appreciate it if) you to",
  "(?:you (?:need|have|ought|should|must|can|may)(?: to)?|you'?d better)",
  "go (?:right )?ahead(?: and)?", "go on and", "go and",
  "feel free to", "make sure (?:you |to )", "be sure to", "do me a favou?r and", "i'd like for you to",
  "let's", "let us", "try to", "start by", "get started and", "proceed to",
].join("|") + ")\\b\\s*", "i");
const TRAILING = /[,\s]*(?:for me|please|kindly|thanks|thank you|right now|real quick|asap|if you can|when you can|when you get a chance)[.!\s]*$/i;

/** "Okay Jarvis, can you please go ahead and open Notepad for me?" -> "open Notepad". */
export function normalizeCommand(message: string): string {
  let text = message.trim().replace(/[’]/g, "'");
  for (let i = 0; i < 6; i++) {
    const before = text;
    for (const lead of [FILLER, NAME, POLITE, MODAL_REQUEST, DIRECTIVE_LEAD]) {
      const stripped = text.replace(lead, "");
      if (stripped.trim()) text = stripped;
    }
    if (text === before) break;
  }
  for (let i = 0; i < 3; i++) {
    const stripped = text.replace(TRAILING, "").replace(/\?+$/, "");
    if (!stripped.trim() || stripped === text) break;
    text = stripped;
  }
  return text.trim();
}

/** "Would you apply to jobs if I asked?" asks about a hypothetical; it is not an order. */
export function isHypotheticalQuestion(message: string): boolean {
  const text = message.trim().replace(/^(?:(?:hey|ok|okay|so)\s+)?(?:jarvis[,\s]+)?/i, "");
  return /^(?:would|could|can|will) you\b[^.!]*\b(?:if|whether|suppose|supposing|assuming)\b/i.test(text)
    || /^(?:what|how) (?:if|about)\b/i.test(text);
}
