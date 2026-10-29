// The live screen view API.
//
// From the dashboard (your browser on the tailnet):
//   POST /api/pc/screen/watch   {mode: video|screenshots|off}  say what you want to watch (repeat every few seconds)
//   GET  /api/pc/screen/status  is anything live
//   GET  /api/pc/screen/video   the live video (fragmented MP4, relayed, never stored)
//   GET  /api/pc/screen/frame   the newest screenshot (JPEG)
// From Hands on your PC (needs the worker token):
//   GET  /api/pc/screen/control      what to capture right now: off, video or screenshots
//   POST /api/pc/screen/ingest/video the video, streamed as it is recorded
//   POST /api/pc/screen/ingest/frame one screenshot

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { ChatRequestError, checkRequestSource, readBody } from "../api/chatRequest.ts";
import { appHeaders } from "../http/securityHeaders.ts";
import { tokenMatches } from "../pcTasks/api.ts";
import { Mp4Splitter } from "./mp4.ts";
import { SCREEN_MODES, screenHub, type ScreenHub, type ScreenMode } from "./hub.ts";

const MAX_FRAME_BYTES = 600_000;
const VIDEO_WAIT_MS = 10_000;
let currentIngest = 0;

export async function handleScreen(req: IncomingMessage, res: ServerResponse, path: string, config: AppConfig, hub: ScreenHub = screenHub): Promise<void> {
  const method = req.method ?? "GET";
  const json = (status: number, body: unknown) => { res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  const fromWorker = () => !!config.pcWorkerToken && tokenMatches(req.headers.authorization, config.pcWorkerToken);
  try {
    // --- Viewer side ---
    if (path === "/api/pc/screen/status" && method === "GET") { json(200, hub.status()); return; }
    if (path === "/api/pc/screen/watch" && method === "POST") {
      checkRequestSource(req.headers);
      let body: { mode?: unknown };
      try { body = JSON.parse(await readBody(req)); } catch (err) { if (err instanceof ChatRequestError) throw err; throw new ChatRequestError(400, "Invalid JSON."); }
      if (!SCREEN_MODES.includes(body.mode as ScreenMode)) throw new ChatRequestError(400, "Mode must be video, screenshots or off.");
      hub.want(body.mode as ScreenMode);
      json(200, hub.status()); return;
    }
    if (path === "/api/pc/screen/frame" && method === "GET") {
      const frame = hub.frame();
      if (!frame) { res.writeHead(204, { ...appHeaders(), "Cache-Control": "no-store" }); res.end(); return; }
      res.writeHead(200, { ...appHeaders(), "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Frame-At": new Date(frame.at).toISOString() });
      res.end(frame.buf); return;
    }
    if (path === "/api/pc/screen/video" && method === "GET") {
      // Wait briefly for the PC to start sending, so the codec can be named in the headers.
      const deadline = Date.now() + VIDEO_WAIT_MS;
      let gone = false; res.on("close", () => { gone = true; });
      while (!hub.hasInit() && !gone && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
      if (gone) return;
      if (!hub.hasInit()) { json(503, { error: "The PC isn't sending video yet." }); return; }
      res.writeHead(200, { ...appHeaders(), "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Video-Codec": hub.codec ?? "" });
      if (!hub.addViewer(res)) { res.end(); }
      return;
    }

    // --- Hands side ---
    if (path.startsWith("/api/pc/screen/control") || path.startsWith("/api/pc/screen/ingest/")) {
      if (!config.pcWorkerToken) { json(409, { error: "Hands is not enabled." }); return; }
      if (!fromWorker()) { json(401, { error: "Worker token required." }); return; }
    }
    if (path === "/api/pc/screen/control" && method === "GET") { json(200, { mode: hub.modeNow() }); return; }
    if (path === "/api/pc/screen/ingest/frame" && method === "POST") {
      if (hub.modeNow() !== "screenshots") { json(409, { error: "No one is watching screenshots." }); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req as AsyncIterable<Buffer>) { size += chunk.length; if (size > MAX_FRAME_BYTES) throw new ChatRequestError(413, "Frame too large."); chunks.push(chunk); }
      const frame = Buffer.concat(chunks);
      if (frame.length < 4 || frame[0] !== 0xff || frame[1] !== 0xd8) throw new ChatRequestError(400, "Expected a JPEG.");
      hub.setFrame(frame); json(204, {}); return;
    }
    if (path === "/api/pc/screen/ingest/video" && method === "POST") {
      if (hub.modeNow() !== "video") { json(409, { error: "No one is watching video." }); return; }
      const mine = ++currentIngest, splitter = new Mp4Splitter();
      hub.endVideo();
      try {
        for await (const chunk of req as AsyncIterable<Buffer>) {
          if (mine !== currentIngest || hub.modeNow() !== "video") break; // replaced, or the viewer left
          const pieces = splitter.push(chunk);
          if (pieces.init) hub.setInit(pieces.init);
          for (const fragment of pieces.fragments) hub.fragment(fragment);
        }
      } finally { if (mine === currentIngest) hub.endVideo(); }
      json(204, {}); return;
    }
    json(404, { error: "Not found" });
  } catch (error) {
    if (error instanceof ChatRequestError) { if (!res.headersSent) json(error.status, { error: error.message }); }
    else if (!res.headersSent) json(400, { error: "That video or picture could not be read." });
    else res.end();
  }
}
