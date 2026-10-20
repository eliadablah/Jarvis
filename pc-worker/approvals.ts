import {createHash,randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import type {WorkerSettings,ClaimedTask} from "./agents.ts";
function scrub(value:unknown):unknown {
 if(typeof value==="string")return value.replace(/Bearer\s+\S+/gi,"Bearer [redacted]").replace(/(?:sk-|fc-|ghp_)[A-Za-z0-9_-]{12,}/g,"[redacted]").replace(/((?:password|token|api[_-]?key|secret)\s*[=:]\s*)[^\s,;]+/gi,"$1[redacted]");
 if(Array.isArray(value))return value.map(scrub);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/password|secret|token|authorization|api[_-]?key/i.test(k)?"[redacted]":scrub(v)]));return value;
}
export function approvalDescription(value:unknown):string {const text=JSON.stringify(scrub(value),null,2);if(!text||text.length>12000)throw Error("Approval details exceed the review limit; request a smaller action.");return text;}
export async function askDashboard(settings:WorkerSettings,task:ClaimedTask,provider:"claude"|"codex",tool:string,input:unknown,signal:AbortSignal,progress:(s:string)=>void):Promise<{allow:boolean;answer?:string}>{
 const id=randomUUID(),details=approvalDescription(input),fingerprint=createHash("sha256").update(JSON.stringify({tool,input})).digest("hex");
 const endpoint=new URL("/api/pc/tasks/"+task.id+"/approval",settings.server);
 const send=async(body:unknown)=>{const response=await fetch(endpoint,{method:"POST",headers:{Authorization:"Bearer "+settings.token,"Content-Type":"application/json"},body:JSON.stringify({protocol:2,workerId:task.workerId,lease:task.lease,...body as object}),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),redirect:"error"});if(!response.ok)throw Error("Approval relay returned HTTP "+response.status+". No permission was granted.");return (await response.json()).approval;};
 await send({request:{id,provider,tool,details,fingerprint}});progress("Waiting for your approval in PC activity: "+tool.slice(0,100));
 const deadline=Date.now()+15*60000;
 while(!signal.aborted&&Date.now()<deadline){const row=await send({approvalId:id});if(row.decision)return {allow:row.decision==="allow",answer:row.answer};await delay(1500,undefined,{signal});}
 return {allow:false};
}
