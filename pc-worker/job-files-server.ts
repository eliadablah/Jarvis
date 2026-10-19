import { readFile, readdir, realpath, stat, appendFile } from "node:fs/promises";
import { relative, isAbsolute, join, extname } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
export interface JobRoots { jobs: string; resumes: string; pdfRuntime?: string; allowLogWrite?: boolean }
export async function scopedJobPath(roots: JobRoots, source: unknown, path: unknown): Promise<string> {
  if ((source !== "jobs" && source !== "resumes") || typeof path !== "string" || path.length > 500 || isAbsolute(path) || path.includes(":")) throw new Error("Use a relative path inside jobs or resumes.");
  const parts = path.replace(/\\/g,"/").split("/");
  if (parts.some(p => p === ".." || (p.startsWith(".") && p !== ".agents" && p !== "."))) throw new Error("Path is not shared with this job task.");
  if (source === "jobs" && path !== "." && !/^(?:documents(?:[\\/]|$)|\.agents[\\/]skills(?:[\\/]|$)|(?:AGENTS|CLAUDE|README)\.md$|job_search_tracker\.csv$)/i.test(path)) throw new Error("Only job documents, instructions, skill files and tracker are shared.");
  const root = await realpath(roots[source]);
  const target = await realpath(join(root, path));
  const rel = relative(root,target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path resolves outside the shared folder.");
  return target;
}
export async function jobFileCall(roots: JobRoots, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "append_application_log") {
    if (!roots.allowLogWrite) throw new Error("Application logging is enabled only for an authorized submission task.");
    const {company,role,url,confirmation} = args;
    if (![company,role,url,confirmation].every(v=>typeof v === "string" && v.trim() && v.length<=1000) || !/^https:\/\/[^\s]+$/i.test(String(url))) throw new Error("Provide company, role, HTTPS application URL and observed confirmation.");
    const path=await scopedJobPath(roots,"jobs","documents/applications/log.md");
    const existing=await readFile(path,"utf8");
    if(existing.includes(String(url))) return {saved:false,alreadyLogged:true};
    await appendFile(path,"\n- "+JSON.stringify({date:new Date().toISOString(),company,role,url,confirmation})+"\n","utf8");
    return {saved:true,path:"documents/applications/log.md"};
  }
  if (!["read_text","read_pdf","list_files"].includes(name)) throw new Error("Tool is not enabled.");
  const path=await scopedJobPath(roots,args.source,args.path);
  if(name==="list_files") return {files:(await readdir(path,{withFileTypes:true})).filter(e=>!e.name.startsWith(".")).slice(0,100).map(e=>({name:e.name,directory:e.isDirectory()}))};
  const info=await stat(path);
  if(!info.isFile() || info.size>10*1024*1024) throw new Error("File is missing or exceeds 10 MB.");
  if(name==="read_pdf") {
    if(extname(path).toLowerCase()!==".pdf" || !roots.pdfRuntime) throw new Error("PDF reader is not configured for this file.");
    const module=await import(pathToFileURL(join(roots.pdfRuntime,"node_modules","pdf-parse","dist","pdf-parse","esm","index.js")).href);
    const parser=new module.PDFParse({data:new Uint8Array(await readFile(path))});
    try { const result=await parser.getText();return {text:result.text.slice(0,60000),pages:result.total,truncated:result.text.length>60000}; }
    finally {await parser.destroy();}
  }
  if(!/\.(?:md|txt|csv|json|html?|ts|js)$/i.test(path)) throw new Error("Use read_pdf for PDFs; other binary files are not exposed.");
  const text=await readFile(path,"utf8");
  const offset=typeof args.offset==="number" && Number.isInteger(args.offset) && args.offset>=0 ? args.offset : 0;
  return {text:text.slice(offset,offset+60000),nextOffset:offset+60000<text.length?offset+60000:null};
}
const fileSchema={type:"object",properties:{source:{type:"string",enum:["jobs","resumes"]},path:{type:"string"},offset:{type:"integer",minimum:0}},required:["source","path"],additionalProperties:false};
export const JOB_TOOLS=[
 {name:"read_text",description:"Read approved job instructions, application history, tracker, resume HTML or skill files. Returns bounded text with pagination.",inputSchema:fileSchema},
 {name:"read_pdf",description:"Extract actual text from an approved resume PDF.",inputSchema:fileSchema},
 {name:"list_files",description:"List the approved job documents or resume folder. Use source=resumes,path=. for resume files.",inputSchema:fileSchema},
 {name:"append_application_log",description:"Record one already verified application confirmation. Idempotent by URL. Does not submit anything.",inputSchema:{type:"object",properties:{company:{type:"string"},role:{type:"string"},url:{type:"string"},confirmation:{type:"string"}},required:["company","role","url","confirmation"],additionalProperties:false}},
];
if(import.meta.main){
 const roots={jobs:process.env.JARVIS_JOBS_ROOT!,resumes:process.env.JARVIS_RESUMES_ROOT!,pdfRuntime:process.env.JARVIS_PDF_RUNTIME,allowLogWrite:process.env.JARVIS_JOB_ACTION==="submit"};
 for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  let req;try{if(line.length>16000)throw new Error();req=JSON.parse(line);}catch{continue;}
  if(req.id===undefined)continue;
  let result;
  if(req.method==="initialize")result={protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"jarvis-job-files",version:"1.0.0"}};
  else if(req.method==="ping")result={};
  else if(req.method==="tools/list")result={tools:JOB_TOOLS.filter(t=>t.name!=="append_application_log"||roots.allowLogWrite)};
  else if(req.method==="tools/call"){
   try{result={content:[{type:"text",text:JSON.stringify(await jobFileCall(roots,req.params?.name,req.params?.arguments??{}))}]};}
   catch(e){result={isError:true,content:[{type:"text",text:e instanceof Error?e.message:"Job file operation failed."}]};}
  }else{process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:req.id,error:{code:-32601,message:"Method not supported"}})+"\n");continue;}
  process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:req.id,result})+"\n");
 }
 process.exit(0);
}
