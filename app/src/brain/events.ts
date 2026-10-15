// The small set of events the chat sends to the browser, one JSON object
// per line. Kept separate so the server, the brain, and tests share it.

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; message: string };
