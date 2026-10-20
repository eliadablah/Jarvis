import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {createServer} from "node:http";
import {loadConfig} from "../src/config.ts";
import {handlePcTasks} from "../src/pcTasks/api.ts";
import {enqueuePcTask,claimNextPcTask,requestPcApproval,readPcApproval,setToolTrust,readPcTasks,decidePcApproval,cancelPcTask,finishPcTask} from "../src/pcTasks/store.ts";
import {rememberedToolConsent} from "../src/pcTasks/toolTrust.ts";
const agents=[{id:"codex-computer",state:"ready" as const,reason:"ready",remainingTokens:null,capabilities:["jobs" as const],features:["full-tools-v2" as const,"task-sync-v1" as const]}];
const details=JSON.stringify({mode:"form",message:'Allow tool "read_text"?',requestedSchema:{type:"object",properties:{}},_meta:{codex_approval_kind:"mcp_tool_call",tool_params:{source:"jobs",path:".agents/skills/linkedin-search/SKILL.md"}}});
const request=()=>({id:randomUUID(),provider:"codex" as const,tool:"MCP user input",details,fingerprint:"a".repeat(64)});
test("saved consent covers current and future tool calls, survives reload, and can be revoked",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jarvis-trust-")),worker=randomUUID();
 try{
  const task=await enqueuePcTask(dir,"Find support jobs"),claim=(await claimNextPcTask(dir,worker,agents))!;
  const pending=request();await requestPcApproval(dir,task.id,worker,claim.lease!,pending);
  assert.equal((await readPcApproval(dir,task.id,worker,claim.lease!,pending.id))?.decision,undefined);
  await setToolTrust(dir,"trusted");assert.equal((await readPcTasks(dir)).toolTrust?.mode,"trusted");
  const approved=await readPcApproval(dir,task.id,worker,claim.lease!,pending.id);assert.equal(approved?.decision,"allow");assert.equal(approved?.answer,"{}");assert.equal(approved?.decisionSource,"saved-tool-consent");
  const next=request();assert.equal((await requestPcApproval(dir,task.id,worker,claim.lease!,next))?.decision,"allow");
  assert.equal(await readPcApproval(dir,task.id,worker,randomUUID(),next.id),undefined);
  for(const [tool,input]of [["MCP user input",{mode:"url",url:"https://example.com/auth"}],["item/tool/requestUserInput",{questions:[{id:"city",question:"Which city?"}]}],["item/permissions/requestApproval",{permissions:{network:{enabled:true}}}],["item/commandExecution/requestApproval",{command:"request elevated command"}]] as const){
   const row={...request(),tool,details:JSON.stringify(input)};assert.equal((await requestPcApproval(dir,task.id,worker,claim.lease!,row))?.decision,undefined);
  }
  await setToolTrust(dir,"ask");const denied=request();await requestPcApproval(dir,task.id,worker,claim.lease!,denied);await decidePcApproval(dir,task.id,denied.id,"deny",undefined);
  await setToolTrust(dir,"trusted");assert.equal((await readPcApproval(dir,task.id,worker,claim.lease!,denied.id))?.decision,"deny");
  await setToolTrust(dir,"ask");assert.equal((await requestPcApproval(dir,task.id,worker,claim.lease!,request()))?.decision,undefined);
  await cancelPcTask(dir,task.id);assert.equal(await readPcApproval(dir,task.id,worker,claim.lease!,pending.id),undefined);
  await finishPcTask(dir,task.id,worker,claim.lease!,randomUUID(),{outcome:"cancelled",summary:"Cancelled the test task",evidence:[],needsInput:[],submitted:0});
  await setToolTrust(dir,"trusted");const future=await enqueuePcTask(dir,"Find remote help desk jobs"),nextWorker=randomUUID(),futureClaim=(await claimNextPcTask(dir,nextWorker,agents))!;
  assert.equal(futureClaim.id,future.id);assert.equal((await requestPcApproval(dir,future.id,nextWorker,futureClaim.lease!,request()))?.decisionSource,"saved-tool-consent");
  for(let index=0;index<110;index++){const row=request();await requestPcApproval(dir,future.id,nextWorker,futureClaim.lease!,row);assert.equal((await readPcApproval(dir,future.id,nextWorker,futureClaim.lease!,row.id))?.decision,"allow");}
  assert.equal((await readPcTasks(dir)).tasks.find(t=>t.id===future.id)?.approvals?.length,100,"long tasks retain a bounded decision history without repeatedly asking");
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("only an authenticated browser session with its dedicated preference capability can save trust",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jarvis-trust-api-")),previous=process.env.JARVIS_DATA_DIR;process.env.JARVIS_DATA_DIR=dir;
 const config=loadConfig({PC_WORKER_TOKEN:"private-worker"}),server=createServer((req,res)=>{void handlePcTasks(req,res,new URL(req.url!,"http://localhost").pathname,config);});
 try{
  const task=await enqueuePcTask(dir,"Find support jobs"),worker=randomUUID(),claim=(await claimNextPcTask(dir,worker,agents))!;await requestPcApproval(dir,task.id,worker,claim.lease!,request());
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();assert.ok(address&&typeof address==="object");const base="http://127.0.0.1:"+address.port;
  const snapshot=await fetch(base+"/api/pc/tasks"),cookie=snapshot.headers.get("set-cookie")!.split(";")[0]!,body=await snapshot.json();
  const post=(token:unknown,cookieValue=cookie,origin=base)=>fetch(base+"/api/pc/tasks/tool-trust",{method:"POST",headers:{"x-jarvis-chat":"1","Content-Type":"application/json",Cookie:cookieValue,Origin:origin},body:JSON.stringify({mode:"trusted",trustToken:token})});
  assert.equal((await post(body.toolTrustToken,"")).status,403);assert.equal((await post("a".repeat(64))).status,403);assert.equal((await post(body.toolTrustToken,cookie,"https://other.example")).status,403);
  assert.equal((await post(body.tasks[0].approvals[0].decisionToken)).status,403,"an action capability cannot authorize permanent trust");
  assert.equal((await post(body.toolTrustToken)).status,200);assert.equal((await readPcTasks(dir)).toolTrust?.mode,"trusted");
  assert.equal((await post(body.toolTrustToken)).status,403,"old preference capability cannot be replayed");
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));if(previous===undefined)delete process.env.JARVIS_DATA_DIR;else process.env.JARVIS_DATA_DIR=previous;await rm(dir,{recursive:true,force:true});}
});
test("remembered consent never answers auth, real forms, unknown methods or malformed requests",()=>{
 assert.equal(rememberedToolConsent({provider:"codex",tool:"MCP user input",details}),true);
 assert.equal(rememberedToolConsent({provider:"claude",tool:"Read",details:'{"file_path":"resume.pdf"}'}),true);
 for(const tool of ["AskUserQuestion","item/permissions/requestApproval","unknown/request"])assert.equal(rememberedToolConsent({provider:"claude",tool,details}),false);
 assert.equal(rememberedToolConsent({provider:"codex",tool:"MCP user input",details:JSON.stringify({mode:"form",requestedSchema:{type:"object",properties:{answer:{type:"string"}}},_meta:{codex_approval_kind:"mcp_tool_call"}})}),false);
 assert.equal(rememberedToolConsent({provider:"codex",tool:"MCP user input",details:"null"}),false);
});
