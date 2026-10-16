// Maps each request to a response. Kept separate from the server so tests
// can call it directly without opening a port.

import type { AppConfig } from "./config.ts";
import { content } from "./content.ts";
import { renderDashboardPage } from './views/dashboardPage.ts';
import { renderHomePage } from "./views/homePage.ts";

export interface AppResponse {
  status: number;
  contentType: string;
  body: string;
}

/** Returns the response for a method + path. */
export function handleRequest(method: string, path: string, config: AppConfig): AppResponse {
  if (method !== "GET" && method !== "HEAD") {
    return { status: 405, contentType: "text/plain; charset=utf-8", body: "Method not allowed" };
  }

  // Health check for Docker and the deploy pipeline.
  if (path === "/healthz") {
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", env: config.env, version: config.version }),
    };
  }

  if (path === "/") {
    return { status: 200, contentType: "text/html; charset=utf-8", body: renderDashboardPage(config) };
  }

  if (path === '/face-mode') return { status: 200, contentType: 'text/html; charset=utf-8', body: renderHomePage(config) };

  return { status: 404, contentType: "text/plain; charset=utf-8", body: content.notFound };
}
