// Checks and parses a chat request before anything reaches Claude Code.
//
// The site is only reachable on my tailnet, but my browser still visits
// other websites, and one of them could try to post to Jarvis from inside my
// browser. Requiring a custom header plus a JSON body forces the browser to
// ask permission first (a CORS preflight), which this server never grants,
// and a mismatched Origin is refused outright.

import type { IncomingMessage } from "node:http";
import type { ChatProvider } from "../brain/events.ts";

export const MAX_MESSAGE_CHARS = 8000;
const MAX_BODY_BYTES = 32 * 1024;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CHAT_HEADER = "x-jarvis-chat";

export interface ChatRequest {
  message: string;
  sessionId: string | undefined;
  provider?: ChatProvider | "auto";
  /** Provider session IDs must never be resumed with the other engine. */
  sessions?: Partial<Record<ChatProvider, string>>;
  /** Internal server reference data. Never parsed from the client body. */
  serverContext?: string;
}

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** True for a Claude Code session ID (a UUID), so it can't smuggle in a flag. */
export function isValidSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

/** Refuses requests that didn't come from Jarvis's own page. */
export function checkRequestSource(headers: IncomingMessage["headers"]): void {
  if (headers[CHAT_HEADER] !== "1") {
    throw new ChatRequestError(403, "Missing chat header.");
  }
  if (!headers["content-type"]?.startsWith("application/json")) {
    throw new ChatRequestError(415, "Expected JSON.");
  }
  const origin = headers.origin;
  const host = headers.host;
  if (origin && host && origin !== `https://${host}` && origin !== `http://${host}`) {
    throw new ChatRequestError(403, "Wrong origin.");
  }
}

/** Reads the request body, refusing anything too large. */
export async function readBody(req: AsyncIterable<Buffer>): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ChatRequestError(413, "Message too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Validates the JSON body: a non-empty message and an optional session ID. */
export function parseChatRequest(body: string): ChatRequest {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new ChatRequestError(400, "Body is not valid JSON.");
  }
  if (typeof data !== "object" || data === null) {
    throw new ChatRequestError(400, "Body must be an object.");
  }

  const { message, sessionId, provider, sessions } = data as Record<string, unknown>;

  if (provider !== undefined && provider !== "auto" && provider !== "claude" && provider !== "codex") throw new ChatRequestError(400, "Invalid chat engine.");
  if (typeof message !== "string" || !message.trim()) {
    throw new ChatRequestError(400, "Message is required.");
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new ChatRequestError(413, `Message is over ${MAX_MESSAGE_CHARS} characters.`);
  }
  if (sessionId !== undefined && sessionId !== null) {
    if (typeof sessionId !== "string" || !isValidSessionId(sessionId)) {
      throw new ChatRequestError(400, "Invalid session ID.");
    }
    if (provider === "auto") throw new ChatRequestError(400, "Use provider sessions with automatic routing.");
  }

  let checkedSessions: Partial<Record<ChatProvider, string>> | undefined;
  if (sessions !== undefined) {
    if (typeof sessions !== "object" || sessions === null || Array.isArray(sessions)) {
      throw new ChatRequestError(400, "Invalid provider sessions.");
    }
    checkedSessions = {};
    for (const [engine, id] of Object.entries(sessions)) {
      if (engine !== "claude" && engine !== "codex") throw new ChatRequestError(400, "Invalid provider session engine.");
      if (id !== undefined && id !== null) {
        if (typeof id !== "string" || !isValidSessionId(id)) throw new ChatRequestError(400, "Invalid provider session ID.");
        checkedSessions[engine] = id;
      }
    }
  }

  return { message: message.trim(), sessionId: typeof sessionId === "string" ? sessionId : undefined,
    ...(provider ? {provider} : {}), ...(checkedSessions ? {sessions: checkedSessions} : {}) };
}
