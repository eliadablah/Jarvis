// Live island: a pill at the top of the dashboard that shows what Hands is doing
// right now. Collapsed it shows the current job, a progress ring and a timer;
// hovering or focusing it opens the step feed, the queue and the controls.
//
// Data comes from pcActivity.js, which announces each refresh as the
// "jarvis:pc-state" event (live updates push a refresh within a second or two).
// describeProgress is pure so it can be tested without a browser.

import { createScreenView } from './screenView.js';

const REQUEST_PREFIX =/^(?:on my (?:pc|computer)|in my (?:chrome|browser)),?\s+execute this task:\s*/i;
const ACTIVE = ['running', 'cancelling'];

/** A plain-language summary of one task: title, step number, progress ratio (null if unknown). */
export function describeProgress(task, now = Date.now()) {
  const title = String(task.request || 'Working on your request').replace(REQUEST_PREFIX, '').slice(0, 140);
  const activity = Array.isArray(task.activity) ? task.activity : [];
  const waiting = (task.approvals || []).some(a => !a.decision && Date.parse(a.expiresAt) > now);
  const beat = Date.parse(task.heartbeatAt || task.startedAt || task.createdAt);
  const max = task.plan?.kind === 'jobs' && task.plan.action === 'submit' ? Number(task.plan.maxApplications) : 0;
  const done = Number(task.confirmedThisTask ?? task.report?.submitted ?? 0);
  const startedAt = Date.parse(task.startedAt || task.createdAt);
  return {
    title,
    step: activity.length,
    ratio: max > 0 ? Math.max(0, Math.min(1, done / max)) : null,
    counted: max > 0 ? `${Math.min(done, max)} of ${max} applications` : '',
    waiting,
    quiet: Number.isFinite(beat) && now - beat > 60000,
    elapsedMs: Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0,
    now: String(task.progress || '').slice(0, 140) || 'Working',
  };
}

/** The newest steps first; the first entry is the one in progress. */
export function recentSteps(task, count = 6) {
  return (Array.isArray(task.activity) ? task.activity : []).slice(-count).reverse()
    .map(a => ({ text: String(a.text || '').slice(0, 120), at: a.at }));
}

const clock = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

export function mountLiveIsland({ safe, api, toast, navigate }) {
  const host = document.querySelector('.stats');
  if (!host) return { render() {} };
  const island = document.createElement('section');
  island.className = 'live-island'; island.hidden = true;
  // The text part is redrawn on every update; the screen viewer stays put so a playing video isn't interrupted.
  const main = document.createElement('div');
  main.className = 'island-main'; main.setAttribute('aria-live', 'polite');
  const screen = createScreenView({ api, toast });
  island.append(main, screen.el);
  host.before(island);
  let tasks = [];
  let openByTap = false;

  function render() {
    const active = tasks.filter(t => ACTIVE.includes(t.status));
    const queued = tasks.filter(t => t.status === 'queued');
    const current = active[0];
    // Watching only makes sense while Hands is actually working; stop recording the moment it isn't.
    if (!current && screen.mode() !== 'off') screen.setMode('off');
    if (!current && !queued.length) { island.hidden = true; return; }
    island.hidden = false;
    const info = current ? describeProgress(current) : null;
    island.dataset.state = !current ? 'queued' : info.waiting ? 'waiting' : info.quiet ? 'quiet' : 'working';
    const headline = !current ? `${queued.length} waiting for Hands` : info.waiting ? 'Waiting for you' : 'Hands is working';
    const sub = current ? info.title : queued[0].request.replace(REQUEST_PREFIX, '').slice(0, 140);
    const ring = info?.ratio == null ? '<span class="island-ring spin" aria-hidden="true"></span>'
      : `<span class="island-ring" style="--p:${Math.round(info.ratio * 100)}" aria-hidden="true"></span>`;
    const steps = current ? recentSteps(current).map((s, i) =>
      `<li class="${i === 0 ? 'now' : 'done'}"><i aria-hidden="true"></i><span>${safe(s.text)}</span></li>`).join('') : '';
    const bar = !current ? '' : info.ratio == null
      ? '<div class="island-bar indeterminate" role="progressbar" aria-label="Working"><i></i></div>'
      : `<div class="island-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(info.ratio * 100)}"><i style="width:${Math.round(info.ratio * 100)}%"></i></div>`;
    const upNext = queued.slice(current ? 0 : 1, current ? 3 : 4).map(t => `<li>${safe(t.request.replace(REQUEST_PREFIX, '').slice(0, 90))}</li>`).join('');
    const metaBits = current ? [
      info.counted, `step ${info.step || 1}`, `<b data-island-elapsed="${safe(current.startedAt || current.createdAt)}">${clock(info.elapsedMs)}</b>`,
      info.quiet ? '<em>quiet for a while</em>' : '',
    ].filter(Boolean).join(' · ') : '';
    const html = `<button class="island-pill" type="button" aria-expanded="${openByTap}" aria-controls="island-body">${ring}<span class="island-text"><strong>${safe(headline)}</strong><small>${safe(sub)}</small></span>${current ? `<span class="island-time" data-island-elapsed="${safe(current.startedAt || current.createdAt)}">${clock(info.elapsedMs)}</span>` : ''}</button>
<div class="island-body" id="island-body"><div class="island-inner">
${current ? `<p class="island-now">${safe(info.waiting ? 'Paused: it needs your answer in PC activity.' : info.now)}</p>${bar}<p class="island-meta">${metaBits}</p>${steps ? `<ul class="island-steps">${steps}</ul>` : ''}` : ''}
${upNext ? `<p class="island-label">Up next</p><ul class="island-queue">${upNext}</ul>` : ''}
<div class="island-actions"><button class="text-btn" data-island="open" type="button">${info?.waiting ? 'Answer now' : 'Open details'}</button>${current ? `<button class="text-btn" data-island="watch" type="button">${screen.mode() === 'off' ? 'Watch live' : 'Hide screen'}</button><button class="text-btn" data-island="cancel" type="button">Stop</button>` : ''}</div>
</div></div>`;
    if (main.dataset.html !== html) { main.innerHTML = html; main.dataset.html = html; }
    island.classList.toggle('open', openByTap || info?.waiting === true || screen.mode() !== 'off');
  }

  island.addEventListener('click', async event => {
    const action = event.target.closest('[data-island]')?.dataset.island;
    if (action === 'open') { navigate('pc'); return; }
    if (action === 'watch') { screen.setMode(screen.mode() === 'off' ? 'video' : 'off'); render(); return; }
    if (action === 'cancel') {
      const current = tasks.find(t => ACTIVE.includes(t.status));
      if (!current) return;
      try { await api(`/api/pc/tasks/${current.id}/cancel`, 'POST', {}); document.dispatchEvent(new Event('jarvis:pc-updated')); toast('Stop requested. Actions already completed cannot be undone.'); }
      catch (e) { toast(e.message); }
      return;
    }
    if (event.target.closest('.island-pill')) { openByTap = !openByTap; render(); }
  });
  document.addEventListener('jarvis:pc-state', event => { tasks = Array.isArray(event.detail?.tasks) ? event.detail.tasks : []; render(); });
  // Keep the timers moving between refreshes without rebuilding the markup.
  setInterval(() => {
    if (document.hidden || island.hidden) return;
    island.querySelectorAll('[data-island-elapsed]').forEach(n => { const t = Date.parse(n.dataset.islandElapsed); if (Number.isFinite(t)) n.textContent = clock(Date.now() - t); });
  }, 1000);
  return { render };
}
