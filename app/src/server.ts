// Entry point: starts the HTTP server and shuts it down cleanly when Docker
// stops the container.

import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { handleRequest } from "./routes.ts";

const config = loadConfig();

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const response = handleRequest(req.method ?? "GET", path, config);

  res.writeHead(response.status, {
    "Content-Type": response.contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
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
