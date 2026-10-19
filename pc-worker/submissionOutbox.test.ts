import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {queueReceipt,flushReceipts} from "./submissionOutbox.ts";
test("receipt delivery survives disconnect and retries sync without resubmitting an application",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"jarvis-outbox-"));const saved=globalThis.fetch;
 const id=randomUUID();const task={id,workerId:randomUUID(),lease:randomUUID(),plan:{kind:"jobs" as const,action:"submit" as const,maxApplications:1},request:"Apply to 1 job applications"};
 const settings={server:"https://example.com",token:"secret-test",jobsDir:dir};
 try{await queueReceipt(dir,id,{company:"Example",role:"Support",url:"https://example.com/jobs/1",confirmation:"Received"});
  globalThis.fetch=async()=>new Response("unavailable",{status:503});await assert.rejects(flushReceipts(dir,settings,task));
  assert.equal((await readdir(join(dir,"submission-outbox"))).length,1);
  let posted=0;globalThis.fetch=async(_url,options)=>{posted++;const value=JSON.parse(String(options?.body));assert.equal(value.submission.taskId,id);assert.equal(value.lease,task.lease);return Response.json({accepted:true});};
  await flushReceipts(dir,settings,task);await flushReceipts(dir,settings,task);assert.equal(posted,1);assert.equal((await readdir(join(dir,"submission-outbox"))).length,0);
 }finally{globalThis.fetch=saved;await rm(dir,{recursive:true,force:true});}
});
