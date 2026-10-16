// Entry point: starts the HTTP server and shuts it down cleanly when Docker
// stops the container.
//   POST /api/chat   streams answers from Claude Code
//   /face/...        the ai-visualizer faces, fed by Jarvis's state
//   /...             Jarvis's own page, scripts, and voice engine files

import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { handleRequest } from "./routes.ts";
import { handleChat } from "./api/chatHandler.ts";
import { FACE_PREFIX, serveFace } from "./face/visualizer.ts";
import { servePublic } from "./http/publicFiles.ts";
import { appHeaders } from "./http/securityHeaders.ts";

import { handleDashboard } from './dashboard.ts';

const config = loadConfig();

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const method = req.method ?? "GET";

  if (path.startsWith('/api/dashboard')) {
    handleDashboard(req, res, path, config).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
    return;
  }

  // --- Chat API ---
  if (path === "/api/chat" && method === "POST") {
    handleChat(req, res, config).catch((err) => {
      console.error("chat handler crashed:", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }

  // --- Files: faces and Jarvis's own browser files ---
  if (method === "GET" || method === "HEAD") {
    if (path.startsWith(FACE_PREFIX) && serveFace(res, path, method, config.visualizerDir)) return;
    if (servePublic(res, path, method)) return;
  }

  // --- Pages and health check ---
  const response = handleRequest(method, path, config);
  res.writeHead(response.status, {
    ...appHeaders(),
    "Content-Type": response.contentType,
    "Cache-Control": "no-store",
  });
  res.end(method === "HEAD" ? undefined : response.body);
});

server.listen(config.port, () => {
  console.log(`jarvis-web listening on :${config.port} (env=${config.env}, version=${config.version})`);
});

// --- Graceful shutdown: finish in-flight requests, then exit ---
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`jarvis-web received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}
