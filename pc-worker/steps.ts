// Two small, testable helpers for the PC worker.
//
// describeStep(): turns one line of an agent's event stream (Claude Code
// stream-json or Codex --json) into a short plain sentence for the dashboard,
// like "Opening linkedin.com" or "Clicking". It never includes typed text,
// commands, file contents or full URLs, only the kind of step and a hostname.
//
// isStartupCrash(): recognizes a process that Windows killed right after it
// started (access violation and similar). On this PC code injected into new
// processes crashes some of them at random. Before the agent has run any
// tool or produced any result, retrying is safe because nothing can have
// happened yet.

const WORDS: Record<string, string> = {
  // Claude in Chrome tools
  read_page: "Reading the page", get_page_text: "Reading the page", find: "Looking for an element",
  form_input: "Filling in a field", tabs_create_mcp: "Opening a new tab", tabs_context_mcp: "Checking open tabs",
  tabs_close_mcp: "Closing a tab", file_upload: "Uploading a file", upload_image: "Uploading an image",
  javascript_tool: "Inspecting the page", read_console_messages: "Checking the page", read_network_requests: "Checking the page",
  browser_batch: "Running several browser steps", resize_window: "Resizing the window", switch_browser: "Switching browser",
  // Windows desktop tools
  snapshot: "Looking at the screen", screenshot: "Looking at the screen", click: "Clicking", type: "Typing",
  scroll: "Scrolling", shortcut: "Pressing a shortcut", app: "Opening or switching an app", powershell: "Running a PowerShell step",
  wait: "Waiting", move: "Moving the mouse", scrape: "Reading the screen", clipboard: "Using the clipboard",
  // Built-in tools
  read: "Reading a file", write: "Writing a file", edit: "Editing a file", glob: "Searching files", grep: "Searching files",
  bash: "Running a command", webfetch: "Reading a web page", websearch: "Searching the web", skill: "Using a skill",
};

const COMPUTER_ACTIONS: Record<string, string> = {
  screenshot: "Looking at the page", left_click: "Clicking", double_click: "Clicking", triple_click: "Clicking", right_click: "Right-clicking",
  type: "Typing", key: "Pressing a key", scroll: "Scrolling", scroll_to: "Scrolling to an element", wait: "Waiting", zoom: "Zooming in",
  hover: "Hovering", left_click_drag: "Dragging",
};

const clip = (text: string, max = 140): string => text.replace(/\s+/g, " ").trim().slice(0, max);

function hostOf(url: unknown): string | undefined {
  if (typeof url !== "string") return;
  try { return new URL(/^[a-z]+:/i.test(url) ? url : "https://" + url).hostname.replace(/^www\./, ""); } catch { return; }
}

/** One tool call to a sentence. The name may be prefixed (mcp__server__tool). */
export function describeTool(name: unknown, input?: unknown): string {
  const tail = String(name ?? "").split("__").pop()!.toLowerCase();
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (tail === "navigate") {
    if (args.url === "back") return "Going back";
    if (args.url === "forward") return "Going forward";
    const host = hostOf(args.url);
    return host ? "Opening " + host : "Opening a page";
  }
  if (tail === "computer") return COMPUTER_ACTIONS[String(args.action)] ?? "Working in the browser";
  return WORDS[tail] ?? (tail ? "Using " + tail.replace(/_/g, " ") : "Working");
}

/** One parsed stream event to a live step, or undefined when it says nothing useful. */
export function describeStep(event: unknown): string | undefined {
  const e = event as { type?: string; message?: { content?: unknown }; item?: Record<string, unknown> } | null;
  if (!e || typeof e !== "object") return;
  // Claude Code: the assistant message holds tool calls and short narration.
  if (e.type === "assistant" && Array.isArray(e.message?.content)) {
    const blocks = e.message!.content as { type?: string; name?: string; input?: unknown; text?: string }[];
    const tool = blocks.find(b => b?.type === "tool_use");
    if (tool) return describeTool(tool.name, tool.input);
    const text = blocks.find(b => b?.type === "text" && typeof b.text === "string" && b.text.trim());
    return text ? clip(text.text!) : undefined;
  }
  // Codex: items start and finish; only starts are announced.
  if (e.type === "item.started" && e.item) {
    switch (e.item.type) {
      case "mcp_tool_call": return describeTool(e.item.tool, e.item.arguments);
      case "command_execution": return "Running a command";
      case "file_change": return "Editing files";
      case "web_search": return "Searching the web";
      default: return;
    }
  }
  return;
}

const CRASH_CODES = new Set([
  0xC0000005, // access violation
  0xC0000142, // DLL initialization failed
  0xC0000135, // DLL not found at startup
  0xC0000409, // stack buffer overrun / fail-fast
]);

/** True when the process died to a Windows crash code before doing anything. */
export function isStartupCrash(exitCode: number | null | undefined, state: { touchedTools: boolean; hasResult: boolean; elapsedMs: number }): boolean {
  if (exitCode === null || exitCode === undefined || state.touchedTools || state.hasResult || state.elapsedMs > 30_000) return false;
  return CRASH_CODES.has(exitCode >>> 0);
}
