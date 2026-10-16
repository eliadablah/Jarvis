// Serves the ai-visualizer faces (by jaredrhod, AGPL-3.0) under /face/.
//
// The visualizer's files are served exactly as published, with one
// addition: each face page gets /face-bus.js loaded just before its
// core.js. Locally the faces ask a small Python server for /state and
// /config; here face-bus.js answers those two requests from inside the
// browser using Jarvis's live chat and voice state. No visualizer file is
// changed.

import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { faceHeaders } from "../http/securityHeaders.ts";
import { isFile, resolveInside, streamFile } from "../http/fileServing.ts";

export const FACE_PREFIX = "/face/";
export const FACES = ["board", "radial", "rain", "neural"] as const;
export type FaceName = (typeof FACES)[number];

const CORE_TAG = '<script src="../../core.js"></script>';
const BUS_TAG = '<script src="/face-bus.js"></script>';

/** Adds the bus script right before core.js. Returns undefined if core.js isn't there. */
export function injectBus(html: string): string | undefined {
  if (!html.includes(CORE_TAG)) return undefined;
  return html.replace(CORE_TAG, `${BUS_TAG}\n${CORE_TAG}`);
}

/** True for a face's own page, e.g. faces/board/index.html. */
function isFacePage(relativePath: string): boolean {
  return /^faces\/[a-z0-9-]+\/(index\.html)?$/.test(relativePath);
}

/**
 * Handles a request under /face/. Returns false if it isn't a file we
 * serve, so the caller can send a 404.
 */
export function serveFace(res: ServerResponse, urlPath: string, method: string, visualizerDir: string): boolean {
  let relative = urlPath.slice(FACE_PREFIX.length);
  if (isFacePage(relative) && relative.endsWith("/")) relative += "index.html";

  const filePath = resolveInside(visualizerDir, relative);
  if (!filePath || !isFile(filePath)) return false;

  if (isFacePage(relative)) {
    const html = injectBus(readFileSync(filePath, "utf8"));
    if (!html) return false;
    res.writeHead(200, { ...faceHeaders(), "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(method === "HEAD" ? undefined : html);
    return true;
  }

  return streamFile(res, filePath, { ...faceHeaders(), "Cache-Control": "public, max-age=3600" }, method);
}
