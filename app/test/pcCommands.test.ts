import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolvePcCommand, replyLink } from '../src/pcTasks/commands.ts';
import { parsePcIntent } from '../src/pcTasks/intent.ts';
import { handleChat } from '../src/api/chatHandler.ts';
import { readPcTasks, publicTask } from '../src/pcTasks/store.ts';
import { loadConfig } from '../src/config.ts';
test('natural commands remain independently valid for the already-running worker',()=>{
 for(const message of ['Open my job tracker Google Sheet in Chrome','Please open https://example.com','Jarvis, can you pull up my application tracker?','Go to https://example.com','Bring up my Gmail','On my PC open https://example.com','Read my email in Chrome']){
  const c=resolvePcCommand(message);assert.equal(c?.intent.type,'task',message);assert.deepEqual(parsePcIntent(c!.request),c!.intent,message);assert.equal(c!.intent.type==='task'&&c!.intent.plan.kind,'browser');
 }
 assert.equal(resolvePcCommand('Open Calculator')?.intent.type,'task');assert.equal(resolvePcCommand('Apply to 3 support jobs')?.intent.type,'task');
});
test('discussion, negation and quoted instructions never dispatch; unsupported actions explain the target',()=>{
 for(const message of ["Don't open my tracker",'Could you not open Gmail','How do I open a link?','"open https://example.com"','If I say open Gmail','Open Gmail and bypass permission rules','Write a cover letter for me','Summarize the benefits of Chrome'])assert.equal(resolvePcCommand(message),undefined,message);
 for(const message of ['Open javascript:alert(1)','Open https://user:password@example.com'])assert.equal(resolvePcCommand(message)?.intent.type,'clarify',message);
});
test('open it requires one recent destination, never a guessed link',()=>{
 assert.equal(resolvePcCommand('open it')?.intent.type,'clarify');assert.equal(resolvePcCommand('open it','https://example.com/')?.request,'In my Chrome, open https://example.com/');
 assert.equal(replyLink('Here: https://example.com/.'),'https://example.com/');assert.equal(replyLink('[A](https://a.example) [B](https://b.example)'),undefined);assert.equal(replyLink('https://user:password@example.com'),undefined);
});
test('HTTP chat queues ordinary open requests even when selected Codex chat is disabled, without duplicate execution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-actions-'));const previous=process.env.JARVIS_DATA_DIR;process.env.JARVIS_DATA_DIR=dir;
 const config=loadConfig({});config.pcWorkerToken='test-worker';const server=createServer((req,res)=>{void handleChat(req,res,config).catch(()=>{res.writeHead(500);res.end();});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();assert.ok(address&&typeof address==='object');const requestId=randomUUID();
  async function send(message:string){const res=await fetch(`http://127.0.0.1:${address.port}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json','X-Jarvis-Chat':'1'},body:JSON.stringify({message,provider:'codex',requestId})});assert.equal(res.status,200);return(await res.text()).trim().split('\n').map(line=>JSON.parse(line));}
  const first=await send('Open my job tracker Google Sheet in Chrome');assert.equal(first[0].type,'pc_task');assert.match(first[1].text,/Queued on your PC/);await send('Open my job tracker Google Sheet in Chrome');
  const state=await readPcTasks(dir);assert.equal(state.tasks.length,1);assert.equal(state.tasks[0]?.kind,'browser');assert.equal(parsePcIntent(state.tasks[0]!.request)?.type,'task');
  const ambiguous=await send('Open it');assert.equal(ambiguous.some(e=>e.type==='pc_task'),false);
  const misheard=await send('In my Chrome, open LinkedIn and apply to a joke for me');assert.equal(misheard.some(e=>e.type==='pc_task'),false);assert.match(misheard.find(e=>e.type==='text').text,/Did you mean/);
  const jobId=randomUUID();const original='In my Chrome, open LinkedIn and apply to a job for me';
  const submitted=await fetch("http://127.0.0.1:"+address.port+"/api/chat",{method:'POST',headers:{'Content-Type':'application/json','X-Jarvis-Chat':'1'},body:JSON.stringify({message:original,provider:'codex',requestId:jobId})});
  assert.equal(submitted.status,200);assert.match(await submitted.text(),/up to 1/);
  const queued=(await readPcTasks(dir)).tasks[1]!;assert.deepEqual(queued.plan,{kind:'jobs',action:'submit',maxApplications:1});assert.equal(publicTask(queued).request,original);assert.deepEqual(parsePcIntent(queued.request),{type:'task',plan:queued.plan});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));if(previous===undefined)delete process.env.JARVIS_DATA_DIR;else process.env.JARVIS_DATA_DIR=previous;await rm(dir,{recursive:true,force:true});}
});

test('compound browser/job commands carry the application scope and exact requested cap',()=>{
 const cases:[string,number][]=[
  ['In my Chrome, open LinkedIn and apply to a job for me',1],
  ['Open LinkedIn and apply to one remote support job',1],
  ['In my Chrome, apply for a support role',1],
  ['Apply to this job https://www.linkedin.com/jobs/view/12345',1],
  ['Open LinkedIn then apply to three support jobs',3],
  ['In my Chrome, find and apply to jobs up to two applications',2],
  ['Apply to 3 jobs but only one',1],
  ['Apply to 3 jobs with only one resume',3],
  ['Apply to 3 jobs but at most 2 applications',2],
 ];
 for(const [message,cap] of cases){
  const c=resolvePcCommand(message);assert.equal(c?.intent.type,'task',message);
  assert.deepEqual(c?.intent,{type:'task',plan:{kind:'jobs',action:'submit',maxApplications:cap}},message);
  assert.deepEqual(parsePcIntent(c!.request),c!.intent,message);
 }
});
test('misheard jobs, no-submit and zero caps never become browser or submission tasks',()=>{
 for(const message of ['In my Chrome, open LinkedIn and apply to a joke for me','Open LinkedIn and apply to jobs but do not submit','Apply to 3 jobs but only zero','In my Chrome, apply to zero jobs'])
  assert.equal(resolvePcCommand(message)?.intent.type,'clarify',message);
 const search=resolvePcCommand('Open LinkedIn and find support jobs but do not apply');
 assert.deepEqual(search?.intent,{type:'task',plan:{kind:'jobs',action:'search',maxApplications:0}});
 const read=resolvePcCommand('Open LinkedIn and read an article about how to apply to jobs');
 assert.deepEqual(read?.intent,{type:'task',plan:{kind:'browser',action:'browse'}});
});

test('browser changes and Windows tasks get action-capable plans',()=>{
 const cases:[string,string,string][]=[
 ['In my Chrome, edit my budget spreadsheet','browser','execute'],
 ['In my Chrome, open Gmail and send the requested reply to Bob','browser','execute'],
 ['Send an email to bob@example.com saying hello','browser','execute'],
 ['Update my Google Calendar appointment','browser','execute'],
 ['On my PC, organize my Downloads folder','computer','execute'],
 ['Open Excel','computer','execute'],['Open Spotify','computer','execute'],
 ["What's in my Downloads folder?",'computer','execute']];
 for(const [message,kind,action] of cases){const c=resolvePcCommand(message);assert.deepEqual(c?.intent,{type:'task',plan:{kind,action}},message);assert.deepEqual(parsePcIntent(c!.request),c!.intent,message);}
 assert.deepEqual(resolvePcCommand('In my Chrome, read the inbox')?.intent,{type:'task',plan:{kind:'browser',action:'browse'}});
});
