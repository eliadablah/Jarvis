import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {createServer} from "node:http";
import {recordSubmission,readSubmissions} from "../src/jobs/submissions.ts";
import {enqueuePcTask,claimNextPcTask,finishPcTask,retryPcTask} from "../src/pcTasks/store.ts";
import {trackerView,syncPendingReceipts} from "../src/jobs/api.ts";
import {trackerChangeCheck} from "../src/jobs/watch.ts";
import {summarize} from "../src/jobs/tracker.ts";
import {handlePcTasks} from "../src/pcTasks/api.ts";
import {loadConfig} from "../src/config.ts";
import {handleLive,publishUpdate,closeLiveClients} from "../src/live.ts";
const agents=[{id:"codex-computer",state:"ready" as const,reason:"ready",remainingTokens:null,capabilities:["jobs" as const],features:["job-files-v1" as const,"task-sync-v1" as const,"full-tools-v2" as const]}];
const receipt=(n:number)=>({company:"Example "+n,role:"Support",url:"https://example.com/jobs/"+n,confirmation:"Application received"});
test("direct requests use personal tools, scheduled profiles and retry scopes remain explicit",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jarvis-profile-"));try{
  const manual=await enqueuePcTask(dir,"Find support jobs");assert.equal(manual.toolProfile,"personal");
  const old=[{...agents[0]!,features:["job-files-v1" as const,"task-sync-v1" as const]}];
  assert.equal(await claimNextPcTask(dir,"worker",old),undefined);
  const claim=await claimNextPcTask(dir,"worker",agents);assert.equal(claim!.toolProfile,"personal");
  await finishPcTask(dir,manual.id,"worker",claim!.lease!,randomUUID(),{outcome:"needs_input",summary:"Waiting for a permitted tool",needsInput:[],evidence:[],submitted:0});
  const retry=await retryPcTask(dir,manual.id);assert.equal(retry!.toolProfile,"personal");
  const scheduled=await enqueuePcTask(dir,"Find support jobs",undefined,new Date(),"Scheduled job","scoped");assert.equal(scheduled.toolProfile,"scoped");
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("Google sync errors persist, back off, and recover without replaying the application",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jarvis-google-outbox-"));
 try{
   await recordSubmission(dir,"task",1,receipt(1));let calls=0;
   const fail={record:async()=>{calls++;throw Error("Google tracker sync returned HTTP 403. Check Editor access.");}};
   await syncPendingReceipts(dir,fail);await syncPendingReceipts(dir,fail);assert.equal(calls,1);
   const rows=await readSubmissions(dir);assert.equal(rows[0]!.sync,"pending");assert.match(rows[0]!.error!,/403/);assert.ok(rows[0]!.retryAt!>Date.now());
   rows[0]!.retryAt=0;await writeFile(join(dir,"submissions.json"),JSON.stringify(rows));
   await syncPendingReceipts(dir,{record:async()=>{calls++;}});
   await syncPendingReceipts(dir,{record:async()=>{throw Error("Already synced rows must not write again");}});
   const recovered=(await readSubmissions(dir))[0]!;assert.equal(calls,2);assert.equal(recovered.sync,"synced");assert.equal(recovered.error,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("old submission history does not fulfill a new task; retry reads only its own receipts",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jarvis-scope-"));try{
  const old=await enqueuePcTask(dir,"Apply to 5 job applications");const worker=randomUUID();const oldClaim=await claimNextPcTask(dir,worker,agents);
  for(let i=0;i<5;i++)await recordSubmission(dir,old.id,5,receipt(i));
  await finishPcTask(dir,old.id,worker,oldClaim!.lease!,randomUUID(),{outcome:"completed",summary:"Five prior jobs",submitted:5,needsInput:[],evidence:Array.from({length:5},(_,i)=>({action:"submitted",target:receipt(i).url,detail:"Confirmed"}))});
  const current=await enqueuePcTask(dir,"Apply to 4 job applications");const currentClaim=await claimNextPcTask(dir,worker,agents);
  assert.equal(currentClaim!.applicationScope!.confirmedUrls.length,0);assert.equal(currentClaim!.applicationScope!.requested,4);
  await recordSubmission(dir,current.id,4,receipt(6));
  await finishPcTask(dir,current.id,worker,currentClaim!.lease!,randomUUID(),{outcome:"needs_input",summary:"Stopped",submitted:0,needsInput:[],evidence:[]});
  const retry=await retryPcTask(dir,current.id);assert.deepEqual(retry!.plan,{kind:"jobs",action:"submit",maxApplications:3});
  const claim=await claimNextPcTask(dir,worker,agents);assert.deepEqual(claim!.applicationScope!.confirmedUrls,[receipt(6).url]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("receipt endpoint checks owner/lease, persists once and enforces the task cap",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jarvis-receipt-"));const prior=process.env.JARVIS_DATA_DIR;process.env.JARVIS_DATA_DIR=dir;
 const config=loadConfig({PC_WORKER_TOKEN:"test"});const server=createServer((req,res)=>{void handlePcTasks(req,res,new URL(req.url!,"http://localhost").pathname,config);});
 try{
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const addr=server.address();assert.ok(addr&&typeof addr==="object");
  const task=await enqueuePcTask(dir,"Apply to 1 job applications");const worker=randomUUID();const claim=await claimNextPcTask(dir,worker,agents);
  const url="http://127.0.0.1:"+addr.port+"/api/pc/tasks/"+task.id+"/submission";
  const send=(lease:string,value=receipt(1))=>fetch(url,{method:"POST",headers:{Authorization:"Bearer test","Content-Type":"application/json"},body:JSON.stringify({protocol:2,workerId:worker,lease,submission:value})});
  assert.equal((await send(randomUUID())).status,409);
  const a=await send(claim!.lease!);assert.equal(a.status,200);const first=await a.json();
  const shared=(lease:string)=>fetch(url.replace(/submission$/,"job-state"),{method:"POST",headers:{Authorization:"Bearer test","Content-Type":"application/json"},body:JSON.stringify({protocol:2,workerId:worker,lease})});
  assert.equal((await shared(randomUUID())).status,409);
  assert.equal((await shared(claim!.lease!)).status,503,"valid job owner receives explicit unconfigured tracker error");
  const duplicate=await(await send(claim!.lease!)).json();assert.equal(first.id,duplicate.id);
  assert.equal((await send(claim!.lease!,receipt(2))).status,400);assert.equal((await readSubmissions(dir)).length,1);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(prior===undefined)delete process.env.JARVIS_DATA_DIR;else process.env.JARVIS_DATA_DIR=prior;await rm(dir,{recursive:true,force:true});}
});
test("Google counts remain authoritative while pending receipts are shown separately",()=>{
 const old={company:"Example 1",role:"Support",url:receipt(1).url,stage:"Needs answer",applied:"2026-10-19",updated:"2026-10-19",nextStep:"",pay:"",location:"",via:""};
 const base={summary:summarize([old]),jobs:[old],updatedAt:new Date().toISOString()};
 const record={...receipt(1),id:"test",taskId:"test",at:new Date().toISOString(),sync:"pending" as const};
 const view=trackerView(base,[record]);
 assert.deepEqual(view.summary,base.summary);assert.deepEqual(view.jobs,base.jobs);
 assert.equal(view.pendingGoogleSync,1);assert.equal(view.pendingApplications[0]!.company,record.company);
 assert.equal(JSON.stringify(view).includes(record.confirmation),false);
 const offline=trackerView(undefined,[record]);assert.equal(offline.summary,undefined);assert.equal(offline.trackerUnavailable,true);
});
test("external sheet edits, outages and recovery publish changes but timestamps alone do not",async()=>{
 let snapshot={summary:summarize([]),jobs:[],updatedAt:new Date().toISOString(),stale:false};
 let events=0,fail=false;
 const poll=trackerChangeCheck(async()=>{if(fail)throw Error("offline");return snapshot;},()=>events++);
 await poll();assert.equal(events,1);
 snapshot={...snapshot,updatedAt:"2026-10-20T00:00:00Z"};await poll();assert.equal(events,1);
 snapshot={...snapshot,summary:{...snapshot.summary,submitted:1,total:1}};await poll();assert.equal(events,2);
 snapshot={...snapshot,stale:true};await poll();assert.equal(events,3);
 fail=true;await poll();await poll();assert.equal(events,4);
 fail=false;snapshot={...snapshot,stale:false};await poll();assert.equal(events,5);
});
test("live connection receives a pushed update without waiting for a poll",async()=>{
 const server=createServer(handleLive);const controller=new AbortController();
 try{await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const addr=server.address();assert.ok(addr&&typeof addr==="object");
  const response=await fetch("http://127.0.0.1:"+addr.port,{signal:controller.signal});assert.match(response.headers.get("content-type")!,/text\/event-stream/);
  const reader=response.body!.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/ready/);
  publishUpdate("jobs");assert.match(new TextDecoder().decode((await reader.read()).value),/jobs/);await reader.cancel();
 }finally{controller.abort();closeLiveClients();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
