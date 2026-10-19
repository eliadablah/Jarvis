// GET /api/jobs: my job tracker (Google Sheet) as JSON for the dashboard's
// Job search section. Read-only; errors are short messages with no
// credentials, sheet IDs, or Google response bodies.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config.ts";
import { appHeaders } from "../http/securityHeaders.ts";
import { TrackerReader, summarize,sortJobs,chicagoDate,type TrackerSnapshot,type TrackerJob } from "./tracker.ts";
import {readSubmissions,markSynced,applicationKey} from "./submissions.ts";
import {dashboardDir} from "../dashboard.ts";
import {publishUpdate} from "../live.ts";

const readers = new WeakMap<AppConfig, TrackerReader>();
const refreshTimes=new WeakMap<TrackerReader,number>();

function readerFor(config: AppConfig): TrackerReader {
  let reader = readers.get(config);
  if (!reader) { reader = new TrackerReader(config.jobTracker); readers.set(config, reader); }
  return reader;
}

function json(res: ServerResponse, status: number, value: unknown, head: boolean): void {
  res.writeHead(status, { ...appHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(head ? undefined : JSON.stringify(value));
}

export async function handleJobs(req: IncomingMessage, res: ServerResponse, config: AppConfig): Promise<void> {
  const method = req.method ?? "GET";
  const head = method === "HEAD";
  if (method !== "GET" && !head) { json(res, 405, { error: "Method not allowed" }, false); return; }
  const reader = readerFor(config);
  if (!reader.enabled) { json(res, 200, { enabled: false }, head); return; }
  try {
    const journal=await readSubmissions(dashboardDir(config));
    const fresh=new URL(req.url??"/api/jobs","http://localhost").searchParams.get("fresh")==="1";
    const pendingReceipts=journal.some(row=>row.sync!=="synced");
    let snapshot:TrackerSnapshot;
    if(fresh && pendingReceipts){
      snapshot=reader.cachedSnapshot??{summary:summarize([]),jobs:[],updatedAt:new Date().toISOString(),stale:true};
      if(Date.now()-(refreshTimes.get(reader)??0)>5000){refreshTimes.set(reader,Date.now());void reader.snapshot(true).then(()=>publishUpdate("jobs")).catch(()=>{});}
    }else snapshot=await reader.snapshot(fresh);
    const pending=journal.filter(row=>row.sync!=="synced");
    const missing=[];
    for(const row of pending){const sheetRow=snapshot.jobs.find(j=>j.url&&applicationKey(j.url)===applicationKey(row.url)&&["submitted","recruiter contact","interview scheduled","interviewed","offer"].includes(j.stage.toLowerCase()));if(sheetRow&&!snapshot.stale)await markSynced(dashboardDir(config),row.id);else missing.push(row);}
    const merged=mergeSubmissionView(snapshot,missing);
    json(res, 200, { enabled: true, sheetUrl: "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(config.jobTracker.sheetId) + "/edit", ...merged,pendingGoogleSync:missing.length,syncMessage:missing.length?"Verified receipts saved in Jarvis; Google sync pending approval/connection.":"" }, head);
  } catch (error) {
    console.error("job tracker read failed:", error instanceof Error ? error.message : "unknown");
    const rows=await readSubmissions(dashboardDir(config));
    const empty:TrackerSnapshot={summary:summarize([]),jobs:[],updatedAt:new Date().toISOString(),stale:true};
    json(res, 200, { enabled: true, ...mergeSubmissionView(empty,rows),pendingGoogleSync:rows.filter(r=>r.sync!=="synced").length,trackerUnavailable:true,error:"Google tracker is unavailable. Showing saved Jarvis submission receipts only." }, head);
  }
}
export function mergeSubmissionView(snapshot:TrackerSnapshot,receipts:Awaited<ReturnType<typeof readSubmissions>>):TrackerSnapshot{
 const jobs=[...snapshot.jobs];const summary={...snapshot.summary};
 for(const receipt of receipts){
  const index=jobs.findIndex(j=>j.url&&applicationKey(j.url)===applicationKey(receipt.url));
  const old=index>=0?jobs[index]:undefined;const date=chicagoDate(new Date(receipt.at));
  const row:TrackerJob={company:receipt.company,role:receipt.role,pay:old?.pay??"",location:old?.location??"",stage:"Submitted",applied:old?.applied||date,updated:date,nextStep:receipt.sync==="synced"?"Wait for response":"Google sync pending",via:"Jarvis",url:receipt.url};
  const before=summarize(old?[old]:[]),after=summarize([row]);
  for(const key of Object.keys(summary) as (keyof typeof summary)[])summary[key]+=after[key]-before[key];
  if(index>=0)jobs[index]=row;else jobs.unshift(row);
 }
 return {...snapshot,summary,jobs:sortJobs(jobs).slice(0,60)};
}
