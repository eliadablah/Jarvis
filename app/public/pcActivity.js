// PC activity is shared by all three dashboard views.
import { renderLimits } from './limits.js';
export function approvalPresentation(approval) {
  let input={}; try { const parsed=JSON.parse(approval.details);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))input=parsed; } catch {}
  const meta=input?._meta||{},params=meta.tool_params||input||{};
  const tool=/run tool "([^"]+)"/.exec(input.message||'')?.[1]||approval.tool;
  const titles={shared_job_state:'Read your live Google job tracker',read_pdf:'Read your resume',read_text:'Read your job files',append_application_log:'Record a confirmed application',tabs_context_mcp:'Check your browser tabs',tabs_create_mcp:'Open a browser tab',file_upload:'Upload the selected file',read_page:'Read the current web page',get_page_text:'Read the current web page',find:'Find a control on the page',form_input:'Fill a form field',navigate:'Open the requested web page',computer:'Use the browser controls',Bash:'Run a command',Write:'Save a file',Edit:'Edit a file'};
  const descriptions={shared_job_state:'Checks where you have already applied to avoid duplicates.',read_pdf:'Reads the selected resume so Jarvis can use your real qualifications.',read_text:'Reads your existing job instructions or application history.',tabs_context_mcp:'Checks which browser tabs are available for this task.',navigate:'Opens the web address shown below.'};
  const questions=Array.isArray(input.questions)?input.questions:[];
  const schema=input.requestedSchema,properties=schema?.properties;
  let kind='permission',fields=[];
  if(questions.length){kind='questions';fields=questions.map(q=>({key:q.id||q.question,label:q.question||q.header||'Your answer',required:true,type:'string'}));}
  else if(input.mode==='form'){
    if(schema?.type==='object'&&properties&&typeof properties==='object'&&!Array.isArray(properties)){
      kind=Object.keys(properties).length?'form':'permission';
      fields=Object.entries(properties).map(([key,p])=>({key,label:p.title||key,description:p.description||'',required:(schema.required||[]).includes(key),type:p.type||'string',options:p.enum}));
    }else{kind='json';fields=[{key:'answer',label:input.message||'Your answer',required:true,type:'object'}];}
  }
  const target=['path','url','company','role'].filter(key=>typeof params[key]==='string').map(key=>params[key]).join(' · ')||input.url||'';
  return {kind,fields,title:titles[tool]||(kind==='permission'?'Allow Jarvis to '+(tool==='MCP user input'?'use this connected tool':tool)+'?':'Jarvis needs your answer'),description:descriptions[tool]||input.message||input.reason||input.description||meta.tool_description||'Review this action before Jarvis continues.',target};
}
export function approvalAnswer(presentation,values) {
  if(presentation.kind==='permission')return undefined;
  const answers={};
  presentation.fields.forEach((field,index)=>{
    const value=(values[index]||'').trim();
    if(!value){if(field.required)throw Error('Please answer: '+field.label);return;}
    if(presentation.kind==='questions'){answers[field.key]=value;return;}
    if(field.type==='boolean'){if(!['true','false'].includes(value))throw Error('Choose Yes or No.');answers[field.key]=value==='true';}
    else if(['number','integer'].includes(field.type)){const number=Number(value);if(!Number.isFinite(number)||field.type==='integer'&&!Number.isInteger(number))throw Error('Enter a valid number for '+field.label);answers[field.key]=number;}
    else if(['object','array'].includes(field.type)){try{answers[field.key]=JSON.parse(value);}catch{throw Error('Enter valid JSON for '+field.label);}}
    else answers[field.key]=value;
  });
  return presentation.kind==='questions'&&presentation.fields.length===1?answers[presentation.fields[0].key]:presentation.kind==='json'?JSON.stringify(answers.answer):JSON.stringify(answers);
}
export function failureMessage(task) {
  if (!['needs_input','failed','partial','needs_attention','cancelled'].includes(task.status)) return '';
  const needs = task.report?.needsInput || [];
  const evidence = task.report?.evidence || [];
  if(['needs_input','failed','partial'].includes(task.status)&&task.approvals?.length&&task.approvals.every(a=>a.decision==='allow')&&evidence.some(e=>/user rejected MCP tool call/i.test(e.detail||'')))return 'Jarvis saved your Allow clicks, but the agent still received a rejection. '+(task.report?.submitted===0?'No applications were submitted. ':'')+'The approval reply format has been corrected; use Try again to resume the remaining work.';
  const reason = needs.find(s=>!/^No (?:new submissions|applications were confirmed)/i.test(s)) || evidence.find(e => /denied|blocked|attempted_read|error/i.test(e.action))?.detail || task.report?.summary || task.result || task.progress;
  return reason || 'The agent stopped without a specific reason. Review Details before trying again.';
}
export function canRetryTask(task) {
  return !!task.plan && !task.retryTaskId && ['needs_input','failed','partial','cancelled'].includes(task.status) && !(task.plan.kind==='jobs' && task.plan.action==='submit' && task.report?.submitted>=task.plan.maxApplications);
}
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
  const approvalAnswers = new Map();
  const seenApprovals = new Set();
  let renderedHtml = '';
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
  function approvalBlock(task) {
    return (task.approvals || []).filter(a=>!a.decision&&Date.parse(a.expiresAt)>Date.now()&&task.status==='running').map(a=>{
      const view=approvalPresentation(a);
      const fields=view.fields.map((field,index)=>{
        const attrs=' data-approval-answer="'+safe(a.id+':'+index)+'" data-approval-id="'+safe(a.id)+'"';
        const options=field.type==='boolean'?['true','false']:field.options;
        const control=Array.isArray(options)?'<select'+attrs+'><option value="">Choose an answer</option>'+options.map(option=>'<option value="'+safe(String(option))+'">'+safe(field.type==='boolean'?(option==='true'?'Yes':'No'):String(option))+'</option>').join('')+'</select>':'<textarea'+attrs+' rows="2" maxlength="4000" placeholder="'+safe(['object','array'].includes(field.type)?'Enter the requested JSON':'Type your answer')+'" autocomplete="off"></textarea>';
        return '<label>'+safe(field.label)+(field.required?'':' (optional)')+(field.description?'<small>'+safe(field.description)+'</small>':'')+control+'</label>';
      }).join('');
      return '<section class="pc-approval" aria-label="Permission request"><div class="pc-approval-heading"><span class="tag">Waiting for you</span><small>'+safe(a.provider==='codex'?'Codex':'Claude')+'</small></div><h4>'+safe(view.title)+'</h4><p>'+safe(view.description)+'</p>'+(view.target?'<p class="pc-approval-target">'+safe(view.target)+'</p>':'')+fields+'<p class="pc-approval-help">'+(view.kind==='permission'?'No typing needed. Allow only approves this action.':'Your answer will be sent to the waiting task. Do not enter passwords or sign-in codes.')+'</p><div class="pc-task-actions"><button class="pc-approval-allow" data-approval="'+safe(a.id)+'" data-task="'+safe(task.id)+'" data-choice="allow">'+(view.kind==='permission'?'Allow this action':'Send answer & continue')+'</button><button class="text-btn" data-approval="'+safe(a.id)+'" data-task="'+safe(task.id)+'" data-choice="deny">Don’t allow</button></div><details><summary>Technical details</summary><pre>'+safe(a.details)+'</pre></details></section>';
    }).join('');
  }
  function liveBlock(task) {
    if (!['running', 'cancelling'].includes(task.status)) return '';
    if(task.status==='running'&&(task.approvals||[]).some(a=>!a.decision&&Date.parse(a.expiresAt)>Date.now()))return '<p class="pc-paused">Task paused. Choose an answer above to continue.</p>';
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
        for(const approval of task.approvals||[])if(!approval.decision&&Date.parse(approval.expiresAt)>Date.now()&&!seenApprovals.has(approval.id)){
          seenApprovals.add(approval.id);if(!firstLoad)toast('Jarvis is waiting: '+approvalPresentation(approval).title+'. Open PC activity.');
        }
        if (!firstLoad && observed.has(task.id) && observed.get(task.id) !== task.status && ['completed','partial','needs_input','needs_attention','failed','cancelled'].includes(task.status))
          toast('PC task: ' + labels[task.status] + '. ' + (failureMessage(task) || 'Open PC activity for the report.').slice(0,240));
        observed.set(task.id, task.status);
      }
      state = next; firstLoad = false;
      drawLimits(state.limits);
      document.querySelector('#pc-connection').textContent = !state.enabled ? 'Not enabled' : state.workerOnline ? 'PC online' : 'PC offline';
      const row = document.querySelectorAll('.connections .connection-row')[2];
      if (row) { row.querySelector('span').textContent = 'PC worker'; row.querySelector('.connection-status').textContent = state.workerOnline ? 'Online' : 'Offline'; }
      const ready=(state.executors || []).filter(e=>e.state==='ready');
      document.querySelector('#pc-agents-summary').textContent = ready.length+' agents · browser actions '+(ready.some(e=>e.capabilities.includes('browser.execute'))?'ready':'needs update')+' · Windows '+(ready.some(e=>e.capabilities.includes('computer'))?'ready':'needs setup');
      const waiting=t=>t.status==='running'&&(t.approvals||[]).some(a=>!a.decision&&Date.parse(a.expiresAt)>Date.now());
      const ordered=[...state.tasks.filter(waiting),...state.tasks.filter(t=>!waiting(t))];
      const html = state.tasks.length ? ordered.slice(0, 12).map(task =>
        '<article class="pc-task" data-status="' + safe(task.status) + '"><div class="pc-task-top"><span class="tag">' + safe(labels[task.status] || task.status) +
        '</span><small>' + safe(task.executor || task.plan?.kind || 'PC') + '</small></div><h3>' + safe(task.request) + '</h3>' + (task.confirmedThisTask ? '<p>' + safe(task.confirmedThisTask) + ' new confirmations recorded for this task.</p>' : '') + approvalBlock(task) + (liveBlock(task) || '<p>' +
        safe((task.progress || task.result || 'Waiting for a capable local agent.').slice(0,220)) + '</p>') + (failureMessage(task) ? '<div class="pc-failure"><strong>Why it stopped</strong><p>' + safe(failureMessage(task)) + '</p><small>' + (task.status==='needs_attention' ? 'The outcome is uncertain. Check the destination before repeating it.' : 'Try again checks existing work first. Access restrictions or missing answers may still need resolving.') + '</small></div>' : '') + '<div class="pc-task-actions"><button class="text-btn" data-pc-report="' +
        safe(task.id) + '">Details</button>' + (canRetryTask(task) ? '<button class="text-btn" data-pc-retry="' + safe(task.id) + '">Try again' + (task.plan.kind==='jobs' && task.report?.submitted ? ' · remaining only' : '') + '</button>' : '') + (['queued','running'].includes(task.status) ? '<button class="text-btn" data-pc-cancel="' +
        safe(task.id) + '">Cancel task</button>' : '') + '</div></article>').join('') :
        '<div class="pc-empty"><strong>Start with a clear request.</strong><p>“Find support jobs, but do not apply.”<br>“In my assistant workspace, create a budget template.”<br>“Open Calculator.”</p></div>';
      const list = document.querySelector('#pc-task-list'); if (renderedHtml !== html) {
        const focused=document.activeElement,answerId=focused?.dataset?.approvalAnswer;
        const selection=answerId?[focused.selectionStart,focused.selectionEnd]:null;
        list.querySelectorAll('[data-approval-answer]').forEach(n=>approvalAnswers.set(n.dataset.approvalAnswer,n.value));
        list.innerHTML = html; renderedHtml=html;
        list.querySelectorAll('[data-approval-answer]').forEach(n=>{n.value=approvalAnswers.get(n.dataset.approvalAnswer)||'';});ticker();
        if(answerId){const input=list.querySelector('[data-approval-answer="'+answerId+'"]');if(input){input.focus({preventScroll:true});if(selection&&typeof selection[0]==='number'&&typeof input.setSelectionRange==='function')input.setSelectionRange(...selection);}}
      }
    } catch {
      document.querySelector('#pc-connection').textContent = 'Connection unavailable';
      document.querySelector('#pc-agents-summary').textContent = 'Last known activity · reconnecting';
    } finally { loading = false; }
  }
  card.addEventListener('click', async event => {
    const approvalButton=event.target.closest('[data-approval]');
    if(approvalButton){
      const task=state.tasks.find(t=>t.id===approvalButton.dataset.task),approval=task?.approvals?.find(a=>a.id===approvalButton.dataset.approval);
      if(!approval?.decisionToken)return;
      let answer;
      if(approvalButton.dataset.choice==='allow'){
        try{answer=approvalAnswer(approvalPresentation(approval),[...card.querySelectorAll('[data-approval-id="'+approval.id+'"]')].map(n=>n.value));}catch(e){toast(e.message);return;}
      }
      approvalButton.disabled=true;
      try{await api('/api/pc/tasks/'+task.id+'/approvals/'+approval.id+'/decision','POST',{decision:approvalButton.dataset.choice,decisionToken:approval.decisionToken,...(answer?{answer}: {})});toast(approvalButton.dataset.choice==='allow'?'Approved this action. Jarvis will continue.':'Denied. Jarvis will receive your answer.');await refresh();}catch(e){toast(e.message);approvalButton.disabled=false;}return;
    }
    const retry = event.target.closest('[data-pc-retry]');
    if (retry) {
      retry.disabled = true;
      try { await api('/api/pc/tasks/' + retry.dataset.pcRetry + '/retry', 'POST', {}); toast('Retry queued. Completed work will be checked first.'); await refresh(); }
      catch(e) { toast(e.message); retry.disabled = false; }
      return;
    }
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
  document.querySelector('#pc-agents').onclick = () => modal('Your PC agents', '<p>Tasks go to an agent with the required tools. Claude and Codex can handle jobs. Jarvis selects the capable, ready provider with the lowest fresh allowance usage; unknown usage is not treated as zero. Windows-MCP gives Claude and Codex desktop tools and a browser fallback. Supported app launches need no model.</p>' +
    (state.executors || []).map(e => '<div class="model-status"><span class="tag">' + safe(e.state) + '</span><strong>' + safe(e.id) +
      '</strong><p>' + safe(e.reason) + '</p><small>' + safe(e.capabilities.join(', ')) +
      (e.retryAt ? ' · retry after ' + safe(new Date(e.retryAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})) : '') + '</small></div>').join('') +
    '<p>Exact remaining tokens are unavailable. Usage-limit refusals pause that agent; Temporary startup failures retry up to three times before actions. Provider fallback happens before actions; workspace quota continuation checks saved progress. Use Try again for stopped tasks; uncertain outcomes need review. Approved folders are configured on your PC.</p>');
  // Every 3 seconds while a task is running (so steps show up live), every 10 otherwise.
  const busy = () => state.tasks.some(t => ['running', 'cancelling'].includes(t.status));
  (function poll() { setTimeout(async () => { if (!document.hidden) await refresh(); poll(); }, busy() ? 3000 : 10000); })();
  document.addEventListener("jarvis:pc-updated",()=>{void refresh();});
  void refresh();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  return { refresh, open: () => navigate('pc') };
}
