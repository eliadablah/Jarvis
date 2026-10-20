import {mkdir,readFile,writeFile,rename} from "node:fs/promises";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {publishUpdate} from "../live.ts";
export interface Submission {id:string;taskId:string;company:string;role:string;url:string;confirmation:string;at:string;sync:"pending"|"synced";error?:string;attempts?:number;retryAt?:number}
export function applicationKey(url:string):string {const u=new URL(url);u.hash="";for(const key of [...u.searchParams.keys()])if(/^utm_|^ref$/i.test(key))u.searchParams.delete(key);return u.href.replace(/\/$/,"");}
export function submissionId(taskId:string,url:string):string{return createHash("sha256").update(taskId+"\n"+applicationKey(url)).digest("hex");}
export async function readSubmissions(dir:string):Promise<Submission[]>{try{const rows=JSON.parse(await readFile(join(dir,"submissions.json"),"utf8"));if(!Array.isArray(rows))throw Error("Invalid submission journal");return rows;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}}
const locks=new Map<string,Promise<unknown>>();
async function change<T>(dir:string,fn:(rows:Submission[])=>T|Promise<T>):Promise<T>{
 const run=async()=>{const rows=await readSubmissions(dir);const result=await fn(rows);await mkdir(dir,{recursive:true});const temp=join(dir,"submissions-"+randomUUID()+".tmp");await writeFile(temp,JSON.stringify(rows),{mode:0o600});await rename(temp,join(dir,"submissions.json"));return result;};
 const p=(locks.get(dir)??Promise.resolve()).catch(()=>{}).then(run);locks.set(dir,p);try{return await p;}finally{if(locks.get(dir)===p)locks.delete(dir);}
}
export async function recordSubmission(dir:string,taskId:string,maximum:number,value:unknown):Promise<Submission>{
 const v=value as Record<string,unknown>;
 if(!v||!["company","role","url","confirmation"].every(k=>typeof v[k]==="string" && (v[k] as string).trim() && (v[k] as string).length<=1000)||!/^https:\/\//i.test(String(v.url)))throw Error("Submission needs company, role, HTTPS URL and observed confirmation.");
 const confirmed=typeof v.confirmedAt==="string"?Date.parse(v.confirmedAt):NaN;
 const at=Number.isFinite(confirmed)&&confirmed<=Date.now()+300000&&confirmed>Date.now()-90*86400000?new Date(confirmed).toISOString():new Date().toISOString();
 const result=await change(dir,rows=>{const url=applicationKey(String(v.url));const found=rows.find(r=>applicationKey(r.url)===url);if(found)return found;if(rows.filter(r=>r.taskId===taskId).length>=maximum)throw Error("This task's authorized submission count is already reached.");const row:Submission={id:submissionId(taskId,url),taskId,company:String(v.company),role:String(v.role),url,confirmation:String(v.confirmation),at,sync:"pending"};rows.push(row);return row;});
 publishUpdate("jobs");publishUpdate("pc");return result;
}
export async function markSynced(dir:string,id:string,error?:string){await change(dir,rows=>{const row=rows.find(r=>r.id===id);if(row){row.sync=error?"pending":"synced";row.attempts=(row.attempts??0)+1;if(error){row.error=error;row.retryAt=Date.now()+Math.min(300000,30000*2**Math.min(row.attempts-1,4));}else{delete row.error;delete row.retryAt;}}});publishUpdate("jobs");}
