// PC activity is shared by all three dashboard views.
import { renderLimits } from './limits.js';
export function mountPcActivity({ api, safe, modal, toast, navigate }) {
  const grid = document.querySelector('.dashboard-grid');
  const card = document.createElement('section');
  card.className = 'card pc-activity'; card.dataset.section = 'pc';
  card.innerHTML = '<div class="card-head"><div><div class="eyebrow">FROM REQUEST TO RESULT</div><h2>PC activity</h2></div><span class="tag" id="pc-connection">Checking PC</span></div><p class="pc-help">Ask Jarvis to complete a browser task, work with your files, or control a Windows app.</p><div class="pc-limits" id="pc-limits" aria-label="Claude and Codex usage limits"><div class="limits"></div></div><div id="pc-task-list" aria-live="polite"></div><div class="card-foot"><span id="pc-agents-summary">Checking local agents</span><button class="text-btn" id="pc-agents">PC agents ↗</button></div>';
  grid.append(card);
  const nav = document.createElement('button'); nav.className = 'nav-item'; nav.dataset.view = 'pc';
  nav.innerHTML = '<span aria-hidden="true">▣</span><span>PC activity</span>';
  document.querySelector('.sidebar nav').append(nav); nav.onclick = () => navigate('pc');
  const labels = { queued: 'Queued', running: 'Running', cancelling: 'Stopping', completed: 'Completed', partial: 'Partly completed', needs_input: 'Needs you', needs_attention: 'Connection lost · review', failed: 'Failed', cancelled: 'Cancelled', done: 'Legacy run · see report' };
  let state = { tasks: [], executors: [] }, loading = false, firstLoad = true;
  const observed = new Map();
  // Usage limits: bars in this card and a copy in the side panel that is always on screen.
  const sideBox = (() => {
    const connections = document.querySelector('.connections');
    if (!connections) return null;
    const eyebrow = document.createElement('div'); eyebrow.className = 'eyebrow limits-eyebrow'; eyebrow.textContent = 'USAGE LIMITS';
    const box = document.createElement('div'); box.className = 'limits'; box.id = 'side-limits';
    connections.append(eyebrow, box); return box;
  })();
  const drawLimits = limits => { renderLimits(document.querySelector('#pc-limits .limits'), limits); renderLimits(sideBox, limits); };
  // --- Live view: a running task shows that the PC is working, not just a status word ---
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; };
  const since = iso => iso ? fmt(Date.now() - Date.parse(iso)) : '';
  function liveBlock(task) {
    if (!['running', 'cancelling'].includes(task.status)) return '';
    const beat = Date.parse(task.heartbeatAt || task.startedAt || task.createdAt);
    const quiet = Date.now() - beat > 60000;
    const feed = (task.activity || []).slice(-6, -1).reverse().map(a => '<li><span>' + safe(a.text.slice(0, 110)) + '</span><small data-pc-ago="' + safe(a.at) + '"></small></li>').join('');
    return '<div class="pc-live' + (quiet ? ' quiet' : '') + '"><div class="pc-live-top"><span class="pc-pulse" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>' +
      safe((task.progress || 'Working').slice(0, 140)) + '</strong></div><div class="pc-live-meta">Working for <b data-pc-elapsed="' + safe(task.startedAt || task.createdAt) + '"></b> · last signal <b data-pc-ago="' + safe(task.heartbeatAt || '') + '"></b> ago' +
      (quiet ? ' · <em>quiet for a while: the agent may be thinking or stuck</em>' : '') + '</div>' + (feed ? '<ul class="pc-live-feed">' + feed + '</ul>' : '') + '</div>';
  }
  const ticker = () => {
    document.querySelectorAll('[data-pc-elapsed]').forEach(n => { n.textContent = since(n.dataset.pcElapsed); });
    document.querySelectorAll('[data-pc-ago]').forEach(n => { if (n.dataset.pcAgo) n.textContent = since(n.dataset.pcAgo) + (n.tagName === 'SMALL' ? ' ago' : ''); });
  };
  setInterval(() => { if (!document.hidden) ticker(); }, 1000);
  async function refresh() {
    if (loading) return; loading = true;
    try {
      const next = await api('/api/pc/tasks');
      for (const task of next.tasks) {
        if (!firstLoad && observed.has(task.id) && observed.get(task.id) !== task.status && ['completed','partial','needs_input','needs_attention','failed','cancelled'].includes(task.status))
          toast('PC task: ' + labels[task.status] + '. Open PC activity for the report.');
        observed.set(task.id, task.status);
      }
      state = next; firstLoad = false;
      drawLimits(state.limits);
      document.querySelector('#pc-connection').textContent = !state.enabled ? 'Not enabled' : state.workerOnline ? 'PC online' : 'PC offline';
      const row = document.querySelectorAll('.connections .connection-row')[2];
      if (row) { row.querySelector('span').textContent = 'PC worker'; row.querySelector('.connection-status').textContent = state.workerOnline ? 'Online' : 'Offline'; }
      const ready=(state.executors || []).filter(e=>e.state==='ready');
      document.querySelector('#pc-agents-summary').textContent = ready.length+' agents · browser actions '+(ready.some(e=>e.capabilities.includes('browser.execute'))?'ready':'needs update')+' · Windows '+(ready.some(e=>e.capabilities.includes('computer'))?'ready':'needs setup');
      const html = state.tasks.length ? state.tasks.slice(0, 12).map(task =>
        '<article class="pc-task" data-status="' + safe(task.status) + '"><div class="pc-task-top"><span class="tag">' + safe(labels[task.status] || task.status) +
        '</span><small>' + safe(task.executor || task.plan?.kind || 'PC') + '</small></div><h3>' + safe(task.request) + '</h3>' + (liveBlock(task) || '<p>' +
        safe((task.progress || task.result || 'Waiting for a capable local agent.').slice(0,220)) + '</p>') + '<div class="pc-task-actions"><button class="text-btn" data-pc-report="' +
        safe(task.id) + '">Details</button>' + (['queued','running'].includes(task.status) ? '<button class="text-btn" data-pc-cancel="' +
        safe(task.id) + '">Cancel task</button>' : '') + '</div></article>').join('') :
        '<div class="pc-empty"><strong>Start with a clear request.</strong><p>“Find support jobs, but do not apply.”<br>“In my assistant workspace, create a budget template.”<br>“Open Calculator.”</p></div>';
      const list = document.querySelector('#pc-task-list'); if (list.innerHTML !== html) { list.innerHTML = html; ticker(); }
    } catch {
      document.querySelector('#pc-connection').textContent = 'Connection unavailable';
      document.querySelector('#pc-agents-summary').textContent = 'Last known activity · reconnecting';
    } finally { loading = false; }
  }
  card.addEventListener('click', async event => {
    const cancel = event.target.closest('[data-pc-cancel]');
    if (cancel) {
      cancel.disabled = true;
      try { await api('/api/pc/tasks/' + cancel.dataset.pcCancel + '/cancel', 'POST', {}); await refresh(); }
      catch(e) { toast(e.message); cancel.disabled = false; }
      return;
    }
    const detail = event.target.closest('[data-pc-report]');
    if (!detail) return;
    const task = state.tasks.find(t => t.id === detail.dataset.pcReport); if (!task) return;
    const report = task.report;
    modal('PC task details', '<p><strong>' + safe(labels[task.status] || task.status) + '</strong></p><p>' + safe(task.request) +
      '</p><p>' + safe(report?.summary || task.result || task.progress || 'Queued') + '</p>' +
      (report ? '<p>Reported submissions: ' + report.submitted + '</p>' + report.evidence.map(e => '<div class="model-status"><strong>' +
        safe(e.action) + ' · ' + safe(e.target) + '</strong><p>' + safe(e.detail) + '</p></div>').join('') +
        report.needsInput.map(s => '<p>Needs you: ' + safe(s) + '</p>').join('') : '') +
      '<small>Evidence is reported by the local agent. Check the linked destination or files for independent confirmation. Cancelling cannot undo completed actions.</small>');
  });
  document.querySelector('#pc-agents').onclick = () => modal('Your PC agents', '<p>Tasks go to an agent with the required tools. Codex is preferred for code/files; Claude Chrome for browser work. Windows-MCP gives Claude and Codex desktop tools and a browser fallback. Supported app launches need no model.</p>' +
    (state.executors || []).map(e => '<div class="model-status"><span class="tag">' + safe(e.state) + '</span><strong>' + safe(e.id) +
      '</strong><p>' + safe(e.reason) + '</p><small>' + safe(e.capabilities.join(', ')) +
      (e.retryAt ? ' · retry after ' + safe(new Date(e.retryAt).toLocaleTimeString()) : '') + '</small></div>').join('') +
    '<p>Exact remaining tokens are unavailable. Usage-limit refusals pause that agent; fallback only happens before any tools run. Approved folders are configured on your PC.</p>');
  // Every 3 seconds while a task is running (so steps show up live), every 10 otherwise.
  const busy = () => state.tasks.some(t => ['running', 'cancelling'].includes(t.status));
  (function poll() { setTimeout(async () => { if (!document.hidden) await refresh(); poll(); }, busy() ? 3000 : 10000); })();
  void refresh();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  return { refresh, open: () => navigate('pc') };
}
