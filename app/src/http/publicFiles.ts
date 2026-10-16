// Serves Jarvis's own browser files from dist/public: the compiled page
// scripts (chat.js, face-bus.js, ...) and the self-hosted voice engine
// under /voice/. Replaces the old single-file staticFiles module.

import type { ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { appHeaders, faceHeaders } from "./securityHeaders.ts";
import { resolveInside, streamFile } from "./fileServing.ts";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

/** Voice engine files never change for a given version, so cache them long. */
function cacheControlFor(urlPath: string): string {
  return urlPath.startsWith("/voice/") ? "public, max-age=604800" : "no-cache";
}

/** Serves a public file. Returns false if there's no such file. */
export function servePublic(res: ServerResponse, urlPath: string, method: string, publicDir = PUBLIC_DIR): boolean {
  if (urlPath === "/" || urlPath.endsWith("/")) return false;
  const filePath = resolveInside(publicDir, urlPath);
  if (!filePath) return false;

  // face-bus.js runs inside the face pages, so it takes their policy.
  const headers = urlPath === "/face-bus.js" ? faceHeaders() : appHeaders();
  return streamFile(res, filePath, { ...headers, "Cache-Control": cacheControlFor(urlPath) }, method);
}
