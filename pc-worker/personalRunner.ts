import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {pathToFileURL} from "node:url";
import {APPROVED_PERSONAL_TOOLS,claudeArgs,codexArgs,codexEnvironment,reportedRun,refusal,stopTree,type AgentRun,type WorkerSettings,type ClaimedTask} from "./agents.ts";
import {emptyReport,REPORT_SCHEMA,type AgentLimits} from "../app/src/pcTasks/protocol.ts";
import {claudeLimitsFromEvent} from "./limits.ts";
import {describeStep} from "./steps.ts";
import {askDashboard,approvalDescription} from "./approvals.ts";
import {claudePermission,codexPermission,elicitationPermission,type AskPermission} from "./permissionProtocol.ts";

export function personalClaudeOptions(settings:WorkerSettings,task:ClaimedTask,cwd:string,controller:AbortController,ask:AskPermission,nativeAgent=false){
 const args=claudeArgs(task.plan,settings,nativeAgent,task.id,"personal");const config=args.indexOf("--mcp-config");
 return {cwd,pathToClaudeCodeExecutable:settings.claudeBin,settingSources:["user","project","local"],
  systemPrompt:{type:"preset",preset:"claude_code"},settings:{permissions:{allow:APPROVED_PERSONAL_TOOLS}},
  outputFormat:{type:"json_schema",schema:REPORT_SCHEMA},abortController:controller,
  additionalDirectories:[join(homedir(),"Desktop","Resumes")],extraArgs:{chrome:null},
  ...(config>=0?{mcpServers:JSON.parse(args[config+1]!).mcpServers}:{}),
  env:{...process.env,CLAUDE_CODE_OAUTH_TOKEN:undefined,PC_WORKER_TOKEN:undefined},
  canUseTool:(name:string,input:Record<string,any>)=>claudePermission(name,input,ask),
  onElicitation:(request:Record<string,any>)=>elicitationPermission(request,ask)};
}

export async function runPersonal(id:string,settings:WorkerSettings,task:ClaimedTask,signal:AbortSignal,progress:(s:string)=>void,prompt:string,cwd:string,onLimits?:(v:AgentLimits)=>void):Promise<AgentRun>{
 const provider=id.startsWith("codex-")?"codex":"claude",controller=new AbortController();
 const abort=()=>controller.abort();signal.addEventListener("abort",abort,{once:true});if(signal.aborted)controller.abort();
 const timer=setTimeout(abort,2*60*60000);
 let touched=false,completed=false,candidate:unknown,reason="The provider did not return a verified report.";
 const ask:AskPermission=async(tool,input)=>{try{return await askDashboard(settings,task,provider,tool,input,controller.signal,progress);}catch(e){reason=e instanceof Error?e.message:"Approval connection failed.";return {allow:false};}};
 try{
  controller.signal.throwIfAborted();
  if(provider==="claude"){
   const root=join(homedir(),".jarvis","claude-sdk","node_modules","@anthropic-ai","claude-agent-sdk");
   const manifest=JSON.parse(await readFile(join(root,"package.json"),"utf8"));if(manifest.version!=="0.3.304")throw Error("Run activate-job-files.ps1 to install the pinned Claude SDK.");
   const sdk=await import(pathToFileURL(join(root,"sdk.mjs")).href);
   const query=sdk.query({prompt,options:personalClaudeOptions(settings,task,cwd,controller,ask,id==="claude-computer")});
   try{for await(const e of query){
    const reading=claudeLimitsFromEvent(e);if(reading)onLimits?.(reading);
    if(e.type==="assistant"&&e.message?.content?.some((c:any)=>c.type==="tool_use"&&!["ToolSearch","StructuredOutput"].includes(c.name)))touched=true;
    const step=describeStep(e);if(step)progress(step);
    if(e.type==="result"){completed=!e.is_error;candidate=e.structured_output;if(!candidate&&typeof e.result==="string"){try{candidate=JSON.parse(e.result);}catch{reason=e.result;}}}
   }}finally{query.close();}
  }else{
   const result=await runCodexSession(settings,task,cwd,prompt,controller.signal,progress,ask);
   touched=result.touched;completed=result.completed;candidate=result.candidate;reason=result.reason;
  }
  if(signal.aborted)return {report:emptyReport("cancelled","Task stopped. Check already completed actions before retrying."),safeToRetry:false};
  if(completed){try{return reportedRun(candidate,task.plan,touched);}catch{reason="The provider returned an invalid structured report. Review its actions before retrying.";}}
 }catch(e){reason=e instanceof Error?e.message:"Personal tool runner failed.";}
 finally{clearTimeout(timer);signal.removeEventListener("abort",abort);}
 const safeReason=approvalDescription(reason).slice(0,1200);
 return {report:emptyReport("needs_input",provider+": "+safeReason),failure:refusal(reason),safeToRetry:!touched};
}

