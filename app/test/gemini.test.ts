import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGeminiBody, classifyGeminiError, parseGeminiLine } from "../src/brain/gemini.ts";

const data = (value: unknown) => `data: ${JSON.stringify(value)}`;

test("reads the interaction ID, text deltas, and completion from the stream", () => {
  assert.deepEqual(parseGeminiLine(data({event_type:"interaction.created",interaction:{id:"v1_abc"}})),{kind:"interaction",id:"v1_abc"});
  assert.deepEqual(parseGeminiLine(data({event_type:"step.start",step:{type:"model_output",content:[{type:"text",text:"Good "}]}})),{kind:"text",text:"Good "});
  assert.deepEqual(parseGeminiLine(data({event_type:"step.delta",delta:{type:"text",text:"evening."}})),{kind:"text",text:"evening."});
  assert.deepEqual(parseGeminiLine(data({event_type:"interaction.completed"})),{kind:"completed"});
});

test("ignores thoughts, keep-alives, and anything that isn't data", () => {
  assert.equal(parseGeminiLine(data({event_type:"step.delta",delta:{type:"thought_summary",text:"hmm"}})).kind,"ignore");
  assert.equal(parseGeminiLine("event: step.delta").kind,"ignore");
  assert.equal(parseGeminiLine("data: [DONE]").kind,"ignore");
  assert.equal(parseGeminiLine("data: {not json").kind,"ignore");
});

test("maps Google's errors to quota, sign-in, or unavailable", () => {
  assert.equal(classifyGeminiError(429,undefined),"quota");
  assert.equal(classifyGeminiError(undefined,"RESOURCE_EXHAUSTED"),"quota");
  assert.equal(classifyGeminiError(401,undefined),"authentication");
  assert.equal(classifyGeminiError(403,"permission_denied"),"authentication");
  assert.equal(classifyGeminiError(503,undefined),"unavailable");
  assert.deepEqual(parseGeminiLine(data({event_type:"error",error:{code:"rate_limit_exceeded"}})),{kind:"error",code:"quota"});
});

test("continues a conversation only when there is a previous interaction", () => {
  assert.equal("previous_interaction_id" in buildGeminiBody("m","hi","sys"),false);
  const body = buildGeminiBody("m","hi","sys","v1_abc");
  assert.equal(body.previous_interaction_id,"v1_abc");
  assert.equal(body.stream,true);
  assert.equal(body.system_instruction,"sys");
});
