// Talks to POST /api/chat and reads the streamed answer line by line.

type ChatEvent =
  | { type: "text"; text: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; message: string };

/**
 * Sends a message and calls onText for each piece of the answer as it
 * arrives. Resolves with the conversation's session ID; throws on errors.
 */
export async function streamChat(
  message: string,
  sessionId: string | undefined,
  onText: (text: string) => void,
): Promise<string | undefined> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Jarvis-Chat": "1" },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!res.ok || !res.body) {
    const detail = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(detail.error ?? res.statusText);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finalSession = sessionId;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as ChatEvent;
      if (event.type === "text") onText(event.text);
      else if (event.type === "done") finalSession = event.sessionId || finalSession;
      else throw new Error(event.message);
    }
  }
  return finalSession;
}
