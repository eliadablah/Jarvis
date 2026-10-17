'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { trustedPage, externalPage, trustedSender } = require('../policy.cjs');

test('desktop accepts only the exact private dashboard origin', () => {
  assert.equal(trustedPage('https://dev-jarvis.eliadablah.com/?design=b'), true);
  for (const value of ['http://dev-jarvis.eliadablah.com', 'https://dev-jarvis.eliadablah.com.attacker.example', 'https://dev-jarvis.eliadablah.com@evil.example', 'https://user:password@dev-jarvis.eliadablah.com/', 'file:///C:/Users/eliad/.jarvis/pc-worker.json', 'javascript:alert(1)', 'not a url']) assert.equal(trustedPage(value), false, value);
});
test('external links reject local files, executable schemes and credentials', () => {
  assert.equal(externalPage('https://jobs.ashbyhq.com/ashby'), true);
  for (const value of ['file:///C:/Windows', 'javascript:alert(1)', 'powershell:command', 'ms-settings:privacy', 'http://example.com', 'https://user:pass@example.com']) assert.equal(externalPage(value), false, value);
});
test('speech IPC requires this app main frame and trusted current URL', () => {
  const mainFrame = { url: 'https://dev-jarvis.eliadablah.com/?design=auto' };
  const contents = { mainFrame };
  assert.equal(trustedSender({ sender: contents, senderFrame: mainFrame }, contents), true);
  assert.equal(trustedSender({ sender: {}, senderFrame: mainFrame }, contents), false);
  assert.equal(trustedSender({ sender: contents, senderFrame: { ...mainFrame } }, contents), false);
  mainFrame.url = 'https://evil.example';
  assert.equal(trustedSender({ sender: contents, senderFrame: mainFrame }, contents), false);
});
function speechHarness(start) {
  const listeners = new Set(), calls = [];
  const bridge = { start: id => start?.(id) ?? Promise.resolve(true), stop: async (id, cancel) => calls.push({ id, cancel }), subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); } };
  const world = { window: { jarvisSpeech: bridge }, crypto: { randomUUID } };
  const context = vm.createContext({ require: name => { assert.equal(name, 'electron'); return { ipcRenderer: {}, contextBridge: { exposeInMainWorld() {}, executeInMainWorld: ({ func }) => vm.runInNewContext(`(${func.toString()})()`, world) } }; } });
  vm.runInContext(readFileSync(join(__dirname, '../preload.cjs'), 'utf8'), context);
  const recognition = new world.window.SpeechRecognition();
  return { recognition, calls, listeners, emit: data => { for (const listener of listeners) listener({ id: recognition.id, ...data }); } };
}
test('speech delivers final text once and releases event subscriptions', async () => {
  const h = speechHarness(); let ended = 0; const texts = [];
  h.recognition.onresult = e => { if (e.results[e.resultIndex].isFinal) texts.push(e.results[e.resultIndex][0].transcript.trim()); };
  h.recognition.onend = () => ended++;
  h.recognition.start();
  h.emit({ type: 'interim', text: 'open dash' });
  h.emit({ type: 'final', text: 'open dashboard' });
  h.recognition.stop(); await Promise.resolve();
  h.emit({ type: 'end' });
  assert.deepEqual(texts, ['open dashboard']);
  assert.equal(ended, 1); assert.equal(h.listeners.size, 0);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].cancel, false);
});
test('release before native startup still stops the eventual recognizer', async () => {
  let resolve;
  const h = speechHarness(() => new Promise(r => { resolve = r; }));
  h.recognition.start(); h.recognition.stop(); resolve(true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.calls.at(-1).cancel, false);
  h.emit({ type: 'end' }); assert.equal(h.listeners.size, 0);
});
test('microphone refusal ends speech cleanly without a transcript', async () => {
  const h = speechHarness(() => Promise.reject(new Error('Microphone access was not allowed.')));
  let ended = 0, errors = 0, results = 0;
  h.recognition.onend = () => ended++; h.recognition.onerror = () => errors++; h.recognition.onresult = () => results++;
  h.recognition.start(); await Promise.resolve(); await Promise.resolve();
  assert.equal(ended, 1); assert.equal(errors, 1); assert.equal(results, 0); assert.equal(h.listeners.size, 0);
});
