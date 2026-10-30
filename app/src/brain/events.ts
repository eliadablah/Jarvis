// Events shared by the server, provider adapters, and browser.
export type ChatProvider = "claude" | "codex" | "gemini" | "perplexity";
export const CHAT_PROVIDERS: readonly ChatProvider[] = ["claude", "codex", "gemini", "perplexity"];
export type ChatFailureCode = "quota" | "authentication" | "unavailable";

export type ChatEvent =
  | { type: "pc_task"; taskId: string }
  | { type: "engine"; provider: ChatProvider; reason: string }
  | { type: "text"; text: string }
  | { type: "done"; sessionId: string; provider?: ChatProvider }
  | { type: "error"; message: string; code?: ChatFailureCode };
