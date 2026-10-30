// Wires Jarvis's page together: chat panel, hold-to-talk mic, Kokoro
// voice, face switcher, and the state bus the face performs.
//
// One turn: hold mic (listening) → release, message sent (thinking) →
// answer streams in, each finished sentence is spoken (speaking) → idle.

import { bus, setState } from "./bus.js";
import { streamChat } from "./chatApi.js";
import { SentenceSplitter, speakable } from "./sentences.js";
import { HoldToTalk, speechInSupported } from "./speechIn.js";
import { VoiceOut, type VoiceStatus } from "./voiceOut.js";

// --- Elements and wording (set by the server on the page) ---
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $("app");
const messages = $("messages");
const form = $<HTMLFormElement>("chat-form");
const input = $<HTMLTextAreaElement>("input");
const send = $<HTMLButtonElement>("send");
const mic = $<HTMLButtonElement>("mic");
const status = $("status");
const chat = $("chat");
const face = $<HTMLIFrameElement>("face");
const faceSelect = $<HTMLSelectElement>("face-select");
const engineSelect = $<HTMLSelectElement>("engine-select");
const voiceToggle = $<HTMLButtonElement>("voice-toggle");
const newChat = $<HTMLButtonElement>("new-chat");
const toggleChat = $<HTMLButtonElement>("toggle-chat");
const text = app.dataset as Record<string, string>;

// --- Saved preferences (browser storage may be blocked; never depend on it) ---
function load(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function save(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

type Engine = "claude" | "codex" | "gemini" | "perplexity";
/** The saved engine, if it's still offered on this server; otherwise Claude. */
function pickEngine(value: string | undefined | null): Engine {
  const option = [...engineSelect.options].find(o => o.value === value);
  return option && !option.disabled ? (option.value as Engine) : "claude";
}
let provider: Engine = pickEngine(load("jarvis.engine"));
engineSelect.value = provider;
const sessionKey = () => provider === "claude" ? "jarvis.sessionId" : `jarvis.sessionId.${provider}`;
let sessionId = load(sessionKey());
let busy = false;

// --- Status line ---
let voiceStatusText = "";
function showStatus(message?: string): void {
  status.textContent = message ?? voiceStatusText;
}

// --- Voice ---
const voice = new VoiceOut((s: VoiceStatus) => {
  // A cached model loads without download progress, so 0% just means "loading".
  const loading = s.kind === "loading" ? `${text.voiceLoading}${s.percent > 0 ? ` ${s.percent}%` : "…"}` : "";
  voiceStatusText = s.kind === "failed" ? (text.voiceFailed ?? "") : loading;
  if (bus.state === "idle") showStatus();
});
voice.enabled = load("jarvis.voice") !== "off";
const paintVoice = () => (voiceToggle.textContent = voice.enabled ? (text.voiceOn ?? "") : (text.voiceOff ?? ""));
paintVoice();
if (voice.enabled) voice.load();

// --- Face ---
const savedFace = load("jarvis.face");
if (savedFace && [...faceSelect.options].some((o) => o.value === savedFace)) {
  faceSelect.value = savedFace;
  face.src = `/face/faces/${savedFace}/`;
}
faceSelect.addEventListener("change", () => {
  save("jarvis.face", faceSelect.value);
  face.src = `/face/faces/${faceSelect.value}/`;
});

// --- Messages ---
function addMessage(role: "user" | "jarvis" | "error", body: string): HTMLElement {
  messages.querySelector(".empty")?.remove();
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = body;
  messages.append(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function setBusy(value: boolean): void {
  busy = value;
  send.disabled = value;
  newChat.disabled = value;
  engineSelect.disabled = value;
}

/** Back to idle once both the answer and the speech are finished. */
function finishTurn(): void {
  if (busy || voice.busy) return;
  setState("idle");
  showStatus();
}

// --- One turn ---
async function ask(message: string): Promise<void> {
  voice.unlock();
  voice.stop();
  addMessage("user", message);
  const reply = addMessage("jarvis", "");
  const splitter = new SentenceSplitter();
  let received = "";

  const speakSentences = (sentences: string[]) => {
    for (const sentence of sentences) voice.speak(speakable(sentence), finishTurn);
  };

  setBusy(true);
  setState("thinking");
  showStatus(text.thinking);

  try {
    sessionId = await streamChat(message, sessionId, (piece) => {
      received += piece;
      reply.textContent = received;
      messages.scrollTop = messages.scrollHeight;
      speakSentences(splitter.push(piece));
    }, provider);
    save(sessionKey(), sessionId);
    speakSentences(splitter.flush());
    if (!received) reply.remove();
  } catch (err) {
    if (!received) reply.remove();
    addMessage("error", `${text.errorPrefix} ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setBusy(false);
    finishTurn();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || busy) return;
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

// --- Hold to talk (button, or hold the Home key like local backtalk) ---
const ears = new HoldToTalk((heard) => (input.value = heard));
let holding = false;

function startTalking(): void {
  if (holding || busy) return;
  holding = true;
  voice.unlock();
  voice.stop();
  try {
    ears.start();
  } catch {
    holding = false;
    showStatus(text.micUnsupported);
    return;
  }
  mic.classList.add("active");
  setState("listening");
  showStatus(text.listening);
}

async function stopTalking(): Promise<void> {
  if (!holding) return;
  holding = false;
  mic.classList.remove("active");
  const heard = await ears.finish();
  input.value = "";
  if (heard) {
    void ask(heard);
  } else {
    setState("idle");
    showStatus();
  }
}

if (!speechInSupported()) {
  mic.classList.add("unsupported");
  mic.addEventListener("click", () => showStatus(text.micUnsupported));
} else {
  mic.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    mic.setPointerCapture(event.pointerId);
    startTalking();
  });
  mic.addEventListener("pointerup", () => void stopTalking());
  mic.addEventListener("pointercancel", () => void stopTalking());
  addEventListener("keydown", (event) => {
    if (event.key === "Home" && !event.repeat && document.activeElement !== input) {
      event.preventDefault();
      startTalking();
    }
  });
  addEventListener("keyup", (event) => {
    if (event.key === "Home") void stopTalking();
  });
}

// --- Menu actions ---
voiceToggle.addEventListener("click", () => {
  voice.enabled = !voice.enabled;
  save("jarvis.voice", voice.enabled ? "on" : "off");
  if (voice.enabled) {
    voice.unlock();
    voice.retryKokoro();
  } else {
    voice.stop();
  }
  paintVoice();
});

newChat.addEventListener("click", () => {
  sessionId = undefined;
  save(sessionKey(), undefined);
  voice.stop();
  messages.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = text.empty ?? "";
  messages.append(empty);
  setState("idle");
  input.focus();
});

toggleChat.addEventListener("click", () => {
  const hidden = chat.classList.toggle("hidden");
  toggleChat.textContent = hidden ? (text.showChat ?? "") : (text.hideChat ?? "");
});

engineSelect.addEventListener("change", () => {
  if (busy) return;
  provider = pickEngine(engineSelect.value);
  save("jarvis.engine", provider);
  sessionId = load(sessionKey());
  voice.stop();
  messages.replaceChildren();
  setState("idle");
  showStatus();
  input.focus();
});

// Space (outside the text box) starts the board's cinematic flythrough,
// the same key as on the local face.
addEventListener("keydown", (event) => {
  if (event.code !== "Space" || document.activeElement === input) return;
  event.preventDefault();
  face.contentWindow?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space" }));
});
