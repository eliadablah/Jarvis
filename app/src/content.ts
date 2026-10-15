// Every user-facing string on the site lives here, so wording changes
// never touch the page code.

import type { AppEnv } from "./config.ts";

export const content = {
  title: "Jarvis",
  status: "All systems online, sir.",
  intro: "This is Jarvis's home on my private network. The voice dashboard comes next.",
  envLabels: {
    local: "Local",
    dev: "Dev",
    prod: "Prod",
  } satisfies Record<AppEnv, string>,
  versionLabel: "Version",
  envLabel: "Environment",
  notFound: "Nothing here.",
} as const;
