import {mkdir,readFile,readdir,writeFile,rename,unlink} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
import type {WorkerSettings,ClaimedTask} from "./agents.ts";
export interface ReceiptInput {company:string;role:string;url:string;confirmation:string}
export async function queueReceipt(dir:string,taskId:string,value:ReceiptInput){
 if(!/^[a-f0-9-]{36}$/i.test(taskId))throw Error("Submission task identity is missing.");
 const out=join(dir,"submission-outbox");await mkdir(out,{recursive:true});
 const id=createHash("sha256").update(taskId+"\n"+value.url).digest("hex");
 const file=join(out,id+".json");const temp=file+".tmp";
 await writeFile(temp,JSON.stringify({taskId,...value,confirmedAt:new Date().toISOString()}),{mode:0o600});await rename(temp,file);
}
export async function flushReceipts(dir:string,settings:WorkerSettings,task:ClaimedTask):Promise<void>{
 const out=join(dir,"submission-outbox");let files:string[];try{files=await readdir(out);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return;throw e;}
 for(const file of files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).slice(0,100)){
  const path=join(out,file);let value;try{value=JSON.parse(await readFile(path,"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")continue;throw e;}
  if(value.taskId!==task.id)continue;
  const r=await fetch(new URL("/api/pc/tasks/"+task.id+"/submission",settings.server),{method:"POST",headers:{Authorization:"Bearer "+settings.token,"Content-Type":"application/json"},body:JSON.stringify({protocol:2,workerId:task.workerId,lease:task.lease,submission:value}),redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error("Submission saved locally; Jarvis sync returned HTTP "+r.status+".");
  await unlink(path).catch(()=>{});
 }
}
