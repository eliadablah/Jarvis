// Runs Claude Code headless for one chat message and streams the answer.
//
// Safety for this first version:
//   --tools ""                  no built-in tools at all (no files, no shell)
//   --disallowedTools mcp__*    no MCP tools either
//   --permission-mode dontAsk   anything not explicitly allowed is denied
//   --permission-prompts none   nobody is there to answer a prompt
// The message goes in on stdin, never as a command-line argument, so text
// that looks like a flag ("--help") is just text.

import { spawn } from "node:child_process";
import type { ClaudeConfig } from "../config.ts";
import type { ChatEvent } from "./events.ts";
import { parseStreamLine, splitLines } from "./streamParser.ts";

/** Builds the Claude Code command-line arguments for one message. */
export function buildClaudeArgs(config: ClaudeConfig, sessionId: string | undefined): string[] {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model", config.model,
    "--tools", "",
    "--disallowedTools", "mcp__*",
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--append-system-prompt-file", config.personaPath,
  ];
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

/**
 * Sends one message to Claude Code and yields chat events as they arrive:
 * text pieces, then exactly one "done" or "error".
 */
export async function* askClaude(
  config: ClaudeConfig,
  message: string,
  sessionId: string | undefined,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const child = spawn(config.bin, buildClaudeArgs(config, sessionId), {
    cwd: config.workDir,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  // --- Stop the process on timeout or when the browser disconnects ---
  const stop = () => child.kill("SIGTERM");
  const timer = setTimeout(stop, config.timeoutMs);
  signal.addEventListener("abort", stop, { once: true });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000);
  });

  const exited = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });

  child.stdin.end(message);
  child.stdout.setEncoding("utf8");

  let buffer = "";
  let currentSession = sessionId;
  let streamedAnyText = false;
  let finished = false;

  try {
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      const { lines, rest } = splitLines(buffer + chunk);
      buffer = rest;

      for (const line of lines) {
        const parsed = parseStreamLine(line);

        if (parsed.kind === "session") {
          currentSession = parsed.sessionId;
        } else if (parsed.kind === "text") {
          streamedAnyText = true;
          yield { type: "text", text: parsed.text };
        } else if (parsed.kind === "result") {
          currentSession = parsed.sessionId ?? currentSession;
          finished = true;
          if (parsed.isError) {
            yield { type: "error", message: parsed.text || "Claude Code reported an error." };
          } else {
            // Older Claude Code versions may skip partial events.
            if (!streamedAnyText && parsed.text) yield { type: "text", text: parsed.text };
            yield { type: "done", sessionId: currentSession ?? "" };
          }
        }
      }
    }

    const code = await exited;
    if (!finished) {
      const reason = signal.aborted ? "Request cancelled." : stderr.trim() || `Claude Code exited with code ${code}.`;
      yield { type: "error", message: reason };
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}
