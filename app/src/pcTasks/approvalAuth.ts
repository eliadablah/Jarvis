import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import type {IncomingMessage,ServerResponse} from "node:http";
const secret=randomBytes(32),sessions=new Map<string,number>(),cookie="jarvis_approval_session";
const sessionOf=(req:IncomingMessage)=>req.headers.cookie?.split(/;\s*/).find(c=>c.startsWith(cookie+"="))?.slice(cookie.length+1)??"";
type Target={id:string;lease?:string;workerId?:string;approvals?:{id:string;fingerprint:string;decision?:string;expiresAt:string}[]};
const sign=(sid:string,task:Target,id:string,fingerprint:string)=>createHmac("sha256",secret).update(JSON.stringify([sid,task.id,task.workerId,task.lease,id,fingerprint])).digest("hex");
/** Private Tailscale dashboard session, separate from worker credentials. SameSite cookie + per-action CSRF capability. */
export function approvalTokens(req:IncomingMessage,res:ServerResponse,tasks:Target[],now=Date.now()){
 for(const [id,until]of sessions)if(until<now)sessions.delete(id);
 let sid=sessionOf(req);if(!sessions.has(sid)){sid=randomBytes(32).toString("hex");if(sessions.size>=512)sessions.delete(sessions.keys().next().value!);}
 sessions.set(sid,now+30*60000);
 const secure=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host??"")?"":"; Secure";
 res.setHeader("Set-Cookie",cookie+"="+sid+"; HttpOnly; SameSite=Strict; Path=/api/pc/tasks; Max-Age=1800"+secure);
 return new Map(tasks.map(task=>[task.id,(task.approvals??[]).map(row=>({...row,...(!row.decision&&Date.parse(row.expiresAt)>now?{decisionToken:sign(sid,task,row.id,row.fingerprint)}:{})}))]));
}
export function verifyApprovalToken(req:IncomingMessage,task:Target,approvalId:string,token:unknown,now=Date.now()):boolean{
 const sid=sessionOf(req),until=sessions.get(sid);if(!until||until<now||typeof token!=="string"||!/^[a-f0-9]{64}$/.test(token))return false;
 const approval=task.approvals?.find(r=>r.id===approvalId);if(!approval||Date.parse(approval.expiresAt)<=now)return false;
 return timingSafeEqual(Buffer.from(token,"hex"),Buffer.from(sign(sid,task,approvalId,approval.fingerprint),"hex"));
}
