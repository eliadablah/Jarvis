// Events shared by the server, provider adapters, and browser.
export type ChatProvider = "claude" | "codex" | "gemini";
export const CHAT_PROVIDERS: readonly ChatProvider[] = ["claude", "codex", "gemini"];
export type ChatFailureCode = "quota" | "authentication" | "unavailable";

export type ChatEvent =
  | { type: "engine"; provider: ChatProvider; reason: string }
  | { type: "text"; text: string }
  | { type: "done"; sessionId: string; provider?: ChatProvider }
  | { type: "error"; message: string; code?: ChatFailureCode };
