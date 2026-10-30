// HTML for Jarvis's page: the ai-visualizer face fills the screen (in a
// frame, fed by Jarvis's live state), with the chat, mic, and menu
// floating on top. The browser script (client/main.ts, served as
// /main.js) does the talking, listening, and speaking; this file only lays
// out the page and hands the script its wording through data attributes.

import type { AppConfig } from "../config.ts";
import { content } from "../content.ts";
import { FACES } from "../face/visualizer.ts";

/** Escapes text before it goes into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** All page wording the browser script needs, as data-* attributes. */
function dataAttributes(): string {
  const strings: Record<string, string> = {
    listening: content.listening,
    thinking: content.thinking,
    empty: content.emptyState,
    errorPrefix: content.errorPrefix,
    micUnsupported: content.micUnsupported,
    voiceOn: content.voiceOnLabel,
    voiceOff: content.voiceOffLabel,
    hideChat: content.hideChatLabel,
    showChat: content.showChatLabel,
    voiceLoading: content.voiceLoading,
    voiceReady: content.voiceReady,
    voiceFailed: content.voiceFailed,
  };
  return Object.entries(strings)
    .map(([key, value]) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${escapeHtml(value)}"`)
    .join("\n       ");
}

/** Renders the page for the given environment and version. */
export function renderHomePage(config: AppConfig): string {
  const envLabel = escapeHtml(content.envLabels[config.env]);
  const version = escapeHtml(config.version);
  const faceOptions = FACES.map((face) => `<option value="${face}">${escapeHtml(content.faceNames[face])}</option>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
  <meta name="theme-color" content="#020705">
  <title>${escapeHtml(content.title)} (${envLabel})</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <iframe id="face" src="/face/faces/board/" title="${escapeHtml(content.title)}" tabindex="-1" aria-hidden="true"></iframe>

  <div class="overlay" id="app"
       ${dataAttributes()}>
    <header class="topbar">
      <button type="button" id="toggle-chat" class="ghost">${escapeHtml(content.hideChatLabel)}</button>
      <details class="menu">
        <summary class="ghost">${escapeHtml(content.menuLabel)}</summary>
        <div class="menu-panel">
          <label>${escapeHtml(content.faceLabel)}
            <select id="face-select">${faceOptions}</select>
          </label>
          <label>${escapeHtml(content.engineLabel)}
            <select id="engine-select">
              <option value="claude">${escapeHtml(content.claudeLabel)}</option>
              <option value="codex"${config.codex?.enabled ? "" : " disabled"}>${escapeHtml(content.codexLabel)}</option>
              <option value="gemini"${config.gemini?.enabled ? "" : " disabled"}>${escapeHtml(content.geminiLabel)}</option>
              <option value="perplexity"${config.perplexity?.enabled ? "" : " disabled"}>${escapeHtml(content.perplexityLabel)}</option>
            </select>
          </label>
          <button type="button" id="voice-toggle">${escapeHtml(content.voiceOnLabel)}</button>
          <button type="button" id="new-chat">${escapeHtml(content.newChatLabel)}</button>
          <p class="meta">${envLabel} · ${escapeHtml(content.versionLabel)} ${version}</p>
          <p class="credit">${escapeHtml(content.credit)}
            <a href="https://github.com/eliadablah/Jarvis" rel="noopener" target="_blank">${escapeHtml(content.sourceLabel)}</a></p>
        </div>
      </details>
    </header>

    <section class="chat" id="chat">
      <div id="messages" aria-live="polite">
        <p class="empty">${escapeHtml(content.emptyState)}</p>
      </div>
      <p id="status" class="status" aria-live="polite"></p>
      <form id="chat-form">
        <button type="button" id="mic" class="mic" aria-label="${escapeHtml(content.micLabel)}" title="${escapeHtml(content.micLabel)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>
        </button>
        <textarea id="input" rows="1" placeholder="${escapeHtml(content.inputPlaceholder)}" aria-label="${escapeHtml(content.inputPlaceholder)}"></textarea>
        <button type="submit" id="send">${escapeHtml(content.sendLabel)}</button>
      </form>
    </section>
    <noscript><p class="empty">${escapeHtml(content.noScript)}</p></noscript>
  </div>
  <script src="/main.js" type="module"></script>
</body>
</html>
`;
}
