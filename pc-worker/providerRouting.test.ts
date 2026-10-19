import { test } from "node:test";
import assert from "node:assert/strict";
import { usagePressure } from "./limits.ts";
import { chooseAgents, agentStatuses } from "./agents.ts";
import type { PcLimits, AgentLimits, PcPlan } from "../app/src/pcTasks/protocol.ts";
const now=Date.parse("2026-10-19T21:00:00Z");
const reading=(five:number,week=five):AgentLimits=>({updatedAt:new Date(now).toISOString(),fiveHour:{usedPercent:five,resetsAt:now/1000+3600,minutes:300},week:{usedPercent:week,resetsAt:now/1000+86400,minutes:10080}});
const settings={server:"https://example.com",token:"test",jobsDir:".",claudeBin:"claude",codexBin:"codex",windowsMcpCommand:"windows"};
const jobs:PcPlan={kind:"jobs",action:"submit",maxApplications:4};
const pick=(limits:PcLimits,plan:PcPlan=jobs)=>chooseAgents(plan,agentStatuses(settings,{},now,limits),limits,now);
test("jobs and workspace work choose the capable provider with lower fresh usage",()=>{
 assert.equal(pick({claude:reading(60),codex:reading(20)})[0],"codex-computer");
 assert.equal(pick({claude:reading(20),codex:reading(60)})[0],"claude-chrome");
 assert.equal(pick({claude:reading(20),codex:reading(60)},{kind:"workspace",action:"execute",workspace:"jarvis"})[0],"claude-files");
 assert.equal(pick({claude:reading(10,85),codex:reading(40,30)})[0],"codex-computer");
 assert.ok(!pick({claude:reading(95),codex:reading(40)}).some(id=>id.startsWith("claude-")));
});
test("unknown, stale and expired readings are not zero; ties preserve existing adapter ordering",()=>{
 assert.equal(usagePressure(undefined,now),undefined);
 assert.equal(usagePressure({...reading(0),updatedAt:"invalid"},now),undefined);
 assert.equal(usagePressure({...reading(0),updatedAt:new Date(now-36*60000).toISOString()},now),undefined);
 assert.equal(usagePressure({updatedAt:new Date(now).toISOString(),fiveHour:{usedPercent:2,resetsAt:now/1000-1,minutes:300}},now),undefined);
 assert.equal(pick({codex:reading(60)})[0],"codex-computer");
 assert.equal(pick({claude:reading(30),codex:reading(30)})[0],"claude-chrome");
 assert.equal(pick({})[0],"claude-chrome");
 const unavailable=agentStatuses({...settings,codexBin:undefined},{},now);
 assert.equal(chooseAgents(jobs,unavailable,{claude:reading(40),codex:reading(0)},now)[0],"claude-chrome");
});
