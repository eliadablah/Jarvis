// PC activity is shared by all three dashboard views.
export function mountPcActivity({ api, safe, modal, toast, navigate }) {
  const grid = document.querySelector('.dashboard-grid');
  const card = document.createElement('section');
  card.className = 'card pc-activity'; card.dataset.section = 'pc';
  card.innerHTML = '<div class="card-head"><div><div class="eyebrow">FROM REQUEST TO RESULT</div><h2>PC activity</h2></div><span class="tag" id="pc-connection">Checking PC</span></div><p class="pc-help">Ask Jarvis to complete a browser task, work with your files, or control a Windows app.</p><div id="pc-task-list" aria-live="polite"></div><div class="card-foot"><span id="pc-agents-summary">Checking local agents</span><button class="text-btn" id="pc-agents">PC agents ↗</button></div>';
  grid.append(card);
  const nav = document.createElement('button'); nav.className = 'nav-item'; nav.dataset.view = 'pc';
  nav.innerHTML = '<span aria-hidden="true">▣</span><span>PC activity</span>';
  document.querySelector('.sidebar nav').append(nav); nav.onclick = () => navigate('pc');
  const labels = { queued: 'Queued', running: 'Running', cancelling: 'Stopping', completed: 'Completed', partial: 'Partly completed', needs_input: 'Needs you', needs_attention: 'Connection lost · review', failed: 'Failed', cancelled: 'Cancelled', done: 'Legacy run · see report' };
  let state = { tasks: [], executors: [] }, loading = false, firstLoad = true;
  const observed = new Map();
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
      document.querySelector('#pc-connection').textContent = !state.enabled ? 'Not enabled' : state.workerOnline ? 'PC online' : 'PC offline';
      const row = document.querySelectorAll('.connections .connection-row')[2];
      if (row) { row.querySelector('span').textContent = 'PC worker'; row.querySelector('.connection-status').textContent = state.workerOnline ? 'Online' : 'Offline'; }
      const ready=(state.executors || []).filter(e=>e.state==='ready');
      document.querySelector('#pc-agents-summary').textContent = ready.length+' agents · browser actions '+(ready.some(e=>e.capabilities.includes('browser.execute'))?'ready':'needs update')+' · Windows '+(ready.some(e=>e.capabilities.includes('computer'))?'ready':'needs setup');
      const html = state.tasks.length ? state.tasks.slice(0, 12).map(task =>
        '<article class="pc-task" data-status="' + safe(task.status) + '"><div class="pc-task-top"><span class="tag">' + safe(labels[task.status] || task.status) +
        '</span><small>' + safe(task.executor || task.plan?.kind || 'PC') + '</small></div><h3>' + safe(task.request) + '</h3><p>' +
        safe((task.progress || task.result || 'Waiting for a capable local agent.').slice(0,220)) + '</p><div class="pc-task-actions"><button class="text-btn" data-pc-report="' +
        safe(task.id) + '">Details</button>' + (['queued','running'].includes(task.status) ? '<button class="text-btn" data-pc-cancel="' +
        safe(task.id) + '">Cancel task</button>' : '') + '</div></article>').join('') :
        '<div class="pc-empty"><strong>Start with a clear request.</strong><p>“Find support jobs, but do not apply.”<br>“In my assistant workspace, create a budget template.”<br>“Open Calculator.”</p></div>';
      const list = document.querySelector('#pc-task-list'); if (list.innerHTML !== html) list.innerHTML = html;
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
  void refresh(); setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  return { refresh, open: () => navigate('pc') };
}
