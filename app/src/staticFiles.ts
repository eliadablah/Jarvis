// Serves the compiled browser script (dist/public/chat.js). Loaded once at
// startup; if it's missing (e.g. running from source without a build), the
// page still loads, just without the chat.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface StaticFile {
  contentType: string;
  body: string;
}

/** Reads a file next to the running code, or returns undefined. */
function load(relativePath: string, contentType: string): StaticFile | undefined {
  try {
    const body = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
    return { contentType, body };
  } catch {
    return undefined;
  }
}

const files: Record<string, StaticFile | undefined> = {
  "/chat.js": load("./public/chat.js", "text/javascript; charset=utf-8"),
};

/** Returns the static file for a path, if there is one. */
export function getStaticFile(path: string): StaticFile | undefined {
  return files[path];
}
