// Every user-facing string on the site lives here, so wording changes
// never touch the page code. The browser script gets its strings through
// data attributes on the page, so this stays the one place to edit.

import type { AppEnv } from "./config.ts";

export const content = {
  title: "Jarvis",
  envLabels: {
    local: "Local",
    dev: "Dev",
    prod: "Prod",
  } satisfies Record<AppEnv, string>,
  versionLabel: "Version",
  inputPlaceholder: "Ask Jarvis something…",
  sendLabel: "Send",
  micLabel: "Hold to talk",
  micUnsupported: "Voice input isn't supported in this browser. Type instead.",
  menuLabel: "Menu",
  faceLabel: "Face",
  engineLabel: "Chat engine",
  claudeLabel: "Claude",
  codexLabel: "Codex",
  faceNames: { board: "Circuit Board", radial: "Radial", rain: "Face in the Code", neural: "Neural Core" },
  voiceOnLabel: "Voice: on",
  voiceOffLabel: "Voice: off",
  newChatLabel: "New chat",
  hideChatLabel: "Hide chat",
  showChatLabel: "Show chat",
  voiceLoading: "Loading Jarvis's voice",
  voiceReady: "Voice ready",
  voiceFailed: "Using the browser's voice",
  listening: "Listening…",
  thinking: "Thinking…",
  emptyState: "All systems online, sir. What are we working on today?",
  errorPrefix: "Something went wrong:",
  noScript: "Jarvis needs JavaScript turned on.",
  credit: "Faces: ai-visualizer by Jared Rhodenizer (AGPL-3.0). Voice: Kokoro (Apache-2.0).",
  sourceLabel: "Source",
  notFound: "Nothing here.",
} as const;
