import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scopedJobPath, jobFileCall } from "./job-files-server.ts";
import { codexArgs, jobPrompt, canRetryStartup, canFallback } from "./agents.ts";
import { emptyReport } from "../app/src/pcTasks/protocol.ts";
test("automatic retry handles transient no-action failures and stops at denied or uncertain actions",()=>{
 const run={failure:"unavailable" as const,safeToRetry:true,report:emptyReport("needs_input","Connection reset")};
 assert.equal(canRetryStartup(run),true);
 assert.equal(canRetryStartup({...run,safeToRetry:false}),false);
 assert.equal(canRetryStartup({...run,failure:"quota"}),false);
 for(const message of ["Access is denied","Could not start agent (EPERM).","MCP requires approval","approval policy is never"]){
  const blocked={...run,startupCrash:true,report:emptyReport("needs_input",message)};
  assert.equal(canRetryStartup(blocked),false);assert.equal(canFallback(blocked),false);
 }
});
test("Codex jobs receive scoped file tools; ordinary browser and workspace tasks do not",()=>{
 const s={server:"https://example.com",token:"test",jobsDir:"C:/jobs",claudeBin:"claude"};
 assert.match(codexArgs(s,true,true,true).join(" "),/jarvis-job-files.required=true/);
 assert.doesNotMatch(codexArgs(s,true,true).join(" "),/jarvis-job-files/);
 assert.doesNotMatch(codexArgs(s).join(" "),/jarvis-job-files/);
 assert.match(jobPrompt("Apply to 4 jobs",4,"submit"),/jarvis-job-files/);
});
test("job file server confines paths and logs each confirmation URL once",async()=>{
 const root=await mkdtemp(join(tmpdir(),"jarvis-job-files-"));
 try{
  const jobs=join(root,"jobs"),resumes=join(root,"resumes");
  await mkdir(join(jobs,"documents","applications"),{recursive:true});await mkdir(resumes);
  const log=join(jobs,"documents","applications","log.md");await writeFile(log,"# Applications\n");
  await writeFile(join(root,"outside.txt"),"private");
  const roots={jobs,resumes,allowLogWrite:true};
  await assert.rejects(scopedJobPath(roots,"jobs","../outside.txt"));
  await assert.rejects(scopedJobPath(roots,"jobs",".env"));
  await assert.rejects(scopedJobPath(roots,"jobs","C:/private.txt"));
  await assert.rejects(jobFileCall(roots,"shell",{}));
  await symlink(root,join(resumes,"outside"),process.platform==="win32"?"junction":"dir");
  await assert.rejects(scopedJobPath(roots,"resumes","outside/outside.txt"));
  const args={company:"Example",role:"Support",url:"https://example.com/job/1",confirmation:"Application received"};
  await assert.rejects(jobFileCall({...roots,allowLogWrite:false},"append_application_log",args));
  assert.deepEqual(await jobFileCall(roots,"append_application_log",args),{saved:true,path:"documents/applications/log.md"});
  assert.deepEqual(await jobFileCall(roots,"append_application_log",args),{saved:false,alreadyLogged:true});
  assert.equal((await readFile(log,"utf8")).match(/example.com/g)?.length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
