import {test} from "node:test";
import assert from "node:assert/strict";
import {claudePermission,codexPermission,elicitationPermission} from "./permissionProtocol.ts";
import {approvalDescription} from "./approvals.ts";
import {personalClaudeOptions} from "./personalRunner.ts";
import {runCodexSession} from "./personalRunner.ts";
import {EventEmitter} from "node:events";
import {PassThrough,Writable} from "node:stream";
import type {spawn} from "node:child_process";
import {jobPrompt} from "./agents.ts";
test("personal job instructions permit configured Firecrawl while scheduled instructions remain scoped",()=>{
 const full=jobPrompt("Find jobs",0,"search","","personal");
 assert.match(full,/user approved Firecrawl search and scrape/);
 assert.doesNotMatch(full,/Firecrawl is not available|anything else is denied|no other shell command is allowed/);
 assert.match(jobPrompt("Find jobs",0,"search"),/Firecrawl is not available/);
});
test("Codex app-server pauses for a user decision and continues the same turn after Allow once",async()=>{
 let release!:(value:{allow:boolean})=>void,asked=false,acted=false;
 const child:any=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
 const emit=(event:unknown)=>child.stdout.write(JSON.stringify(event)+"\n");
 child.stdin=new Writable({write(chunk,_encoding,done){for(const line of String(chunk).trim().split("\n")){
  const e=JSON.parse(line);
  if(e.method==="initialize")queueMicrotask(()=>emit({id:e.id,result:{}}));
  if(e.method==="thread/start")queueMicrotask(()=>emit({id:e.id,result:{thread:{id:"thread"}}}));
  if(e.method==="turn/start")queueMicrotask(()=>{emit({id:e.id,result:{turn:{id:"turn"}}});emit({id:99,method:"item/commandExecution/requestApproval",params:{threadId:"thread",turnId:"turn",command:"show public docs"}});});
  if(e.id===99&&e.result){assert.deepEqual(e.result,{decision:"accept"});acted=true;queueMicrotask(()=>{emit({method:"item/completed",params:{item:{id:"answer",type:"agentMessage",text:JSON.stringify({outcome:"completed",summary:"Public docs verified",submitted:0,needsInput:[],evidence:[{action:"verified",target:"https://example.com",detail:"Read-only test"}]})}}});emit({method:"turn/completed",params:{turn:{status:"completed"}}});child.stdout.end();});}
 }done();}});
 const launch=(()=>child) as unknown as typeof spawn;
 const task={id:"task",workerId:"worker",lease:"lease",request:"Check docs",plan:{kind:"workspace" as const,action:"execute" as const,workspace:"jarvis"}};
 const running=runCodexSession({server:"https://example.com",token:"private",jobsDir:"C:/jobs",codexBin:"codex"},task,"C:/jobs","read docs",new AbortController().signal,()=>{},async()=>{asked=true;return new Promise(resolve=>{release=resolve;});},launch);
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(asked,true);assert.equal(acted,false);
 release({allow:true});const result=await running;assert.equal(acted,true);assert.equal(result.completed,true);
});
test("permission replies only allow the exact original action after a positive answer",async()=>{
 const input={command:"read public page"};let calls=0;
 const allow=async()=>{calls++;return {allow:true};},deny=async()=>({allow:false});
 assert.deepEqual(await claudePermission("Bash",input,allow),{behavior:"allow",updatedInput:input});
 assert.equal((await claudePermission("Bash",input,deny)).behavior,"deny");
 assert.deepEqual(await codexPermission("item/commandExecution/requestApproval",input,allow),{decision:"accept"});
 assert.deepEqual(await codexPermission("item/fileChange/requestApproval",input,deny),{decision:"decline"});
 const permissions={network:{enabled:true}};
 assert.deepEqual(await codexPermission("item/permissions/requestApproval",{permissions},allow),{permissions,scope:"turn"});
 assert.deepEqual(await codexPermission("item/permissions/requestApproval",{permissions},deny),{permissions:{},scope:"turn"});
 await assert.rejects(codexPermission("unknown/request",{},allow));assert.equal(calls,3);
});
test("questions require actual supplied answers rather than assuming yes",async()=>{
 const input={questions:[{question:"Which location?"}]};
 assert.equal((await claudePermission("AskUserQuestion",input,async()=>({allow:true}))).behavior,"deny");
 const answer=await claudePermission("AskUserQuestion",input,async()=>({allow:true,answer:"Dallas"}));assert.deepEqual(answer.updatedInput?.answers,{"Which location?":"Dallas"});
 assert.deepEqual(await codexPermission("item/tool/requestUserInput",{questions:[{id:"location"}]},async()=>({allow:true,answer:"Dallas"})),{answers:{location:{answers:["Dallas"]}}});
});
test("connector forms require real input and cancellation never launches a provider",async()=>{
 assert.deepEqual(await elicitationPermission({mode:"form"},async()=>({allow:true})),{action:"decline"});
 assert.deepEqual(await elicitationPermission({mode:"form"},async()=>({allow:true,answer:'{"location":"Dallas"}'})),{action:"accept",content:{location:"Dallas"}});
 assert.deepEqual(await codexPermission("mcpServer/elicitation/request",{mode:"url",url:"https://example.com/auth"},async()=>({allow:false})),{action:"decline"});
 let launched=false;const launch=(()=>{launched=true;throw Error("must not run");}) as unknown as typeof spawn;
 await assert.rejects(runCodexSession({server:"https://example.com",token:"private",jobsDir:"C:/jobs"},{id:"task",workerId:"worker",lease:"lease",request:"Check docs",plan:{kind:"workspace",action:"execute",workspace:"jarvis"}},"C:/jobs","read docs",AbortSignal.abort(),()=>{},async()=>({allow:true}),launch));
 assert.equal(launched,false);
});
test("approval previews redact credentials and reject oversized unreviewable actions",()=>{
 const text=approvalDescription({token:"private",Authorization:"Bearer abcdef",command:"curl -H 'Authorization: Bearer secretvalue'",url:"https://example.com?api_key=secret"});
 for(const secret of ["private","abcdef","secretvalue","api_key=secret"])assert.equal(text.includes(secret),false);
 assert.throws(()=>approvalDescription({command:"x".repeat(13000)}),/review limit/);
});
test("personal Claude uses inherited settings and an approval callback, with only the approved Firecrawl grants",()=>{
 const settings={server:"https://example.com",token:"private",jobsDir:"C:/jobs",claudeBin:"claude"};
 const task={id:"task",workerId:"worker",lease:"lease",request:"Find jobs",plan:{kind:"jobs" as const,action:"search" as const,maxApplications:0}};
 const options=personalClaudeOptions(settings,task,"C:/jobs",new AbortController(),async()=>({allow:false}));
 assert.deepEqual(options.settingSources,["user","project","local"]);assert.equal(typeof options.canUseTool,"function");
 assert.deepEqual(options.settings.permissions.allow,["mcp__claude_ai_Firecrawl__firecrawl_search","mcp__claude_ai_Firecrawl__firecrawl_scrape"]);
 assert.equal("permissionMode" in options,false);assert.equal("tools" in options,false);
 assert.equal(typeof options.onElicitation,"function");
 const desktop=personalClaudeOptions({...settings,windowsMcpCommand:"windows-mcp"},task,"C:/jobs",new AbortController(),async()=>({allow:false}),true);
 assert.ok(desktop.mcpServers["jarvis-windows"]);
});
