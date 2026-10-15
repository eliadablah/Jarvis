// Entry point: starts the HTTP server and shuts it down cleanly when Docker
// stops the container. POST /api/chat streams answers from Claude Code;
// everything else is a simple page or file.

import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { handleRequest } from "./routes.ts";
import { handleChat } from "./api/chatHandler.ts";
import { getStaticFile } from "./staticFiles.ts";

const config = loadConfig();

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;

  // --- Chat API ---
  if (path === "/api/chat" && req.method === "POST") {
    handleChat(req, res, config).catch((err) => {
      console.error("chat handler crashed:", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }

  // --- Browser script ---
  const file = req.method === "GET" ? getStaticFile(path) : undefined;
  if (file) {
    res.writeHead(200, { ...securityHeaders, "Content-Type": file.contentType, "Cache-Control": "no-cache" });
    res.end(file.body);
    return;
  }

  // --- Pages and health check ---
  const response = handleRequest(req.method ?? "GET", path, config);
  res.writeHead(response.status, {
    ...securityHeaders,
    "Content-Type": response.contentType,
    "Cache-Control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : response.body);
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
