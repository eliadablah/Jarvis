// Browser side of the Jarvis chat: sends the message, reads the streamed
// answer line by line, and remembers the conversation ID so follow-up
// questions continue the same conversation. Compiled to dist/public/chat.js.

type ChatEvent =
  | { type: "text"; text: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; message: string };

const SESSION_KEY = "jarvis.sessionId";

// --- Elements and wording (set by the server on the page) ---
const app = document.getElementById("app") as HTMLElement;
const messages = document.getElementById("messages") as HTMLElement;
const form = document.getElementById("chat-form") as HTMLFormElement;
const input = document.getElementById("input") as HTMLTextAreaElement;
const send = document.getElementById("send") as HTMLButtonElement;
const newChat = document.getElementById("new-chat") as HTMLButtonElement;

const text = {
  thinking: app.dataset.thinking ?? "",
  errorPrefix: app.dataset.errorPrefix ?? "",
  empty: app.dataset.empty ?? "",
};

// --- Session ID: browser storage can be unavailable, so never depend on it ---
function loadSession(): string | undefined {
  try {
    return localStorage.getItem(SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveSession(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked: the conversation just won't survive a reload.
  }
}

let sessionId = loadSession();

// --- Rendering ---
function addMessage(role: "user" | "jarvis" | "error", body: string): HTMLElement {
  messages.querySelector(".empty")?.remove();
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = body;
  messages.append(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function resetChat(): void {
  sessionId = undefined;
  saveSession(undefined);
  messages.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text.empty;
  messages.append(empty);
  input.focus();
}

function setBusy(busy: boolean): void {
  send.disabled = busy;
  newChat.disabled = busy;
}

// --- Sending and streaming ---
async function ask(message: string): Promise<void> {
  addMessage("user", message);
  const reply = addMessage("jarvis", text.thinking);
  let received = "";
  setBusy(true);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Jarvis-Chat": "1" },
      body: JSON.stringify({ message, sessionId }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((detail as { error?: string }).error ?? res.statusText);
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as ChatEvent;
        if (event.type === "text") {
          received += event.text;
          reply.textContent = received;
          messages.scrollTop = messages.scrollHeight;
        } else if (event.type === "done") {
          sessionId = event.sessionId || sessionId;
          saveSession(sessionId);
        } else {
          throw new Error(event.message);
        }
      }
    }

    if (!received) reply.remove();
  } catch (err) {
    if (!received) reply.remove();
    addMessage("error", `${text.errorPrefix} ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBusy(false);
    input.focus();
  }
}

// --- Events ---
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || send.disabled) return;
  input.value = "";
  void ask(message);
});

// Enter sends; Shift+Enter adds a new line.
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

newChat.addEventListener("click", resetChat);
