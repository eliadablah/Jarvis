import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCodexArgs, parseCodexLine, vaultContext } from '../src/brain/codex.ts';
import { loadConfig } from '../src/config.ts';
import { parseChatRequest } from '../src/api/chatRequest.ts';
import { renderHomePage } from '../src/views/homePage.ts';

test('Codex disables command tools and approvals for new and resumed conversations', () => {
  const config = {enabled:true,bin:'codex',model:''};
  for (const id of [undefined,'11111111-2222-3333-4444-555555555555']) {
    const args=buildCodexArgs(config,id);
    for (const required of ['sandbox_mode="read-only"','approval_policy="never"','features.shell_tool=false','features.unified_exec=false','--ignore-user-config']) assert.ok(args.includes(required));
    assert.equal(args.at(-1),'-');
    assert.equal(args.includes('resume'),!!id);
    assert.ok(!args.some(arg=>arg.includes('bypass')));
  }
});
test('engine validation rejects arbitrary commands and unsafe session identifiers', () => {
  assert.equal(parseChatRequest('{"message":"hello","provider":"codex"}').provider,'codex');
  assert.throws(()=>parseChatRequest('{"message":"hello","provider":"--dangerous"}'));
  assert.throws(()=>parseChatRequest('{"message":"hello","provider":"codex","sessionId":"--last"}'));
});
test('Codex parsing tolerates diagnostics and recognizes answer events', () => {
  assert.equal(parseCodexLine('diagnostic'),undefined);
  assert.equal(parseCodexLine('null'),undefined);
  assert.equal(parseCodexLine('{"type":"turn.completed"}')?.type,'turn.completed');
  assert.equal(parseCodexLine('{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}')?.item?.text,'hello');
});
test('Codex selection requires explicit server enablement', () => {
  assert.match(renderHomePage(loadConfig({})),/value="codex" disabled/);
  assert.doesNotMatch(renderHomePage(loadConfig({CODEX_ENABLED:'true'})),/value="codex" disabled/);
});
test('vault retrieval includes priorities and matching notes, excluding hidden and non-markdown files', async () => {
  const dir=await mkdtemp(join(tmpdir(),'jarvis-context-'));
  try {
    await mkdir(join(dir,'.private'));
    await writeFile(join(dir,'VAULT-INDEX.md'),'INDEX');
    await writeFile(join(dir,'Active Priorities.md'),'PRIORITIES');
    await writeFile(join(dir,'Network Study.md'),'NETWORK');
    await writeFile(join(dir,'Other.md'),'UNRELATED');
    await writeFile(join(dir,'.private','Network secret.md'),'SECRET');
    await writeFile(join(dir,'Network.json'),'CREDENTIAL');
    const result=await vaultContext(dir,'network study');
    for (const word of ['INDEX','PRIORITIES','NETWORK']) assert.ok(result.includes(word));
    assert.doesNotMatch(result,/SECRET|CREDENTIAL|UNRELATED/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
