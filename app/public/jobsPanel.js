// Job search section: shows my real application pipeline, read live from the
// Google Sheets tracker through GET /api/jobs.
//
// Fills the numbers in the existing "pipeline" strip, adds a list of recent
// applications under it, and refreshes every two minutes and whenever the tab
// becomes visible again. Everything from the sheet is inserted with
// textContent, never as HTML. If the tracker isn't connected the card keeps
// its original "Tracker not connected" text.

const REFRESH_MS = 2 * 60_000;
const PREVIEW_ROWS = 6;

const STAGE_CLASS = {
  submitted: 'ok', 'ready for approval': 'info', 'needs code': 'warn', 'needs answer': 'warn', 'needs you': 'warn',
  'recruiter contact': 'good', 'interview scheduled': 'good', interviewed: 'good', offer: 'good', rejected: 'muted', closed: 'muted',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortDate(iso) {
  const [, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) ?? [];
  return month ? `${Number(month)}/${Number(day)}` : '';
}

function step(value, label) {
  const box = el('div', 'pipeline-step');
  box.append(el('strong', '', String(value)), el('span', '', label));
  return box;
}

function row(job) {
  const item = el('div', 'job-row');
  const main = el('div', 'job-main');
  const title = job.url ? el('a', 'job-title', job.company) : el('span', 'job-title', job.company);
  if (job.url) { title.href = job.url; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
  main.append(title, el('small', '', [job.role, job.pay].filter(Boolean).join(' · ')));
  if (job.nextStep && /needs|apply yourself|send|fill/i.test(job.nextStep + job.stage)) main.append(el('small', 'job-next', job.nextStep));
  const side = el('div', 'job-side');
  side.append(el('span', `stage-pill ${STAGE_CLASS[job.stage.toLowerCase()] ?? 'muted'}`, job.stage || '—'), el('small', '', shortDate(job.applied)));
  item.append(main, side);
  return item;
}

export function startJobsPanel() {
  const section = document.querySelector('[data-section="jobs"]');
  const pipeline = section?.querySelector('.pipeline');
  if (!section || !pipeline) return;

  const tag = section.querySelector('.tag');
  const list = el('div', 'job-list');
  pipeline.after(list);
  let expanded = false;
  let data;

  function render() {
    list.replaceChildren();
    if (!data?.enabled) return;
    if (data.error && !data.jobs) {
      list.append(el('p', 'job-note', data.error));
      return;
    }
    const s = data.summary;
    pipeline.replaceChildren(step(s.submitted, 'Applied'), step(s.needsYou, 'Need you'), step(s.responses, 'Responses'), step(s.last7Days, 'Last 7 days'));
    if (tag) tag.textContent = 'Live from your tracker';

    const head = el('div', 'job-list-head');
    const updated = new Date(data.updatedAt);
    head.append(el('small', '', `${s.total} tracked · ${s.today} today${data.stale ? ' · showing saved copy' : ''} · updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`));
    if (data.sheetUrl) {
      const open = el('a', 'job-sheet-link', 'Open tracker ↗');
      open.href = data.sheetUrl; open.target = '_blank'; open.rel = 'noopener noreferrer';
      head.append(open);
    }
    list.append(head);
    (expanded ? data.jobs : data.jobs.slice(0, PREVIEW_ROWS)).forEach(job => list.append(row(job)));
    if (data.jobs.length > PREVIEW_ROWS) {
      const toggle = el('button', 'text-btn job-toggle', expanded ? 'Show fewer' : `Show all ${data.jobs.length}`);
      toggle.type = 'button';
      toggle.onclick = () => { expanded = !expanded; render(); };
      list.append(toggle);
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/jobs', { cache: 'no-store' });
      if (!res.ok) return;
      data = await res.json();
      render();
    } catch { /* offline: keep what is showing */ }
  }

  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
