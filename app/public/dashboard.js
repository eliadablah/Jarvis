import { startLiveUpdates } from "./liveUpdates.js";
import { formatClock, formatLocalDate } from "./localTime.js";
import { mountPcActivity } from './pcActivity.js';
import { startJobsPanel } from './jobsPanel.js';
import { startSchedulePanel } from './schedulePanel.js';
import { mountPcOffer, splitPcOffer } from './pcOffer.js';
import { mountLiveIsland } from './liveIsland.js';
import { mountReminders, isReminder } from './remindersPanel.js';
import { mountLearn } from './learnPanel.js';
import { openQuiz, parseQuizCommand, QUIZ_TOPICS } from './quizModal.js';
import { mountNews } from './newsPanel.js';
import { scheduledDesign, parseViewCommand } from './viewSchedule.js';
import { HoldToTalk, speechInSupported } from './speechIn.js';
import { hideCaption, showThinking, speakWithCaption } from './speechCaption.js';
// Spoken replies play at this speed (Eli's choice).
const VOICE_RATE=1.75;
let reminders;
let design='a',tasks=[],voice=true,routeMode='auto',briefTimers=[],activeView='dashboard',sessions={},busy=false;
const app=document.querySelector('#app');
const icons={grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',check:'<path d="m5 12 4 4L19 6"/>',tasks:'<path d="m3 6 2 2 3-4m-5 9 2 2 3-4m-5 9 2 2 3-4M12 6h9m-9 7h9m-9 7h9"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',work:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12a24 24 0 0 0 18 0M10 12h4"/>',wallet:'<path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7m18 6h-5v4h5"/>',book:'<path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v16"/>',settings:'<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="5"/>',spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',home:'<path d="m3 10 9-7 9 7v11H3zM9 21v-8h6v8"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.spark}</svg>`;
const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

app.innerHTML=`<div class="shell">
<aside class="sidebar"><a class="brand" href="#dashboard"><span class="brand-mark">J<span>.</span></span><span>JARVIS<small>YOUR PERSONAL OS</small></span></a><div class="nav-label">WORKSPACE</div><nav>${[['dashboard','grid','Overview'],['tasks','tasks','My tasks'],['reminders','clock','Reminders'],['learn','book','Learn'],['news','globe','Tech news'],['schedule','calendar','Schedule'],['jobs','work','Job search'],['money','wallet','Money'],['vault','book','Memory']].map(([id,i,label])=>`<button class="nav-item ${id==='dashboard'?'active':''}" data-view="${id}">${icon(i)}<span>${label}</span>${id==='tasks'?'<b id="nav-count">4</b>':''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="private-note">${icon('shield')}<span>Private by design<small>Private assistant · server saved</small></span></div><button class="nav-item" id="settings">${icon('settings')}<span>Models & permissions</span></button><div class="profile"><span class="avatar">E</span><span>Elikem Adablah<small>Personal workspace</small></span><span class="profile-dot"></span></div></div></aside>
<main class="main"><header class="topline"><div class="breadcrumb">Workspace <span>/</span> <strong id="view-label">Overview</strong></div><div class="topline-actions"><div class="design-switch" aria-label="Dashboard views"><a href="?design=a" data-design="a">A</a><a href="?design=b" data-design="b">B</a><a href="?design=c" data-design="c">C</a><a href="?design=d" data-design="d" title="Aurora">D</a><a href="?design=e" data-design="e" title="Ember">E</a><a href="?design=auto" data-design="auto">Auto</a></div><span class="preview-tag"><i></i> JARVIS DEV</span></div></header>
<section class="page-heading"><div><div class="eyebrow" id="day-label">Checking local date</div><div class="eyebrow" id="local-clock" aria-label="Current local time"></div><h1>Your day. <span>Under control.</span></h1><p>A little clarity. A clear next move. Jarvis has your back.</p></div><button class="brief-btn" id="brief">${icon('spark')} Brief me <span>↗</span></button></section>
<div class="stats"><div class="stat"><div class="stat-label">Your focus</div><div class="stat-value" id="task-count">4 <span>next moves</span></div><div class="stat-note"><i class="status-dot"></i> One thing at a time</div></div><div class="stat"><div class="stat-label">Career momentum</div><div class="stat-value">6–10 <span>daily goal</span></div><div class="stat-note">Quality applications, tailored to you</div></div><div class="stat"><div class="stat-label">Next workflow</div><div class="stat-value" id="next-workflow-time">—</div><div class="stat-note" id="next-workflow-note">Checking job schedule · Claude or Codex</div></div><div class="stat"><div class="stat-label">Upcoming bills</div><div class="stat-value">—</div><div class="stat-note">Budget account not connected</div></div></div>
<div class="dashboard-grid">
<section class="card priorities" data-section="tasks"><div class="card-head"><div><div class="eyebrow">MAKE ROOM FOR WHAT MATTERS</div><h2>Your next moves <span id="complete-count">0 / 4</span></h2></div><button class="text-btn" id="add-task">${icon('plus')} Add task</button></div><div class="task-progress"><span id="progress-fill"></span></div><div class="task-list" id="task-list"></div><div class="card-foot">Your personal task list <span>Saved on your private server</span></div></section>
<section class="card money" data-section="money"><div class="card-head"><div><div class="eyebrow">A LITTLE PEACE OF MIND</div><h2>Money, in view</h2></div><span class="tag">Not connected</span></div><div class="money-summary"><div><span class="card-subtitle">Your actual balances and bills</span><div class="money-total">—</div><span class="money-note">No financial account is linked yet.</span></div></div><p>Ask Jarvis to find bill reminders in Gmail. They stay separate from a verified bank balance.</p><div class="card-foot">No example balances <button class="text-btn" id="money-details">Check bill reminders ↗</button></div></section>
<section class="card career" data-section="jobs"><div class="card-head"><div><div class="eyebrow">YOUR NEXT CHAPTER</div><h2>Career momentum</h2></div><span class="tag green">Search · prepare · submit</span></div><div class="career-banner"><span class="career-icon">${icon('work')}</span><div class="career-copy"><strong>Better matches. Less busywork.</strong><p>Choose search, preparation, or submission. See what actually happened.</p></div></div><div class="pipeline"><div class="pipeline-step"><strong>6–10</strong><span>Daily target</span></div><div class="pipeline-step"><strong>—</strong><span>Tracker not connected</span></div></div><div class="job-preview"><div><strong>Your Claude or Codex job workflow</strong><small>Search, prepare, or submit with Hands on your PC. Follow the results in PC activity.</small></div><button class="primary-btn" id="review-job">View PC activity ↗</button></div></section>
<section class="card schedule" data-section="schedule"><div class="card-head"><div><div class="eyebrow">LET THE ROUTINE RUN</div><h2>On your radar</h2></div>${icon('calendar')}</div><div class="schedule-row"><div class="schedule-time">6<small>AM</small></div><div class="schedule-line gold-line"></div><div><div class="schedule-title">Views rotate through the day</div><div class="schedule-meta">B 6 AM · D 9 AM · A noon · E 3 PM · C 6 PM · D 10 PM</div><span class="tag gold">Automatic view cycle</span></div></div><div class="schedule-row"><div class="schedule-time">PC<small>PLAN</small></div><div class="schedule-line"></div><div><div class="schedule-title">Daily job preparation</div><div class="schedule-meta">Checking Jarvis schedule · least-used capable agent</div></div></div><div class="card-foot">Your live calendar <button class="text-btn" id="add-schedule">Check today ↗</button></div></section>
<section class="card memory view-hidden" data-section="vault"><div class="card-head"><div><div class="eyebrow">THE CONTEXT BEHIND THE CONVERSATION</div><h2>One memory. Your assistants.</h2></div>${icon('book')}</div><p>Your priorities, projects, and notes live in your Obsidian vault. Claude and Codex use that shared context; Gemini and Perplexity only when vault sharing is switched on.</p><div class="career-banner">${icon('shield')}<div><strong>Your vault stays private.</strong><p>This UI uses selected priorities. Private notes and chat transcripts are not published.</p></div></div><button class="text-btn" id="memory-help">How shared memory works ${icon('arrow')}</button></section>
</div><footer class="main-footer">A calmer command center. <span>Built around your day.</span></footer>
</main>
<aside class="companion"><div class="companion-top"><span>${icon('spark')} JARVIS</span><span><i class="status-dot"></i> <span id="jarvis-state">Standing by</span></span></div><div class="orb-stage"><div class="orbit-dots"></div><div class="orb"><div class="orb-ring ring-one"></div><div class="orb-ring ring-two"></div><div class="orb-core"></div></div></div><div class="orb-caption"><span class="eyebrow">LESS FRICTION. MORE FORWARD.</span><h2>Right here, sir.</h2><p id="companion-sub">Ready when you are.</p></div><div class="brief-transcript" id="transcript" aria-live="polite"><p class="brief-line">Your next move: give the job search a focused block, then keep your Network+ momentum going.</p><p class="brief-line muted">Ask me to open a view or walk you through your day.</p></div><div class="insight"><span class="insight-icon">${icon('spark')}</span><div><strong>Let the task pick the model.</strong><p>Quick work stays light. Complex work gets more thinking.</p><button class="text-btn" id="routing-info">How Auto works ${icon('arrow')}</button></div></div><div class="connections"><div class="eyebrow">YOUR WORKSPACE</div><div class="connection-row">${icon('book')}<span>Shared vault</span><span class="connection-status">Shared notes</span></div><div class="connection-row">${icon('mail')}<span>Gmail & Calendar</span><span class="connection-status">Ask to verify</span></div><div class="connection-row">${icon('work')}<span>Job runner</span><span class="connection-status dim">PC workflow</span></div></div><div class="companion-foot">Private chat · read-only Gmail & Calendar</div></aside>
<div class="command-dock"><form class="command-form" id="command-form"><button type="button" class="mic-btn" id="voice" aria-label="Hold to speak to Jarvis">${icon('mic')}</button><input id="command" autocomplete="off" placeholder='Ask Jarvis, or say “open dashboard”…' aria-label="Ask Jarvis"><button type="submit" class="send-btn" aria-label="Send command">${icon('arrow')}</button></form><div class="command-tools"><div><label class="mode-select">${icon('spark')}<select id="mode" aria-label="Model mode"><option value="auto">Auto</option><option value="claude">Claude</option><option value="codex">Codex</option><option value="gemini">Gemini</option><option value="perplexity">Perplexity</option></select></label><span class="route-chip" id="route-chip">Auto · available engine</span></div><span class="shortcut"><kbd>↵</kbd> to send</span></div></div>
</div><div class="toast" id="toast" role="status"></div><div id="modal-root"></div>`;

const $=selector=>document.querySelector(selector);
let routingStatus=[];
function openReply(){document.body.classList.add('reply-open');}
const closeReply=document.createElement('button');closeReply.type='button';closeReply.className='reply-close text-btn';closeReply.setAttribute('aria-label','Close Jarvis reply');closeReply.textContent='Close ×';closeReply.onclick=()=>document.body.classList.remove('reply-open');$('.companion-top').append(closeReply);
let viewMode='auto';
const VIEWS=['a','b','c','d','e'];
// Aurora (D) and Ember (E) are looks from dashboard-theme.css on the A layout.
const THEME_OF={d:'aurora',e:'ember'};
const BAR_COLOR={aurora:'#150f1f',ember:'#131417'};
const validView=mode=>[...VIEWS,'auto'].includes(mode);
try {
  const savedSessions=JSON.parse(localStorage.getItem('jarvis.sessions')||'{}');
  if(savedSessions&&typeof savedSessions==='object'&&!Array.isArray(savedSessions)) {
    for(const provider of ['claude','codex','gemini','perplexity'])if(typeof savedSessions[provider]==='string')sessions[provider]=savedSessions[provider];
  }
  const savedMode=localStorage.getItem('jarvis.viewMode');
  if(validView(savedMode))viewMode=savedMode;
} catch {}
const query=new URLSearchParams(location.search);
const requested=query.get('view')==='auto'?'auto':query.get('design');
if(validView(requested))viewMode=requested;
function setDesign(mode,announce=false,updateQuery=false){
  if(!validView(mode))mode='auto';
  viewMode=mode;design=mode==='auto'?scheduledDesign():mode;
  try{localStorage.setItem('jarvis.viewMode',mode);}catch{}
  if(updateQuery){const url=new URL(location.href);url.searchParams.set('design',mode);url.searchParams.delete('view');history.replaceState(null,'',url);}
  document.body.dataset.design=design;
  let link=$('#design-style');
  if(!link){link=document.createElement('link');link.id='design-style';link.rel='stylesheet';document.head.append(link);}
  if(['a','d','e'].includes(design))link.removeAttribute('href');else link.href=`/dashboard-${design}.css`;
  const theme=THEME_OF[design];
  if(theme)document.body.dataset.theme=theme;else delete document.body.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',BAR_COLOR[theme]||'#10251d');
  document.querySelectorAll('.design-switch [data-design]').forEach(a=>{const selected=a.dataset.design===mode;a.classList.toggle('selected',selected);a.setAttribute('aria-current',selected?'true':'false');if(a.dataset.design==='auto'){a.title='Automatic views rotate by this device’s clock: B 6 AM, D 9 AM, A noon, E 3 PM, C 6 PM, D 10 PM.';a.style.width='auto';a.style.padding='0 8px';}});
  const titles={a:['Your day. <span>Under control.</span>','A little clarity. A clear next move.'],b:['A little more <span>headspace.</span>','Your priorities, plans, and money. Simply in order.'],c:['All systems. <span>One mission.</span>','Clear priorities. Your command center.'],d:['Calm skies. <span>Clear plans.</span>','Aurora: your day in violet and orange.'],e:['Warm focus. <span>Steady pace.</span>','Ember: charcoal with a warm glow.']};
  $('h1').innerHTML=titles[design][0];$('.page-heading p').textContent=titles[design][1];
  document.title=`Jarvis ${design.toUpperCase()} · ${viewMode==='auto'?'Automatic views':'Personal assistant'}`;
  if(announce)confirmAction(mode==='auto'?'Automatic views resumed: they rotate through B, D, A, E, C and D through the day.':`View ${design.toUpperCase()} selected. Say “resume automatic views” to return to the daily cycle.`);
}
document.querySelectorAll('.design-switch [data-design]').forEach(a=>a.onclick=e=>{e.preventDefault();setDesign(a.dataset.design,true,true);});
setDesign(viewMode);
setInterval(()=>{if(viewMode==='auto'&&design!==scheduledDesign())setDesign('auto');},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&viewMode==='auto')setDesign('auto');});
window.addEventListener('storage',e=>{const explicit=new URLSearchParams(location.search).get('design');if(e.key==='jarvis.viewMode'&&validView(e.newValue)&&!VIEWS.includes(explicit))setDesign(e.newValue);});
function toast(text){const el=$('#toast');el.textContent=text;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4000);}
function stopBriefing(){briefTimers.forEach(clearTimeout);briefTimers=[];$('.shell').classList.remove('briefing');$('#jarvis-state').textContent='Standing by';window.speechSynthesis?.cancel();hideCaption();}
function navigate(view){stopBriefing();activeView=view;document.querySelectorAll('[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===view));$('#view-label').textContent=({dashboard:'Overview',tasks:'My tasks',reminders:'Reminders',learn:'Learn',news:'Tech news',schedule:'Schedule',jobs:'Job search',money:'Money',vault:'Memory',pc:'PC activity'})[view];document.querySelectorAll('[data-section]').forEach(c=>c.classList.toggle('view-hidden',view==='dashboard'?c.dataset.section==='vault':c.dataset.section!==view));$('.dashboard-grid').classList.toggle('single-view',view!=='dashboard');window.scrollTo({top:0,behavior:'smooth'});}
// Replies remain readable in their scroll panel; voice adds a temporary animated caption.
function speak(text){if(voice)speakWithCaption(text,VOICE_RATE);}
function say(text){clearTimeout(say.closeTimer);stopBriefing();openReply();$('#transcript').replaceChildren();const p=document.createElement('p');p.className='brief-line';p.textContent=text;$('#transcript').append(p);speak(text);}
// Short confirmations (view switched, task saved) close the reply panel on their own so it doesn't cover the dashboard; real answers stay until closed.
function confirmAction(text){say(text);say.closeTimer=setTimeout(()=>document.body.classList.remove('reply-open'),6000);}
function renderTasks(){const todos=tasks.filter(t=>!isReminder(t));const done=todos.filter(t=>t.done).length;$('#task-list').innerHTML=todos.length?todos.map(t=>`<div class="task-row ${t.done?'task-done':''}" data-task="${safe(t.id)}"><button class="task-check ${t.done?'checked':''}" data-check="${safe(t.id)}" aria-label="${t.done?'Reopen':'Complete'} ${safe(t.title)}" aria-pressed="${!!t.done}">${t.done?icon('check'):''}</button><div class="task-copy"><div class="task-title">${safe(t.title)}</div><div class="task-meta">${safe(t.tag||'Personal')} · Saved to Jarvis</div></div></div>`).join(''):'<p class="task-meta">Start with one clear next move. Say “add task study Network+”.</p>';$('#task-count').innerHTML=`${todos.length-done} <span>next moves</span>`;$('#nav-count').textContent=todos.length-done;$('#complete-count').textContent=`${done} / ${todos.length}`;$('#progress-fill').style.width=`${todos.length?done/todos.length*100:0}%`;reminders?.render();document.querySelectorAll('[data-check]').forEach(b=>b.onclick=async()=>{const t=tasks.find(t=>t.id===b.dataset.check);try{const result=await api(`/api/dashboard/tasks/${t.id}`,'PATCH',{done:!t.done});tasks=result.tasks;renderTasks();toast('Task saved.');}catch(e){toast(e.message);}});}
async function api(url,method='GET',body){const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json','X-Jarvis-Chat':'1'}:{},body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw new Error(value.error||'Jarvis is unavailable.');return value;}
function updateConnections(data){
  routingStatus=Array.isArray(data.routing)?data.routing:[];
  const accountRow=document.querySelectorAll('.connections .connection-row')[1];
  if(accountRow){const connector=data.connectors?.gmail;const label=accountRow.querySelector('.connection-status');if(label)label.textContent=connector?.state==='enabled'?'Cloud connected':connector?.state==='connected'?'Connected':'Ask to verify';accountRow.title=connector?.detail||'Ask Jarvis to verify access to your actual Gmail and Calendar.';}
  if(routeMode==='auto'&&/^Auto/.test($('#route-chip').textContent))$('#route-chip').textContent=routingStatus.some(status=>status.available)?'Auto · available engine':'Auto · check engine status';
}
async function refreshRouting(){try{updateConnections(await api('/api/dashboard'));}catch{}}
async function load(){try{const data=await api('/api/dashboard');tasks=data.tasks;updateConnections(data);renderTasks();reminders?.notifyDue();$('.preview-tag').textContent=`${data.env.toUpperCase()} · ${data.version.slice(0,7)}`;$('.companion-foot').textContent='Private assistant · tasks saved on server';$('#companion-sub').textContent='Your workspace is ready.';}catch(e){say(e.message);}}
function brief(){navigate('dashboard');openReply();const pending=tasks.filter(t=>!t.done);const lines=[`Here’s your dashboard. ${pending.length} ${pending.length===1?'task':'tasks'} waiting for you.`,...pending.slice(0,3).map((t,i)=>`${i===0?'First':'Then'}, ${t.title}.`),'Ask me about your inbox or calendar, or tell me to apply to jobs.'];$('#transcript').replaceChildren();$('.shell').classList.add('briefing');$('#jarvis-state').textContent='Briefing';lines.forEach((text,i)=>briefTimers.push(setTimeout(()=>{const p=document.createElement('p');p.className='brief-line';p.textContent=text;$('#transcript').append(p);},i*1400)));briefTimers.push(setTimeout(()=>{$('.shell').classList.remove('briefing');$('#jarvis-state').textContent='Standing by';},lines.length*1400));speak(lines.join(' '));}
function modal(title,body){$('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${safe(title)}"><div class="card-head"><h2>${safe(title)}</h2><button class="text-btn" id="close-modal" aria-label="Close dialog">${icon('close')}</button></div>${body}</section></div>`;$('#close-modal').onclick=()=>$('#modal-root').replaceChildren();$('#close-modal').focus();}
async function addTask(title){const value=await api('/api/dashboard/tasks','POST',{title});tasks=value.tasks;renderTasks();confirmAction(`Added to your tasks: ${title}.`);}
$('#add-task').onclick=()=>{modal('Your next move','<label for="new-task">Task</label><input class="modal-input" id="new-task" maxlength="300" placeholder="A small, clear next move"><button class="primary-btn" id="save-task">Save task</button>');$('#new-task').focus();$('#save-task').onclick=async()=>{const title=$('#new-task').value.trim();if(!title)return;const button=$('#save-task');if(button.disabled)return;button.disabled=true;try{await addTask(title);$('#modal-root').replaceChildren();}catch(e){toast(e.message);}finally{button.disabled=false;}};};
const pcOffer=mountPcOffer({run:message=>command(message)});
async function chat(message,source='typed'){
  if(busy){toast('Jarvis is still answering.');return;}
  pcOffer.hide();
  busy=true;stopBriefing();if(voice)showThinking();openReply();$('#jarvis-state').textContent='Thinking';$('#transcript').replaceChildren();
  const requested=document.createElement('p');requested.className='request-line';requested.textContent=(source==='voice'?'You said: ':'You: ')+message;$('#transcript').append(requested);
  // Explicit actions are opened by the PC worker, never by guessing a URL from a model reply.
  const p=document.createElement('p');p.className='brief-line';p.textContent='Connecting…';$('#transcript').append(p);
  let answer='',reader;const controller=new AbortController();
  try{
    const r=await fetch('/api/chat',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-Jarvis-Chat':'1'},body:JSON.stringify({message,provider:routeMode,sessions,requestId:crypto.randomUUID()})});
    if(!r.ok){const err=await r.json();throw new Error(err.error||'Could not connect.');}
    if(!r.body)throw new Error('Jarvis returned no response stream. Please try again.');
    reader=r.body.getReader();const decoder=new TextDecoder();let buffer='';
    function event(value){
      if(value.type==='pc_task'){$('#route-chip').textContent='Hands · choosing Claude Code or Codex';void pcActivity.refresh();}
      if(value.type==='engine')$('#route-chip').textContent=`${value.provider} · ${value.reason||'selected engine'}`;
      if(value.type==='text'){answer+=value.text;p.textContent=splitPcOffer(answer).text;}
      if(value.type==='done'&&['claude','codex','gemini','perplexity'].includes(value.provider)&&typeof value.sessionId==='string'){
        sessions[value.provider]=value.sessionId;try{localStorage.setItem('jarvis.sessions',JSON.stringify(sessions));}catch{}
      }
      if(value.type==='error')throw new Error(value.message||'Jarvis could not finish this answer.');
    }
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let index;while((index=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(line.trim())event(JSON.parse(line));}if(done)break;}
    if(buffer.trim())event(JSON.parse(buffer));
    const reply=splitPcOffer(answer);p.textContent=reply.text;if(reply.text)speak(reply.text);if(reply.offer)pcOffer.show(reply.offer);
  }catch(e){
    controller.abort();try{await reader?.cancel();}catch{}
    p.textContent=answer?`${splitPcOffer(answer).text}\n${e.message}`:e.message;speak(e.message);
  }finally{reader?.releaseLock();busy=false;$('#jarvis-state').textContent='Standing by';void refreshRouting();}
}
async function command(text,source='typed'){if(/^(?:open|show)(?: my)? (?:pc|computer) (?:activity|tasks)[.!]?$/i.test(text)){pcActivity.open();return;}const quizCmd=parseQuizCommand(text);if(quizCmd){if(quizCmd.unknown)say(`I don’t have ${quizCmd.unknown} questions yet. I can quiz you on ${QUIZ_TOPICS.join(', ')}.`);else openQuiz({api,safe,modal,toast,topic:quizCmd.topic});return;}const view=parseViewCommand(text);if(view){setDesign(view.mode==='auto'?'auto':view.design,true,true);return;}const added=text.match(/^(?:jarvis[, ]+)?(?:add|create)(?: a)?(?: new)? (?:task|to.?do)(?: called| to)?[ :]+(.+)$/i);if(added){try{await addTask(added[1]);}catch(e){say(e.message);}return;}if(/^(?:jarvis[, ]+)?(?:open dashboard|brief me|show (?:my )?day|overview)[.!]?$/i.test(text)){brief();return;}if(/^(?:open|show)(?: my)? (?:tasks|to.?do(?: list)?|priorities)[.!]?$/i.test(text)){navigate('tasks');say(`You have ${tasks.filter(t=>!t.done).length} tasks waiting. ${tasks.filter(t=>!t.done).map(t=>t.title).join('. ')}`);return;}const complete=text.match(/^(?:complete|finish|mark (?:task )?)(.+?)(?: complete| done)?$/i);if(complete){const name=complete[1].trim().toLowerCase();const matches=tasks.filter(t=>!t.done&&t.title.toLowerCase()===name);if(matches.length===1){try{tasks=(await api(`/api/dashboard/tasks/${matches[0].id}`,'PATCH',{done:true})).tasks;renderTasks();confirmAction('Task completed and saved.');}catch(e){say(e.message);}return;}}await chat(text,source);}
$('#command-form').onsubmit=e=>{e.preventDefault();const text=$('#command').value.trim();if(text){$('#command').value='';command(text);}};
$('#mode').onchange=e=>{routeMode=e.target.value;$('#route-chip').textContent=routeMode==='auto'?'Auto · available engine':routeMode;};
$('.brand').onclick=e=>{e.preventDefault();navigate('dashboard');};document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>navigate(b.dataset.view));$('#brief').onclick=brief;
const routing=()=>{
  const statuses=routingStatus.length?routingStatus.map(status=>{
    const state=({ready:'Ready to try',cooldown:'Waiting before retry',disabled:'Not enabled'})[status.state]||'Not checked';
    const retry=status.retryAt&&Number.isFinite(Date.parse(status.retryAt))?' Next automatic retry after '+new Date(status.retryAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true})+'.':'';
    return '<div class="model-status"><span class="tag">'+safe(state)+'</span><strong>'+safe(status.provider==='claude'?'Claude':status.provider==='codex'?'Codex':status.provider==='gemini'?'Gemini':status.provider==='perplexity'?'Perplexity':status.provider)+'</strong><p>'+safe(status.reason||'No recent status available.')+safe(retry)+'</p><small>Remaining account tokens: unknown</small></div>';
  }).join(''):'<p>Engine status has not been loaded yet.</p>';
  modal('Models & permissions','<p>Auto uses the task and observed provider availability to choose Claude or Codex, with Gemini as the last fallback. Perplexity answers questions that need live web results and sources; Auto only picks it for those, and it is never a fallback because its API is billed per request. A usage or sign-in refusal before an answer can trigger a fallback.</p>'+statuses+'<p>Ready to try means no recent refusal; it does not verify an active sign-in. Exact remaining tokens are not exposed by these signed-in CLI connections.</p><p>Saved tasks can be changed here. Cloud Gmail/Calendar queries use read-only connectors; requested email, calendar and website changes run through your PC action agents. Desktop agents control Windows apps, files and commands when connected. PC activity shows local agents, scoped requests, progress, and reports. Submitting applications requires an explicit submit request.</p><button class="text-btn" id="voice-toggle">'+(voice?'Mute spoken replies':'Enable spoken replies')+'</button><button class="text-btn" id="install-app" hidden>Install Jarvis</button>');
};
$('#settings').onclick=routing;$('#routing-info').onclick=routing;
$('#money-details').onclick=()=>{navigate('money');chat('Check Gmail for recent bill reminders and due dates. Use actual messages; do not infer a bank balance.');};$('#add-schedule').onclick=()=>{navigate('schedule');chat('Check my Google Calendar for today in America/Chicago using actual calendar tools.');};$('#review-job').onclick=()=>pcActivity.open();$('#memory-help').onclick=()=>say('Claude and Codex can read selected shared vault notes. Your task list is stored separately on the private server.');
let installPrompt;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;toast('Jarvis is ready to install. Open Models & permissions.');});
document.addEventListener('click',async e=>{if(e.target.closest('#voice-toggle')){voice=!voice;window.speechSynthesis?.cancel();hideCaption();$('#voice-toggle').textContent=voice?'Mute spoken replies':'Enable spoken replies';}if(e.target.closest('#install-app')&&installPrompt){await installPrompt.prompt();installPrompt=null;}});
const originalRouting=routing;$('#settings').onclick=()=>{originalRouting();if(installPrompt)$('#install-app').hidden=false;};
let listening=false,finishingListening=false;const ears=new HoldToTalk(text=>{$('#command').value=text;});
async function startListening(){if(listening||finishingListening||busy)return;try{window.speechSynthesis?.cancel();ears.start();listening=true;$('#voice').classList.add('active');$('#jarvis-state').textContent='Listening';}catch(e){toast(e.message);}}
async function finishListening(submit=true){
  if(!listening)return;listening=false;finishingListening=true;$('#voice').classList.remove('active');
  try{const text=await ears.finish();$('#jarvis-state').textContent='Standing by';$('#command').value='';if(submit&&text)await command(text,'voice');else if(submit)toast('No speech heard. Hold the microphone while speaking.');}
  catch(e){toast(e.message);}
  finally{finishingListening=false;if(!busy)$('#jarvis-state').textContent='Standing by';}
}
if(speechInSupported()){$('#voice').onpointerdown=e=>{e.preventDefault();$('#voice').setPointerCapture?.(e.pointerId);startListening();};$('#voice').onpointerup=()=>finishListening();$('#voice').onpointercancel=()=>finishListening(false);$('#voice').onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();startListening();}};$('#voice').onkeyup=e=>{if(e.key===' '||e.key==='Enter')finishListening();};window.addEventListener('blur',()=>finishListening(false));}else{$('#voice').disabled=true;$('#voice').title='Speech recognition is unavailable in this browser. Try Chrome or Edge.';}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#modal-root').replaceChildren();document.body.classList.remove('reply-open');}if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();$('#command').focus();}});
function refreshLocalClock(){const now=new Date();$('#day-label').textContent=formatLocalDate(now).toUpperCase();$('#local-clock').textContent=formatClock(now);}
refreshLocalClock();setInterval(()=>{if(!document.hidden)refreshLocalClock();},1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLocalClock();});
$('#transcript').innerHTML='<p class="brief-line">Ask Jarvis a question, add a task, or say “switch to view B”.</p><p class="brief-line muted">Hold the microphone to speak. Your saved tasks appear here.</p>';renderTasks();load();

const pcActivity=mountPcActivity({api,safe,modal,toast,navigate});
mountLiveIsland({safe,api,toast,navigate});
reminders=mountReminders({api,safe,modal,toast,icon,getTasks:()=>tasks,setTasks:next=>{tasks=next;},onChange:()=>renderTasks()});
reminders.render();
mountLearn({api,safe,toast,modal});
mountNews({api,safe,icon});
startJobsPanel();
startSchedulePanel();
startLiveUpdates();
