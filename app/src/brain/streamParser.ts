// Turns Claude Code's `--output-format stream-json` lines into the few
// things the chat cares about. Pure functions, so they're easy to test.
//
// Claude Code prints one JSON object per line. The ones used here:
//   {"type":"system","subtype":"init","session_id":"..."}       first line
//   {"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hi"}}}
//   {"type":"result","is_error":false,"result":"full text","session_id":"..."}

export type StreamLine =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "result"; isError: boolean; text: string; sessionId: string | undefined }
  | { kind: "ignore" };

/** Reads a string field from an unknown object, or undefined. */
function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

/** Reads a nested object field from an unknown object, or undefined. */
function objectField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** Classifies one line of Claude Code output. Bad JSON is ignored. */
export function parseStreamLine(line: string): StreamLine {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { kind: "ignore" };
  }

  const type = stringField(data, "type");

  if (type === "system" && stringField(data, "subtype") === "init") {
    const sessionId = stringField(data, "session_id");
    return sessionId ? { kind: "session", sessionId } : { kind: "ignore" };
  }

  if (type === "stream_event") {
    const delta = objectField(objectField(data, "event"), "delta");
    if (stringField(delta, "type") === "text_delta") {
      const text = stringField(delta, "text");
      if (text) return { kind: "text", text };
    }
    return { kind: "ignore" };
  }

  if (type === "result") {
    const isError = objectField(data, "is_error") === true || stringField(data, "subtype") !== "success";
    return {
      kind: "result",
      isError,
      text: stringField(data, "result") ?? "",
      sessionId: stringField(data, "session_id"),
    };
  }

  return { kind: "ignore" };
}

/** Splits a growing buffer into complete lines, returning the leftover. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}