export async function runCodexSession(settings:WorkerSettings,task:ClaimedTask,cwd:string,prompt:string,signal:AbortSignal,progress:(s:string)=>void,ask:AskPermission,launch:typeof spawn=spawn){
 signal.throwIfAborted();
 const computer=task.plan.kind!=="workspace",browser=task.plan.kind==="browser"||task.plan.kind==="jobs";
 const original=codexArgs(settings,computer,browser,task.plan.kind==="jobs",task.plan.kind==="jobs"?task.plan.action:"search",task.id,"personal");
 const mcp=original.slice(1,original.indexOf("--skip-git-repo-check"));
 const child=launch(settings.codexBin!,["app-server","--listen","stdio://",...mcp],{cwd,windowsHide:true,detached:process.platform!=="win32",stdio:["pipe","pipe","pipe"],env:{...process.env,...codexEnvironment(settings,"personal"),PC_WORKER_TOKEN:undefined,CLAUDE_CODE_OAUTH_TOKEN:undefined}});
 let sequence=0,touched=false,completed=false,candidate:unknown,reason="Codex stopped before returning a report.",closed=false;
 const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
 const send=(value:unknown)=>{if(!closed)child.stdin.write(JSON.stringify(value)+"\n");};
 const rpc=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});send({id,method,params});});
 let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});
 const stop=()=>{void stopTree(child);};signal.addEventListener("abort",stop,{once:true});
 const fail=(message:string)=>{reason=message;for(const entry of pending.values())entry.reject(Error(message));pending.clear();finish();};
 child.once("error",(e:NodeJS.ErrnoException)=>fail("Could not start Codex app-server ("+(e.code??"launch error")+")."));
 child.once("close",()=>{closed=true;fail(reason);});
 child.stderr.on("data",chunk=>{reason=(reason+" "+String(chunk)).slice(-1600);});
 child.stdin.on("error",()=>fail("Codex input connection closed."));
 const items=new Map<string,unknown>();
 const lines=createInterface({input:child.stdout});
 const pump=(async()=>{for await(const line of lines){
  let e:any;try{e=JSON.parse(line);}catch{continue;}
  if(e.id!==undefined&&e.method){
   const params={...e.params,...(e.params?.itemId&&items.has(e.params.itemId)?{proposedItem:items.get(e.params.itemId)}:{})};
   void codexPermission(e.method,params,ask).then(result=>send({id:e.id,result})).catch(()=>send({id:e.id,error:{code:-32601,message:"Unsupported request or approval unavailable; no action approved."}}));continue;
  }
  if(e.id!==undefined){const waiter=pending.get(e.id);if(waiter){pending.delete(e.id);if(e.error)waiter.reject(Error(String(e.error.message??"Codex request failed")));else waiter.resolve(e.result);}continue;}
  if(e.method==="item/started"||e.method==="item/completed"){
   const item=e.params?.item;if(item?.id)items.set(item.id,item);
   if(item&&!['agentMessage','reasoning'].includes(item.type)){touched=true;progress("Codex is using "+String(item.type).slice(0,60)+".");}
   if(e.method==="item/completed"&&item?.type==="agentMessage"){try{candidate=JSON.parse(item.text);}catch{}}
  }
  if(e.method==="turn/completed"){completed=e.params?.turn?.status==="completed";if(e.params?.turn?.error)reason=String(e.params.turn.error.message??"Codex turn failed.");finish();}
 }} )();
 try{
  await rpc("initialize",{clientInfo:{name:"jarvis",title:"Jarvis",version:"0.2.0"},capabilities:{experimentalApi:true}});send({method:"initialized",params:{}});
  const thread=await rpc("thread/start",{cwd,ephemeral:true});
  await rpc("turn/start",{threadId:thread.thread.id,input:[{type:"text",text:prompt}],outputSchema:REPORT_SCHEMA});
  await done;return {touched,completed,candidate,reason};
 }finally{signal.removeEventListener("abort",stop);await stopTree(child);lines.close();await pump.catch(()=>{});}
}
