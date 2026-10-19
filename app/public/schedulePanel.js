import { formatClock, relativeDay } from "./localTime.js";
// "On your radar" schedule row: shows Jarvis's own morning job run (from
// GET /api/schedules) in place of the old "existing Claude schedule" text:
// when it runs next, what happened last time, and a Pause / Resume button.
// Values from the server are inserted with textContent, never as HTML.

const REFRESH_MS = 60_000;
const STATUS = {
  queued: 'Queued', running: 'Running now', cancelling: 'Stopping', completed: 'Completed', partial: 'Partly completed',
  needs_input: 'Needs you', needs_attention: 'Connection lost', failed: 'Failed', cancelled: 'Cancelled',
};

/** "Tue 7:00 AM" for the next run, in the viewer's own clock. */
export function whenLabel(iso, now = new Date()) {
  const date = new Date(iso);
  return relativeDay(date, now) + ' ' + formatClock(date);
}

function ago(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return minutes < 60 ? minutes + 'm ago' : minutes < 1440 ? Math.round(minutes / 60) + 'h ago' : Math.round(minutes / 1440) + 'd ago';
}

/** The "Last run" sentence, or a plain note before the first run. */
export function lastLabel(last) {
  if (!last) return 'no run yet';
  const parts = [STATUS[last.status] ?? last.status];
  if (typeof last.submitted === 'number' && ['completed', 'partial', 'needs_input'].includes(last.status)) parts.push(last.submitted + ' submitted');
  parts.push(ago(last.finishedAt || last.createdAt));
  return parts.join(' · ');
}

export function startSchedulePanel() {
  const title = [...document.querySelectorAll('.schedule-row .schedule-title')].find(n => /Daily job preparation|Morning job run/.test(n.textContent));
  const row = title?.closest('.schedule-row');
  if (!row) return;
  const meta = row.querySelector('.schedule-meta');
  const timeCell = row.querySelector('.schedule-time');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-btn schedule-toggle';
  button.hidden = true;
  meta.after(button);
  let schedule;

  function render() {
    if (!schedule?.available) return;
    const workflowTime = document.querySelector('#next-workflow-time');
    const workflowNote = document.querySelector('#next-workflow-note');
    if (workflowTime) workflowTime.textContent = schedule.enabled ? formatClock(new Date(schedule.nextRun)) : 'Paused';
    if (workflowNote) workflowNote.textContent = 'Jobs · automatic Claude or Codex';
    timeCell.textContent = formatClock(new Date(schedule.nextRun));
    title.textContent = schedule.label + (schedule.enabled ? '' : ' (paused)');
    meta.textContent = (schedule.enabled ? 'Next ' + whenLabel(schedule.nextRun) : 'Not running until resumed') + ' · apply to ' + schedule.count + ' jobs · Claude or Codex, based on available allowance · last: ' + lastLabel(schedule.last);
    button.textContent = schedule.enabled ? 'Pause' : 'Resume';
    button.hidden = false;
  }

  async function refresh() {
    try {
      const res = await fetch('/api/schedules', { cache: 'no-store' });
      if (!res.ok) return;
      schedule = (await res.json()).schedules?.[0];
      render();
    } catch { /* offline: keep what is showing */ }
  }

  button.onclick = async () => {
    if (!schedule) return;
    button.disabled = true;
    try {
      const res = await fetch('/api/schedules/morning', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Jarvis-Chat': '1' }, body: JSON.stringify({ enabled: !schedule.enabled }) });
      if (res.ok) { schedule = (await res.json()).schedules?.[0]; render(); }
    } finally { button.disabled = false; }
  };

  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
