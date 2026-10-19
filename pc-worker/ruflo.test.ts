import { test } from "node:test";
import assert from "node:assert/strict";
import { rufloMcp, rufloCodexArgs, RUFLO_TOOLS } from "./ruflo.ts";
import { handleRufloRequest } from "./ruflo-server.ts";
import { claudeArgs, codexArgs } from "./agents.ts";

const settings = { server: "https://example.com", token: "test", jobsDir: ".", rufloRoot: "C:/private/ruflo" };
test("Ruflo connects only to workspace adapters, preserving isolation for jobs and desktop", () => {
  assert.equal(rufloMcp()?.command, undefined);
  assert.deepEqual(rufloCodexArgs(), []);
  assert.match(codexArgs(settings).join(" "), /jarvis-ruflo.required=true/);
  assert.ok(codexArgs(settings).includes('approvals_reviewer="auto_review"'));
  assert.ok(codexArgs(settings).includes("workspace-write"));
  assert.doesNotMatch(codexArgs(settings, true, true).join(" "), /jarvis-ruflo/);
  assert.doesNotMatch(codexArgs(settings, true).join(" "), /jarvis-ruflo/);
  const args = claudeArgs({kind:"workspace",action:"execute",workspace:"assistant"}, settings);
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("mcp__jarvis-ruflo__task_create"));
  assert.doesNotMatch(claudeArgs({kind:"jobs",action:"search",maxApplications:0},settings).join(" "), /jarvis-ruflo/);
  assert.ok(!RUFLO_TOOLS.includes("agent_execute"));
});
test("Ruflo server enforces tool and argument boundaries itself", async () => {
  let called = 0;
  const tools = [{name:"task_create",inputSchema:{required:["description"],properties:{description:{type:"string"}}},handler:async()=>{called++;return {success:true};}}];
  for (const name of ["agent_execute","terminal_execute","browser_navigate","task_delete"]) {
    const response = await handleRufloRequest({id:1,method:"tools/call",params:{name,arguments:{}}},tools);
    assert.ok(response && "error" in response);
  }
  for(const args of [{}, {description:"x",dbPath:"C:/private.db"}, {description:"x",extra:true}]) {
    const response=await handleRufloRequest({id:2,method:"tools/call",params:{name:"task_create",arguments:args}},tools);
    assert.ok(response && "error" in response);
  }
  assert.equal(called,0);
  const response=await handleRufloRequest({id:3,method:"tools/call",params:{name:"task_create",arguments:{description:"authorized project work"}}},tools);
  assert.ok(response && "result" in response);assert.equal(called,1);
});
