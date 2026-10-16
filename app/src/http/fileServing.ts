// Safe file serving shared by the public assets and the visualizer faces:
// resolves a URL path inside one folder (never outside it, never dotfiles),
// picks the content type, and streams the file.

import { createReadStream, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

const CONTENT_TYPES: Record<string, string> = {
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

/** Content type for a file name, or undefined if it isn't a type we serve. */
export function contentTypeFor(fileName: string): string | undefined {
  return CONTENT_TYPES[extname(fileName).toLowerCase()];
}

/**
 * Maps a URL path (relative to a mount point) to a file inside root.
 * Returns undefined for anything that escapes root, touches a dotfile,
 * or has a type we don't serve.
 */
export function resolveInside(root: string, relativeUrlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativeUrlPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;

  const parts = decoded.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part.startsWith(".") || part === "..")) return undefined;

  const rootPath = resolve(root);
  const filePath = resolve(rootPath, ...parts);
  if (filePath !== rootPath && !filePath.startsWith(rootPath + sep)) return undefined;
  if (!contentTypeFor(filePath)) return undefined;
  return filePath;
}

/** True if the path is an existing regular file. */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Streams a file with the given headers. Returns false if it can't be read. */
export function streamFile(
  res: ServerResponse,
  filePath: string,
  headers: Record<string, string>,
  method: string,
): boolean {
  const type = contentTypeFor(filePath);
  if (!type || !isFile(filePath)) return false;

  res.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": statSync(filePath).size });
  if (method === "HEAD") {
    res.end();
  } else {
    createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
  }
  return true;
}
