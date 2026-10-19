// Live usage limits for Claude and Codex.
//
// The PC worker reads each provider's 5-hour and weekly usage (Claude reports it
// in every stream; Codex writes it to its session logs) and Jarvis keeps the
// latest reading. This file turns a reading into small bars with reset times,
// and says how old the reading is. A window whose reset time has passed shows
// as reset (0%), because the old number no longer applies.

const NAMES = { claude: 'Claude', codex: 'Codex' };

function clock(epochSeconds, now) {
  const date = new Date(epochSeconds * 1000);
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return date.toDateString() === new Date(now).toDateString() ? time : date.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
}

/** One window to { percent, tone, text }. Returns undefined when there is no reading. */
export function windowView(win, now = Date.now()) {
  if (!win) return undefined;
  const rolled = win.resetsAt * 1000 <= now;
  const percent = rolled ? 0 : Math.max(0, Math.min(100, Math.round(win.usedPercent)));
  const tone = percent >= 90 ? 'high' : percent >= 70 ? 'mid' : 'low';
  return { percent, tone, text: rolled ? 'reset' : percent + '% used · resets ' + clock(win.resetsAt, now) };
}

/** "as of 3m ago" once a reading is a few minutes old; empty when fresh. */
export function ageLabel(updatedAt, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(updatedAt)) / 60000));
  if (!Number.isFinite(minutes) || minutes < 3) return '';
  return 'as of ' + (minutes < 60 ? minutes + 'm' : minutes < 1440 ? Math.round(minutes / 60) + 'h' : Math.round(minutes / 1440) + 'd') + ' ago';
}

/** A provider's reading to the rows to draw. */
export function limitView(provider, reading, now = Date.now()) {
  const rows = [['5-hour', windowView(reading?.fiveHour, now)], ['Week', windowView(reading?.week, now)]]
    .filter(([, view]) => view).map(([label, view]) => ({ label, ...view }));
  return { name: NAMES[provider] ?? provider, rows, age: reading ? ageLabel(reading.updatedAt, now) : '' };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Draws both providers into a container. Everything is inserted with textContent. */
export function renderLimits(container, limits, now = Date.now()) {
  if (!container) return;
  const blocks = [];
  for (const provider of ['claude', 'codex']) {
    const view = limitView(provider, limits?.[provider], now);
    const block = el('div', 'limit-block');
    const head = el('div', 'limit-head');
    head.append(el('strong', '', view.name), el('small', '', view.rows.length ? view.age : 'no reading yet'));
    block.append(head);
    for (const row of view.rows) {
      const line = el('div', 'limit-row');
      const bar = el('div', 'limit-bar');
      bar.dataset.tone = row.tone;
      const fill = el('i');
      fill.style.width = row.percent + '%'; // set as a style property, which the page's content policy allows
      bar.append(fill);
      line.append(el('span', 'limit-label', row.label), bar, el('span', 'limit-text', row.text));
      block.append(line);
    }
    blocks.push(block);
  }
  container.replaceChildren(...blocks);
}
