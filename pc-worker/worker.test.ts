import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { parsePcIntent, isJobErrand } from "../app/src/pcTasks/intent.ts";
import { validateReport, emptyReport, type PcPlan, type ExecutorStatus } from "../app/src/pcTasks/protocol.ts";
import { enqueuePcTask, claimNextPcTask, heartbeatPcTask, finishPcTask, cancelPcTask, pcSnapshot, readPcTasks, publicTask, workerOnline } from "../app/src/pcTasks/store.ts";
import { handlePcTasks } from "../app/src/pcTasks/api.ts";
import { loadConfig } from "../app/src/config.ts";
import { agentStatuses, chooseAgents, canFallback, mayHaveActed, reportedRun, refusal, jobPrompt, codexArgs, claudeArgs, promptFor } from "./agents.ts";
import { readState, saveState, acquireWorkerLock } from "./persistence.ts";
import { validateClaim, deliverReport } from "./worker.ts";
import { readWorkerActivity } from "./status.ts";
import { quotaPressure } from './limits.ts';
import { canResumeWorkspace, DRAFT_GUIDANCE } from './agents.ts';

test('90 percent routing uses fresh unexpired readings across provider adapters',()=>{
 const now=Date.parse('2026-10-19T19:00:00Z');
 const reading={updatedAt:new Date(now).toISOString(),fiveHour:{usedPercent:90,resetsAt:(now+3600000)/1000}};
 assert.equal(quotaPressure(reading,now),now+3600000);
 assert.equal(quotaPressure({...reading,fiveHour:{...reading.fiveHour,usedPercent:89.9}},now),undefined);
 assert.equal(quotaPressure({...reading,updatedAt:new Date(now-3600000).toISOString()},now),undefined);
 assert.equal(quotaPressure(reading,now+3600001),undefined);
 const settings={server:'https://example.com',token:'test',jobsDir:'.',claudeBin:'claude',codexBin:'codex',windowsMcpCommand:'windows'};
 const statuses=agentStatuses(settings,{},now,{claude:reading});
 assert.ok(statuses.filter(s=>s.id.startsWith('claude-')).every(s=>s.state==='cooldown'));
 assert.deepEqual(chooseAgents(plan('Find support jobs'),statuses),['codex-computer']);
});
test('quota after code tools permits inspected continuation without browser submission replay',()=>{
 const run={report:emptyReport('needs_input','Usage limit reached'),failure:'quota' as const,safeToRetry:false};
 const workspace=plan('In my assistant workspace, update the project');
 assert.equal(canResumeWorkspace(workspace,run),true);
 for(const request of ['Apply to 1 support jobs','In my Chrome, execute this task: draft replies','On my PC, execute this task: open Excel'])assert.equal(canResumeWorkspace(plan(request),run),false);
 assert.equal(canResumeWorkspace(workspace,{...run,failure:'authentication'}),false);
 assert.equal(canFallback(run),false);assert.equal(reportedRun(run.report,workspace,true).failure,'quota');
 assert.match(DRAFT_GUIDANCE,/leaving it unsent/);assert.match(DRAFT_GUIDANCE,/report-only/);assert.match(DRAFT_GUIDANCE,/Preserve any existing draft/);
});
const agents: ExecutorStatus[] = [{ id: "claude-chrome", capabilities: ["jobs", "browser"], features:["job-files-v1","task-sync-v1","personal-tools-v1"], state: "ready", reason: "", remainingTokens: null }];
const clock = new Date("2026-10-16T12:00:00Z");
test("restart status keeps active tasks, bounds HTTPS and omits private data", async () => {
  const status = await readWorkerActivity("https://jarvis.example/", (async (url, options) => {
    assert.equal(String(url), "https://jarvis.example/api/pc/tasks");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    assert.equal(options?.headers, undefined);
    return Response.json({ protocol: 2, workerOnline: true, workerSeenAt: clock.toISOString(),
      tasks: [{ status: "running", request: "private request", lease: "private lease" }] });
  }) as typeof fetch);
  assert.deepEqual(status.tasks, [{ status: "running" }]);
  assert.equal(JSON.stringify(status).includes("private"), false);
  await assert.rejects(readWorkerActivity("http://jarvis.example/"), /Invalid/);
  await assert.rejects(readWorkerActivity("https://jarvis.example/", (async () => Response.json({ protocol: 2, workerOnline: true, tasks: [{status:"unknown"}] })) as typeof fetch), /Invalid/);
  await assert.rejects(readWorkerActivity("https://jarvis.example/", (async () => new Response("offline", {status:503})) as typeof fetch), /503/);
});
const later = (ms: number) => new Date(clock.getTime() + ms);
async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-pc-test-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
function plan(message: string): PcPlan {
  const intent = parsePcIntent(message); assert.equal(intent?.type, "task");
  if (intent?.type !== "task") throw new Error(); return intent.plan;
}
test("negations, questions and email drafts cannot submit jobs", () => {
  for (const text of ["Don't apply to jobs", "Do not submit job applications", "How did applying to jobs go?", "Explain how to apply to jobs", '"apply to jobs"', "Submit my email drafts", "Submit all drafts", "Remind me to apply to jobs", "If I ask you to apply to jobs", "Could you not apply to jobs", "Find IAM policies"])
    assert.equal(isJobErrand(text), false, text);
  assert.deepEqual(plan("Find jobs but do not apply"), { kind: "jobs", action: "search", maxApplications: 0 });
  assert.equal((plan("Prepare job applications") as any).action, "prepare");
  assert.equal((plan("Apply to 3 support jobs") as any).maxApplications, 3);
  assert.equal((plan("Find and apply to jobs") as any).action, "submit");
  assert.equal(parsePcIntent("Apply to jobs but don't submit")?.type, "clarify");
});
test("explicit workspace/browser/desktop requests map to bounded capabilities", () => {
  assert.deepEqual(plan("In my assistant workspace, create a budget.csv"), { kind: "workspace", action: "execute", workspace: "assistant" });
  assert.equal(plan("In my Chrome, find the AWS docs").kind, "browser");
  assert.deepEqual(plan("Open Calculator"), { kind: "desktop", action: "open_app", app: "calculator" });
  assert.equal(parsePcIntent("Open Calculator; delete all files"), undefined);
  assert.equal(parsePcIntent("On my PC open Excel and control it")?.type, "clarify");
  assert.equal(parsePcIntent("Cancel my PC task")?.type, "cancel");
});
test("zero applications and missing evidence are never completed", () => {
  const submit = plan("Apply to 3 support jobs");
  assert.equal(validateReport(emptyReport("completed", "Done"), submit).outcome, "needs_input");
  assert.equal(validateReport({ ...emptyReport("completed", "No submissions"), evidence: [{ action: "read", target: "board", detail: "Opened listings" }] }, submit).outcome, "needs_input");
  assert.throws(() => validateReport({ ...emptyReport("completed", "Applied"), submitted: 1 }, submit));
  assert.throws(() => validateReport({ ...emptyReport("completed", "Applied"), submitted: 1, evidence: [{ action: "submitted", target: "https://example.com", detail: "Confirmation" }] }, plan("Find jobs")));
});
test("concurrent claims grant only one lease and wrong owners cannot finish", async () => withDir(async dir => {
  const task = await enqueuePcTask(dir, "Find support jobs", undefined, clock);
  const [a, b] = await Promise.all([claimNextPcTask(dir, "worker-a", agents, clock), claimNextPcTask(dir, "worker-b", agents, clock)]);
  assert.equal([a, b].filter(Boolean).length, 1);
  const claimed = a ?? b!;
  assert.equal(await finishPcTask(dir, task.id, "wrong", claimed.lease!, randomUUID(), emptyReport("failed", "No"), clock), undefined);
  assert.equal(await heartbeatPcTask(dir, task.id, claimed.workerId!, "wrong", "hello", undefined, clock), undefined);
  assert.equal("lease" in publicTask(claimed), false);
}));
test("heartbeats keep long tasks online; expired tasks require review and never auto-run again", async () => withDir(async dir => {
  const task = await enqueuePcTask(dir, "Find support jobs", undefined, clock);
  const c = (await claimNextPcTask(dir, "worker", agents, clock))!;
  await heartbeatPcTask(dir, c.id, "worker", c.lease!, "Searching", "claude-chrome", later(90_000));
  const alive = await pcSnapshot(dir, later(180_000)); assert.equal(alive.tasks[0]?.status, "running");
  assert.equal(workerOnline(alive, later(180_000).getTime()), true);
  assert.equal((await pcSnapshot(dir, later(220_000))).tasks[0]?.status, "needs_attention");
  assert.equal(await claimNextPcTask(dir, "worker", agents, later(230_000)), undefined);
  assert.equal((await readPcTasks(dir)).tasks[0]?.id, task.id);
}));
test("report retries are idempotent; queued and active cancellation differ", async () => withDir(async dir => {
  const first = await enqueuePcTask(dir, "Find support jobs", "request-1", clock);
  assert.equal((await enqueuePcTask(dir, "Find support jobs", "request-1", clock)).id, first.id);
  const c = (await claimNextPcTask(dir, "worker", agents, clock))!;
  assert.equal((await cancelPcTask(dir, c.id, clock))?.status, "cancelling");
  assert.equal((await heartbeatPcTask(dir, c.id, "worker", c.lease!, "Stopping", undefined, clock))?.cancelRequested, true);
  const reportId = randomUUID();
  await finishPcTask(dir, c.id, "worker", c.lease!, reportId, emptyReport("cancelled", "Stopped"), clock);
  assert.equal((await finishPcTask(dir, c.id, "worker", c.lease!, reportId, {}, clock))?.status, "cancelled");
  const second = await enqueuePcTask(dir, "Find networking jobs", undefined, clock);
  assert.equal((await cancelPcTask(dir, second.id, clock))?.status, "cancelled");
  assert.equal(await claimNextPcTask(dir, "worker", agents, clock), undefined);
}));
test("history pruning preserves every active task and unscoped legacy tasks do not run", async () => withDir(async dir => {
  const queued = await enqueuePcTask(dir, "Find support jobs", undefined, clock);
  const history = Array.from({length: 105}, () => ({ id: randomUUID(), kind: "jobs", request: "old", status: "done", createdAt: clock.toISOString() }));
  await writeFile(join(dir, "pc-tasks.json"), JSON.stringify({ tasks: [queued, ...history] }));
  const state = await pcSnapshot(dir, clock);
  assert.equal(state.tasks.length, 101); assert.equal(state.tasks[0]?.id, queued.id);
  await writeFile(join(dir, "pc-tasks.json"), JSON.stringify({ tasks: [{ ...queued, plan: undefined }] }));
  assert.equal(await claimNextPcTask(dir, "worker", agents, clock), undefined);
  assert.equal((await readPcTasks(dir)).tasks[0]?.status, "needs_input");
}));
test("capabilities and cooldowns control routing; no fallback after tools", () => {
  const settings = { server: "https://example.com", token: "test", jobsDir: ".", claudeBin: "claude", codexBin: "codex" };
  let statuses = agentStatuses(settings, {}, 0);
  assert.deepEqual(chooseAgents(plan("Find support jobs"), statuses), ["claude-chrome", "codex-computer"]);
  assert.deepEqual(chooseAgents(plan("In my assistant workspace, create a note"), statuses), ["codex-local", "claude-files"]);
  statuses = agentStatuses(settings, { "codex-local": { until: 1000, reason: "limit" } }, 0);
  assert.deepEqual(chooseAgents(plan("In my assistant workspace, create a note"), statuses), ["claude-files"]);
  assert.equal(canFallback({ report: emptyReport("needs_input", "quota"), failure: "quota", safeToRetry: false }), false);
  assert.equal(canFallback({ report: emptyReport("needs_input", "quota"), failure: "quota", safeToRetry: true }), true);
  assert.ok(statuses.every(s => s.remainingTokens === null));
  assert.ok(!codexArgs().includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(claudeArgs(plan("Find jobs")).includes("--restricted"));
  // Job runs may run only the installed search CLIs in a shell; plain Bash stays off the deny list only because the allow list is narrow.
  const jobArgs = claudeArgs(plan("Find jobs")), allowed = jobArgs.slice(jobArgs.indexOf("--allowedTools"), jobArgs.indexOf("--disallowedTools"));
  assert.ok(allowed.some(t => t.startsWith("Bash(bun run .agents/skills/freehire-search/cli/src/cli.ts search")));
  assert.ok(!allowed.includes("Bash"));
  assert.match(jobPrompt("Find jobs", 10, "search"), /Maximum submissions: 0/);
});
test("durable outbox survives reload and failed delivery without rerunning a task", async () => withDir(async dir => {
  const state = await readState(dir);
  const task = { id: randomUUID(), request: "Find jobs", plan: plan("Find jobs"), workerId: state.workerId, lease: randomUUID() };
  assert.equal(validateClaim(task, state.workerId).id, task.id);
  assert.throws(() => validateClaim({ ...task, plan: plan("Apply to jobs") }, state.workerId));
  state.active = task; state.outbox = { task, reportId: randomUUID(), report: emptyReport("needs_input", "Need help") };
  await saveState(dir, state);
  const reloaded = await readState(dir); assert.deepEqual(reloaded.outbox, state.outbox);
  const fetchSaved = globalThis.fetch; let posts = 0;
  globalThis.fetch = async () => { posts++; return new Response("offline", { status: 503 }); };
  try {
    await assert.rejects(deliverReport({ server: "https://example.com", token: "test", jobsDir: "." }, reloaded));
    assert.deepEqual((await readState(dir)).outbox, state.outbox); assert.equal(posts, 1);
  } finally { globalThis.fetch = fetchSaved; }
}));
test("OS lock prevents two workers controlling the same desktop", async () => {
  const lock = await acquireWorkerLock(0);
  const address = lock.address(); assert.ok(address && typeof address === "object");
  try { await assert.rejects(acquireWorkerLock(address.port), { code: "EADDRINUSE" }); }
  finally { await new Promise<void>(resolve => lock.close(() => resolve())); }
});
test("HTTP rejects old workers, wrong tokens, cross-origin cancel and lease theft", async () => withDir(async dir => {
  const saved = process.env.JARVIS_DATA_DIR; process.env.JARVIS_DATA_DIR = dir;
  const config = loadConfig({ PC_WORKER_TOKEN: "test-worker-token" });
  const server = createServer((req, res) => { void handlePcTasks(req, res, new URL(req.url!, "http://localhost").pathname, config); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = "http://127.0.0.1:" + address.port;
  const workerId = randomUUID();
  const workerHeaders = { Authorization: "Bearer test-worker-token", "Content-Type": "application/json" };
  try {
    let r = await fetch(base + "/api/pc/tasks/claim", { method: "POST", headers: workerHeaders });
    assert.equal(r.status, 426);
    r = await fetch(base + "/api/pc/tasks/claim", { method: "POST" }); assert.equal(r.status, 401);
    const task = await enqueuePcTask(dir, "Find jobs");
    r = await fetch(base + "/api/pc/tasks/claim", { method: "POST", headers: workerHeaders, body: JSON.stringify({ protocol: 2, workerId, executors: agents }) });
    assert.equal(r.status, 200); const claim = (await r.json() as any).task;
    const publicState = await (await fetch(base + "/api/pc/tasks")).json() as any;
    assert.equal("lease" in publicState.tasks[0], false);
    r = await fetch(base + "/api/pc/tasks/" + task.id + "/cancel", { method: "POST", headers: { "Content-Type": "application/json", "X-Jarvis-Chat": "1", Origin: "https://evil.example" }, body: "{}" });
    assert.equal(r.status, 403);
    r = await fetch(base + "/api/pc/tasks/" + task.id + "/result", { method: "POST", headers: workerHeaders, body: JSON.stringify({ protocol: 2, workerId, lease: randomUUID(), reportId: randomUUID(), report: emptyReport("completed", "Done") }) });
    assert.equal(r.status, 409);
    r = await fetch(base + "/api/pc/tasks/" + task.id + "/heartbeat", { method: "POST", headers: workerHeaders, body: JSON.stringify({ protocol: 2, workerId, lease: claim.lease, progress: "Working" }) });
    assert.equal(r.status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (saved === undefined) delete process.env.JARVIS_DATA_DIR; else process.env.JARVIS_DATA_DIR = saved;
  }
}));

test("spoken counts and natural prefixes never broaden the submission cap", () => {
  assert.deepEqual(plan("Go and apply to three support jobs"), {kind:"jobs",action:"submit",maxApplications:3});
  assert.equal(parsePcIntent("Apply to zero jobs")?.type, "clarify");
  assert.equal(parsePcIntent("Apply to jobs without submitting")?.type, "clarify");
});
test("timestamps do not impersonate HTTP quota failures", () => {
  assert.equal(refusal("21:18:07.429880Z workspace routing discovery failed"), "unavailable");
  assert.equal(refusal("HTTP 429 Too Many Requests"), "quota");
  assert.equal(refusal("status: 401"), "authentication");
});

test("a valid no-tool permission refusal falls back, but a possibly acted-on run does not", () => {
  const scope=plan("In my assistant workspace, create a note");
  const refused=emptyReport("needs_input","This session has read-only permissions.");
  assert.equal(canFallback(reportedRun(refused,scope,false)),true);
  assert.equal(canFallback(reportedRun(refused,scope,true)),false);
});

test('both engines receive native MCP tools while retaining platform sandbox controls',()=>{
 const settings={server:'https://example.com',token:'test',jobsDir:'.',claudeBin:'claude',codexBin:'codex',windowsMcpCommand:'C:/private/windows-mcp.exe'};
 const native=plan('On my PC, execute this task: open Excel');
 const statuses=agentStatuses(settings,{},0);
 assert.deepEqual(chooseAgents(native,statuses),['claude-computer','codex-computer']);
 assert.deepEqual(chooseAgents(plan('In my Chrome, execute this task: edit the spreadsheet'),statuses),['claude-chrome','claude-computer','codex-computer']);
 const args=claudeArgs(native,settings);assert.ok(args.includes('--mcp-config'));assert.match(args.join(' '),/jarvis-windows/);assert.match(args.join(' '),/ANONYMIZED_TELEMETRY/);assert.ok(!args.includes('--dangerously-skip-permissions'));
 assert.match(codexArgs(settings,true).join(' '),/mcp_servers.jarvis-windows.command/);assert.ok(codexArgs(settings,true).includes('workspace-write'));
 assert.ok(codexArgs(settings,true).includes('mcp_servers.jarvis-windows.required=true'));
 assert.ok(codexArgs(settings,true).includes('approval_policy="on-request"'));
 assert.ok(codexArgs(settings,true).includes('approvals_reviewer="auto_review"'));
 assert.ok(!codexArgs(settings,true).includes('approval_policy="never"'));
 assert.ok(codexArgs(settings).includes('approval_policy="never"'));
 assert.ok(!codexArgs(settings).includes('approvals_reviewer="auto_review"'));
 assert.match(promptFor({id:'test',workerId:'worker',lease:'lease',plan:native,request:'Open Excel'}),/Computer action mode/);
 assert.match(promptFor({id:'test',workerId:'worker',lease:'lease',plan:plan('In my Chrome, execute this task: edit the spreadsheet'),request:'Edit the spreadsheet'}),/Browser action mode/);
});
test('Codex browser jobs use Chrome directly without desktop tools; workspace stays isolated',()=>{
 const settings={server:'https://example.com',token:'test',jobsDir:'.',claudeBin:'C:/private/claude.exe',codexBin:'codex',windowsMcpCommand:'windows-mcp'};
 const browser=codexArgs(settings,true,true);
 assert.ok(browser.includes('mcp_servers.jarvis-chrome.command="C:/private/claude.exe"'));
 assert.ok(browser.includes('mcp_servers.jarvis-chrome.args=["--claude-in-chrome-mcp"]'));
 assert.ok(browser.includes('mcp_servers.jarvis-chrome.required=true'));
 assert.ok(!browser.join(' ').includes('jarvis-windows'));
 const tools=JSON.parse(browser.find(a=>a.startsWith('mcp_servers.jarvis-chrome.enabled_tools='))!.split('=')[1]!);
 for(const name of ['tabs_context_mcp','navigate','form_input','file_upload'])assert.ok(tools.includes(name));
 assert.ok(!tools.includes('javascript_tool'));
 assert.ok(browser.includes('approvals_reviewer="auto_review"'));
 assert.ok(browser.includes('workspace-write'));
 assert.ok(!codexArgs(settings,true).join(' ').includes('jarvis-chrome'));
 assert.ok(!codexArgs(settings).join(' ').includes('mcp_servers.'));
 const noWindows={...settings,windowsMcpCommand:undefined};
 assert.ok(chooseAgents(plan('In my Chrome, find AWS docs'),agentStatuses(noWindows,{},0)).includes('codex-computer'));
 assert.ok(!chooseAgents(plan('On my PC, execute this task: open Excel'),agentStatuses(noWindows,{},0)).includes('codex-computer'));
 const noChrome={...settings,claudeBin:undefined};
 assert.ok(!chooseAgents(plan('In my Chrome, find AWS docs'),agentStatuses(noChrome,{},0)).includes('codex-computer'));
 assert.ok(chooseAgents(plan('On my PC, execute this task: open Excel'),agentStatuses(noChrome,{},0)).includes('codex-computer'));
});
test('Codex uses the private upload controller with connected resume folders',()=>{
 const settings={server:'https://example.com',token:'test',jobsDir:'C:/jobs',claudeBin:'C:/private/claude.exe',chromeMcpPython:'C:/private/python.exe'};
 const config=codexArgs(settings,true,true);
 assert.ok(config.includes('mcp_servers.jarvis-chrome.command="C:/private/python.exe"'));
 const encoded=config.find(arg=>arg.startsWith('mcp_servers.jarvis-chrome.args='))!;
 const args:string[]=JSON.parse(encoded.slice(encoded.indexOf('=')+1));
 assert.match(args[0]!,/chrome_bridge.py$/);
 assert.equal(args[args.indexOf('--claude-bin')+1],settings.claudeBin);
 assert.equal(args.filter(arg=>arg==='--upload-root').length,2);
 assert.match(args.join(' '),/Resumes/);
 assert.match(args.join(' '),/documents[\\/]cv/);
 assert.ok(!args.includes('--dangerously-skip-permissions'));
 assert.match(jobPrompt('Apply to one job',1,'submit'),/visible interactive CAPTCHA challenge/);
});
test('old workers cannot claim native actions; new capability claims validate',async()=>withDir(async dir=>{
 const task=await enqueuePcTask(dir,'On my PC, execute this task: open Excel');
 assert.equal(await claimNextPcTask(dir,'old',agents),undefined);assert.equal((await readPcTasks(dir)).tasks[0]?.status,'queued');
 const desktop:ExecutorStatus[]=[{id:'claude-computer',capabilities:['computer'],features:['personal-tools-v1'],state:'ready',reason:'',remainingTokens:null}];
 const claimed=(await claimNextPcTask(dir,'new',desktop))!;assert.equal(claimed.id,task.id);assert.equal(validateClaim(claimed,'new').id,task.id);
}));

test("report-only Claude refusal falls back while real browser actions block retry", () => {
 const scope=plan("Apply to 1 support jobs");
 const refused=emptyReport("needs_input","Provider unavailable before actions");
 for(const names of [["StructuredOutput"],["ToolSearch","StructuredOutput"]]) {
  assert.equal(canFallback(reportedRun(refused,scope,names.some(mayHaveActed))),true);
 }
 for(const names of [["mcp__claude-in-chrome__computer","StructuredOutput"],["Bash"],["Write"],["UnrecognizedTool"]]) {
  assert.equal(canFallback(reportedRun(refused,scope,names.some(mayHaveActed))),false);
 }
});

test('execution hands unfinished code to the next provider with a saved checkpoint and existing files',async()=>withDir(async dir=>{
 const {execute}=await import('./worker.ts');
 const state=await readState(dir),savedFetch=globalThis.fetch;
 const settings={server:'https://example.com',token:'test',jobsDir:dir,claudeBin:'claude',codexBin:'codex',workspaces:{assistant:dir}};
 const task={id:randomUUID(),lease:randomUUID(),workerId:state.workerId,request:'In my assistant workspace, update the project',plan:plan('In my assistant workspace, update the project')};
 const calls:string[]=[],checkpoints:unknown[]=[];
 // This starts Claude, then models a genuine quota exit after a local edit.
 state.cooldowns['codex-local']={until:Date.now()+60000,reason:'test initially prefers Claude'};
 globalThis.fetch=async()=>Response.json({cancelRequested:false});
 try{
  const result=await execute(settings,state,task,{heartbeatMs:1,refresh:async()=>{},persist:async(_root,s)=>{checkpoints.push(structuredClone(s.checkpoint));},run:async(id,_settings,_task,_signal,progress,_diagnostic,_limits,continuation)=>{
   calls.push(id);
   if(id==='claude-files'){
    await writeFile(join(dir,'completed-work.txt'),'preserve this');progress('Writing a file');
    delete state.cooldowns['codex-local'];
    return {report:emptyReport('needs_input','Usage limit reached'),failure:'quota',safeToRetry:false};
   }
   assert.match(continuation!,/claude-files/);assert.match(continuation!,/Writing a file/);
   assert.equal(await readFile(join(dir,'completed-work.txt'),'utf8'),'preserve this');
   return {report:{...emptyReport('completed','Finished remaining checks'),evidence:[{action:'verified',target:dir,detail:'Existing edit preserved and checks finished'}]},safeToRetry:false};
  }});
  // Candidates must be re-evaluated after the quota exit, not fixed before Claude ran.
  assert.deepEqual(calls,['claude-files','codex-local']);assert.equal(result.outcome,'completed');assert.ok(checkpoints.some(Boolean));
 }finally{globalThis.fetch=savedFetch;}
}));
