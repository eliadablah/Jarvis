// HTML for the chat page. The server renders the layout and passes the
// wording to the browser script through data attributes; the script
// (client/chat.ts, served as /chat.js) handles sending and streaming.

import type { AppConfig } from "../config.ts";
import { content } from "../content.ts";

/** Escapes text before it goes into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Renders the chat page for the given environment and version. */
export function renderHomePage(config: AppConfig): string {
  const envLabel = escapeHtml(content.envLabels[config.env]);
  const version = escapeHtml(config.version);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">
  <title>${escapeHtml(content.title)} (${envLabel})</title>
  <style>
    :root { color-scheme: light dark; --bg: #f5f6f8; --fg: #14171c; --muted: #5b6270; --accent: #0a7c5a; --card: #ffffff; --line: #e2e5ea; --mine: #0a7c5a; --mine-fg: #ffffff; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0e1116; --fg: #e8eaee; --muted: #9aa1ad; --accent: #3ccf98; --card: #171b22; --line: #262c36; --mine: #1f6f55; --mine-fg: #f2fff9; } }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
    .app { display: flex; flex-direction: column; height: 100dvh; max-width: 720px; margin: 0 auto; }
    header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
    header h1 { margin: 0; font-size: 1.25rem; }
    .status { margin: 0; color: var(--accent); font-size: 0.85rem; font-weight: 600; }
    .meta { margin-left: auto; text-align: right; color: var(--muted); font-size: 0.75rem; font-family: ui-monospace, monospace; }
    button { font: inherit; cursor: pointer; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--fg); padding: 8px 14px; }
    button:disabled { opacity: 0.5; cursor: default; }
    #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .msg { max-width: 85%; padding: 10px 14px; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .msg.user { align-self: flex-end; background: var(--mine); color: var(--mine-fg); }
    .msg.jarvis { align-self: flex-start; background: var(--card); border: 1px solid var(--line); }
    .msg.error { align-self: flex-start; color: #c0392b; background: transparent; padding: 0 4px; }
    .empty { margin: auto; color: var(--muted); text-align: center; }
    form { display: flex; gap: 8px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); }
    textarea { flex: 1; resize: none; font: inherit; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--fg); max-height: 160px; }
    #send { background: var(--accent); color: #fff; border-color: transparent; font-weight: 600; }
  </style>
</head>
<body>
  <div class="app" id="app"
       data-thinking="${escapeHtml(content.thinking)}"
       data-error-prefix="${escapeHtml(content.errorPrefix)}"
       data-empty="${escapeHtml(content.emptyState)}">
    <header>
      <div>
        <h1>${escapeHtml(content.title)}</h1>
        <p class="status">${escapeHtml(content.status)}</p>
      </div>
      <div class="meta">${envLabel}<br>${escapeHtml(content.versionLabel)} ${version}</div>
      <button type="button" id="new-chat">${escapeHtml(content.newChatLabel)}</button>
    </header>
    <main id="messages" aria-live="polite">
      <p class="empty">${escapeHtml(content.emptyState)}</p>
    </main>
    <noscript><p class="empty">${escapeHtml(content.noScript)}</p></noscript>
    <form id="chat-form">
      <textarea id="input" rows="1" placeholder="${escapeHtml(content.inputPlaceholder)}" aria-label="${escapeHtml(content.inputPlaceholder)}"></textarea>
      <button type="submit" id="send">${escapeHtml(content.sendLabel)}</button>
    </form>
  </div>
  <script src="/chat.js" type="module"></script>
</body>
</html>
`;
}
