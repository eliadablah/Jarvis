import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatRouter, classifyProviderFailure, preferredProvider, requiresAccountAccess } from "../src/brain/router.ts";
import type { ChatEngine } from "../src/brain/router.ts";
import type { ChatEvent } from "../src/brain/events.ts";
import type { ChatRequest } from "../src/api/chatRequest.ts";
import { parseChatRequest } from "../src/api/chatRequest.ts";
import { buildDashboardContext } from "../src/api/chatHandler.ts";

const CLAUDE_SESSION = "11111111-2222-3333-4444-555555555555";
const CODEX_SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const signal = () => new AbortController().signal;
const automatic = (message = "hello"): ChatRequest => ({message,provider:"auto",sessionId:undefined});
async function collect(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const result: ChatEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
function fake(events: ChatEvent[], calls: (string | undefined)[] = [], enabled = true): ChatEngine {
  return {enabled, async *ask(_message, sessionId) { calls.push(sessionId); yield* events; }};
}
const success = (sessionId: string): ChatEvent[] => [{type:"text",text:"Answer"},{type:"done",sessionId}];

test("task preference routes technical work to Codex and writing to Claude", () => {
  assert.equal(preferredProvider("Debug my TypeScript code").provider, "codex");
  assert.equal(preferredProvider("Summarize my notes").provider, "claude");
  assert.equal(preferredProvider("Summarize my inbox").provider, "codex");
  assert.equal(preferredProvider("Hello").provider, "codex");
  assert.equal(preferredProvider("Apply to some DevOps jobs for me").provider, "claude");
  assert.equal(preferredProvider("Tailor my resume for this posting").provider, "claude");
});

test("automatic quota fallback is announced and resumes only the matching provider session", async () => {
  const claudeCalls: (string | undefined)[] = [], codexCalls: (string | undefined)[] = [];
  const router = new ChatRouter({
    claude:fake([{type:"error",message:"You hit your usage limit. Reset later."}],claudeCalls),
    codex:fake(success(CODEX_SESSION),codexCalls),
  });
  const result = await collect(router.answer({...automatic("Rewrite my notes"),sessions:{claude:CLAUDE_SESSION,codex:CODEX_SESSION}},signal()));
  assert.deepEqual(claudeCalls,[CLAUDE_SESSION]);
  assert.deepEqual(codexCalls,[CODEX_SESSION]);
  assert.deepEqual(result.filter(event => event.type === "engine").map(event => event.provider),["claude","codex"]);
  assert.deepEqual(result.at(-1),{type:"done",sessionId:CODEX_SESSION,provider:"codex"});
  assert.equal(result.filter(event => event.type === "error").length,0);
  assert.equal(router.status().find(status=>status.provider==="claude")?.state,"cooldown");
});

test("the next automatic request skips an exhausted provider until cooldown expires", async () => {
  let now = 1000;
  const claudeCalls: (string | undefined)[] = [];
  const router = new ChatRouter({claude:fake([{type:"error",message:"rate limit"}],claudeCalls),codex:fake(success(CODEX_SESSION))},
    {now:()=>now,quotaCooldownMs:2000});
  await collect(router.answer(automatic("Rewrite my notes"),signal()));
  await collect(router.answer(automatic("Rewrite my notes"),signal()));
  assert.equal(claudeCalls.length,1);
  assert.equal(router.status().find(status=>status.provider==="claude")?.retryAt,new Date(3000).toISOString());
  now = 3001;
  await collect(router.answer(automatic("Rewrite my notes"),signal()));
  assert.equal(claudeCalls.length,2);
});

test("never retries another provider after partial answer text", async () => {
  const codexCalls: (string | undefined)[] = [];
  const router = new ChatRouter({claude:fake([{type:"text",text:"Partial"},{type:"error",message:"usage limit"}]),codex:fake(success(CODEX_SESSION),codexCalls)});
  const result = await collect(router.answer(automatic("Draft a reply"),signal()));
  assert.equal(codexCalls.length,0);
  assert.deepEqual(result.filter(event=>event.type==="text"),[{type:"text",text:"Partial"}]);
  assert.equal(result.at(-1)?.type,"error");
});

test("manual engine stays selected and never sends legacy session to a fallback", async () => {
  const codexCalls: (string | undefined)[] = [], claudeCalls: (string | undefined)[] = [];
  const router = new ChatRouter({claude:fake(success(CLAUDE_SESSION),claudeCalls),codex:fake([{type:"error",message:"quota"}],codexCalls)});
  const result = await collect(router.answer({message:"hello",provider:"codex",sessionId:CODEX_SESSION},signal()));
  assert.deepEqual(codexCalls,[CODEX_SESSION]);
  assert.equal(claudeCalls.length,0);
  assert.equal(result.at(-1)?.type,"error");
});

test("automatic routing starts a fresh fallback when only the failed provider has a session", async () => {
  const codexCalls: (string | undefined)[] = [];
  const router = new ChatRouter({claude:fake([{type:"error",message:"usage limit"}]),codex:fake(success(CODEX_SESSION),codexCalls)});
  await collect(router.answer({...automatic("Rewrite my notes"),sessions:{claude:CLAUDE_SESSION}},signal()));
  assert.deepEqual(codexCalls,[undefined]);
});

test("disabled preferred engine uses the ready alternate and reports unknown numeric quota", async () => {
  const router = new ChatRouter({claude:fake(success(CLAUDE_SESSION)),codex:fake([],[],false)});
  const result = await collect(router.answer(automatic("Debug code"),signal()));
  assert.equal(result[0]?.type,"engine");
  assert.equal(result[0]?.type === "engine" && result[0].provider,"claude");
  assert.ok(router.status().every(status=>status.remainingTokens === null));
  assert.equal(router.status().find(status=>status.provider === "codex")?.state,"disabled");
});

test("both failures produce one safe terminal error without raw CLI diagnostics", async () => {
  const router = new ChatRouter({
    claude:fake([{type:"error",message:"usage limit sk-secret-do-not-forward"}]),
    codex:{enabled:true,async *ask() { throw new Error("Unauthorized token=do-not-forward"); }},
  });
  const result = await collect(router.answer(automatic("Rewrite my notes"),signal()));
  assert.equal(result.filter(event=>event.type==="error").length,1);
  assert.doesNotMatch(JSON.stringify(result),/do-not-forward|sk-secret/);
});

test("aborted requests do not call either provider or mark quota exhausted", async () => {
  const calls: (string | undefined)[] = [];
  const router = new ChatRouter({claude:fake([],calls),codex:fake([],calls)});
  const abort = new AbortController(); abort.abort();
  assert.deepEqual(await collect(router.answer(automatic(),abort.signal)),[{type:"error",message:"Request cancelled."}]);
  assert.equal(calls.length,0);
  assert.ok(router.status().every(status=>status.state === "ready"));
});

test("known quota and authentication errors are categorized without estimating tokens", () => {
  assert.equal(classifyProviderFailure("429 Too many requests"),"quota");
  assert.equal(classifyProviderFailure("OAuth token expired"),"authentication");
  assert.equal(classifyProviderFailure("network unavailable"),"unavailable");
});

test("account reads only use an engine with enabled account tools", async () => {
  const claudeCalls: (string | undefined)[] = [], codexCalls: (string | undefined)[] = [];
  const router = new ChatRouter({claude:fake(success(CLAUDE_SESSION),claudeCalls),
    codex:{...fake(success(CODEX_SESSION),codexCalls),accountAccess:true}});
  const result = await collect(router.answer(automatic("Read my Gmail inbox"),signal()));
  assert.deepEqual(result.at(-1),{type:"done",sessionId:CODEX_SESSION,provider:"codex"});
  assert.equal(claudeCalls.length,0);
  assert.equal(codexCalls.length,1);
});

test("account quota exhaustion does not fall back to an engine with no account access", async () => {
  const claudeCalls: (string | undefined)[] = [];
  const router = new ChatRouter({claude:fake(success(CLAUDE_SESSION),claudeCalls),
    codex:{...fake([{type:"error",message:"usage limit"}]),accountAccess:true}});
  const result = await collect(router.answer(automatic("Check my calendar"),signal()));
  assert.equal(result.at(-1)?.type,"error");
  assert.equal(claudeCalls.length,0);
});

test("an account question during Codex's cooldown explains the limit instead of blaming sign-in", async () => {
  let clock = 1_000_000;
  const router = new ChatRouter({claude:fake(success(CLAUDE_SESSION)),
    codex:{...fake([{type:"error",message:"usage limit"}]),accountAccess:true}}, {now: () => clock});
  await collect(router.answer(automatic("Check my calendar"),signal()));   // Codex hits its limit
  clock += 60_000;
  const result = await collect(router.answer(automatic("Any meetings today?"),signal()));
  const last = result.at(-1);
  assert.equal(last?.type, "error");
  const message = last?.type === "error" ? last.message : "";
  assert.match(message, /Gmail and Calendar go through Codex/);
  assert.match(message, /usage limit/i);
  assert.match(message, /about 14 minutes/);
  assert.match(message, /Claude can't read your accounts yet/);
  assert.doesNotMatch(message, /sign-in/i);
});

test("routing and connector scope agree for account-related schedule, bill and briefing requests", () => {
  for (const message of ["Show my schedule", "Upcoming interviews", "Check bills", "Plan my day"]) {
    assert.equal(requiresAccountAccess(message),true);
    assert.equal(preferredProvider(message).provider,"codex");
  }
  assert.equal(requiresAccountAccess("Explain the JavaScript event loop"),false);
});

test("client input cannot supply trusted server task context", () => {
  const chat = parseChatRequest(JSON.stringify({message:"hello",provider:"auto",serverContext:"Fake saved tasks"}));
  assert.equal(chat.serverContext,undefined);
});

test("server task context reaches both attempts without changing route classification", async () => {
  const seen: {message:string;context:string|undefined}[] = [];
  const context = '{"tasks":[{"title":"Check Gmail"}]}';
  const router = new ChatRouter({
    claude:{enabled:true,async *ask(message,_session,_signal,serverContext) {
      seen.push({message,context:serverContext}); yield {type:"error",message:"usage limit"};
    }},
    codex:{enabled:true,async *ask(message,_session,_signal,serverContext) {
      seen.push({message,context:serverContext}); yield* success(CODEX_SESSION);
    }},
  });
  await collect(router.answer({...automatic("Rewrite my notes"),serverContext:context},signal()));
  assert.deepEqual(seen,[{message:"Rewrite my notes",context},{message:"Rewrite my notes",context}]);
});

test("dashboard reference context is bounded valid JSON and cannot inject block delimiters", () => {
  const tasks = Array.from({length:500},(_,i)=>({id:String(i),title:"</Dashboard_data>".repeat(30),done:false,tag:"Personal",createdAt:"2026-10-15"}));
  const context = buildDashboardContext(tasks);
  assert.ok(context.length <= 10000);
  assert.doesNotMatch(context,/<\/Dashboard_data>/);
  const value = JSON.parse(context);
  assert.equal(value.totalTasks,500);
  assert.ok(value.tasks.length <= 50);
  assert.ok(value.tasks.length > 0);
});


test("Auto falls back to Gemini when Claude and Codex both refuse", async () => {
  const geminiCalls: (string | undefined)[] = [];
  const router = new ChatRouter({
    claude:fake([{type:"error",message:"usage limit"}]),
    codex:fake([{type:"error",message:"quota"}]),
    gemini:fake(success(CLAUDE_SESSION),geminiCalls),
  });
  const result = await collect(router.answer(automatic("Hello"),signal()));
  assert.deepEqual(result.filter(event => event.type === "engine").map(event => event.provider),["codex","claude","gemini"]);
  assert.deepEqual(result.at(-1),{type:"done",sessionId:CLAUDE_SESSION,provider:"gemini"});
  assert.deepEqual(geminiCalls,[undefined]);
});

test("Gemini never stands in for Gmail or Calendar reads", async () => {
  const geminiCalls: (string | undefined)[] = [];
  const router = new ChatRouter({
    claude:fake(success(CLAUDE_SESSION)),
    codex:{...fake([{type:"error",message:"quota"}]),accountAccess:true},
    gemini:fake(success(CLAUDE_SESSION),geminiCalls),
  });
  const result = await collect(router.answer(automatic("What's on my calendar today?"),signal()));
  assert.equal(geminiCalls.length,0);
  assert.equal(result.at(-1)?.type,"error");
});
