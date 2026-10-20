import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { enqueuePcTask, claimNextPcTask, finishPcTask, retryPcTask } from "../src/pcTasks/store.ts";
import { parsePcIntent } from "../src/pcTasks/intent.ts";
import { handlePcTasks } from "../src/pcTasks/api.ts";
import { loadConfig } from "../src/config.ts";
// @ts-ignore Browser module is exercised as JavaScript by Node's test runner.
import { failureMessage, canRetryTask } from "../public/pcActivity.js";
test("explicit retries are idempotent and submit only the remaining count",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jarvis-retry-"));
 try{
  const task=await enqueuePcTask(dir,"Apply to 4 job applications. Remote support only.");
  await assert.rejects(retryPcTask(dir,task.id));
  const worker=randomUUID();
  assert.equal(await claimNextPcTask(dir,worker,[{id:"codex-computer",state:"ready",reason:"ready",remainingTokens:null,capabilities:["jobs"]}]),undefined,"new submissions wait for receipt-capable workers");
  const claim=await claimNextPcTask(dir,worker,[{id:"codex-computer",state:"ready",reason:"ready",remainingTokens:null,capabilities:["jobs"],features:["job-files-v1","task-sync-v1","personal-tools-v1"]}]);
  await finishPcTask(dir,task.id,worker,claim!.lease!,randomUUID(),{outcome:"partial",summary:"One done, three remain",submitted:1,needsInput:[],evidence:[{action:"submitted",target:"https://example.com/job/1",detail:"Confirmation seen"}]});
  const [a,b]=await Promise.all([retryPcTask(dir,task.id),retryPcTask(dir,task.id)]);
  assert.equal(a!.id,b!.id);assert.deepEqual(a!.plan,{kind:"jobs",action:"submit",maxApplications:3});
  assert.deepEqual(parsePcIntent(a!.request),{type:"task",plan:a!.plan});
  assert.match(a!.request,/Remote support only/);assert.match(a!.request,/Skip completed actions/);
  assert.equal(await claimNextPcTask(dir,worker,[{id:"codex-computer",state:"ready",reason:"ready",remainingTokens:null,capabilities:["jobs"]}]),undefined);
  const updated=await claimNextPcTask(dir,worker,[{id:"codex-computer",state:"ready",reason:"ready",remainingTokens:null,capabilities:["jobs"],features:["job-files-v1","task-sync-v1","personal-tools-v1"]}]);
  assert.equal(updated!.id,a!.id);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("failure reason is visible and uncertain/active tasks cannot show Retry",()=>{
 const t={plan:{kind:"jobs",action:"submit",maxApplications:4},status:"needs_input",report:{submitted:0,summary:"Stopped",needsInput:["Missing local file reader"],evidence:[]}};
 assert.equal(failureMessage(t),"Missing local file reader");assert.equal(canRetryTask(t),true);
 for(const status of ["running","queued","needs_attention","completed"])assert.equal(canRetryTask({...t,status}),false);
 assert.equal(canRetryTask({...t,retryTaskId:"new"}),false);
});
test("retry API rejects cross-origin requests and missing headers",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jarvis-retry-api-"));const prior=process.env.JARVIS_DATA_DIR;process.env.JARVIS_DATA_DIR=dir;
 const config=loadConfig({PC_WORKER_TOKEN:"test"});
 const server=createServer((req,res)=>{void handlePcTasks(req,res,new URL(req.url!,"http://localhost").pathname,config);});
 try{
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const addr=server.address();assert.ok(addr&&typeof addr==="object");
  const url="http://127.0.0.1:"+addr.port+"/api/pc/tasks/"+randomUUID()+"/retry";
  assert.equal((await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status,403);
  assert.equal((await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-jarvis-chat":"1",Origin:"https://evil.example"},body:"{}"})).status,403);
  const task=await enqueuePcTask(dir,"Find jobs");const worker=randomUUID();
  const claim=await claimNextPcTask(dir,worker,[{id:"codex-computer",state:"ready",reason:"ready",remainingTokens:null,capabilities:["jobs"],features:["personal-tools-v1"]}]);
  await finishPcTask(dir,task.id,worker,claim!.lease!,randomUUID(),{outcome:"needs_input",summary:"Missing local file reader",submitted:0,needsInput:[],evidence:[]});
  const retryUrl="http://127.0.0.1:"+addr.port+"/api/pc/tasks/"+task.id+"/retry";
  const options={method:"POST",headers:{"Content-Type":"application/json","x-jarvis-chat":"1"},body:"{}"};
  const first=await fetch(retryUrl,options);assert.equal(first.status,200);const created=await first.json();
  const duplicate=await (await fetch(retryUrl,options)).json();assert.equal(created.task.id,duplicate.task.id);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(prior===undefined)delete process.env.JARVIS_DATA_DIR;else process.env.JARVIS_DATA_DIR=prior;await rm(dir,{recursive:true,force:true});}
});
