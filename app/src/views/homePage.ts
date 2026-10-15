// HTML for the home page. Plain server-rendered HTML with inline CSS, so the
// app has no runtime dependencies and nothing to load from the internet.

import type { AppConfig } from "../config.ts";
import { content } from "../content.ts";

/** Escapes text before it goes into HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Renders the home page for the given environment and version. */
export function renderHomePage(config: AppConfig): string {
  const envLabel = escapeHtml(content.envLabels[config.env]);
  const version = escapeHtml(config.version);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(content.title)} (${envLabel})</title>
  <style>
    :root { color-scheme: light dark; --bg: #f5f6f8; --fg: #14171c; --muted: #5b6270; --accent: #0a7c5a; --card: #ffffff; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0e1116; --fg: #e8eaee; --muted: #9aa1ad; --accent: #3ccf98; --card: #171b22; } }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
    main { width: 100%; max-width: 480px; background: var(--card); border-radius: 16px; padding: 32px 24px; box-shadow: 0 2px 16px rgb(0 0 0 / 0.08); }
    h1 { margin: 0 0 4px; font-size: 2rem; }
    .status { margin: 0 0 16px; color: var(--accent); font-weight: 600; }
    .status::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 8px; border-radius: 50%; background: var(--accent); }
    p { margin: 0 0 24px; color: var(--muted); }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0; font-size: 0.9rem; }
    dt { color: var(--muted); }
    dd { margin: 0; font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(content.title)}</h1>
    <p class="status">${escapeHtml(content.status)}</p>
    <p>${escapeHtml(content.intro)}</p>
    <dl>
      <dt>${escapeHtml(content.envLabel)}</dt><dd>${envLabel}</dd>
      <dt>${escapeHtml(content.versionLabel)}</dt><dd>${version}</dd>
    </dl>
  </main>
</body>
</html>
`;
}
