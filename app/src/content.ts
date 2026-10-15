// Every user-facing string on the site lives here, so wording changes
// never touch the page code. The browser script gets its strings through
// data attributes on the page, so this stays the one place to edit.

import type { AppEnv } from "./config.ts";

export const content = {
  title: "Jarvis",
  status: "All systems online, sir.",
  envLabels: {
    local: "Local",
    dev: "Dev",
    prod: "Prod",
  } satisfies Record<AppEnv, string>,
  versionLabel: "Version",
  inputPlaceholder: "Ask Jarvis something…",
  sendLabel: "Send",
  newChatLabel: "New chat",
  thinking: "Thinking…",
  emptyState: "What are we working on today, sir?",
  errorPrefix: "Something went wrong:",
  noScript: "The chat needs JavaScript turned on.",
  notFound: "Nothing here.",
} as const;
