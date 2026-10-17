'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog, ipcMain } = require('electron');
const { join } = require('node:path');
const { appendFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { DASHBOARD_URL, trustedPage, externalPage, trustedSender } = require('./policy.cjs');

app.setName('Jarvis');
app.setAppUserModelId('com.eliadablah.jarvis');
let window, tray, speech, micConsent = false;
let pendingExternal = false;
const diagnostics = process.argv.includes('--diagnostics');
function log(message) {
  try { appendFileSync(join(app.getPath('userData'), 'desktop.log'), `${new Date().toISOString()} ${message}\n`); } catch {}
}
function showDashboard() { if (!window) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
function loadDashboard() { window?.loadURL(DASHBOARD_URL).catch(() => {}); }
function sendSpeech(id, payload) {
  if (window && !window.isDestroyed() && trustedPage(window.webContents.getURL())) window.webContents.send('jarvis:speech-event', { id, ...payload });
}
function stopSpeech(cancel = false) {
  if (!speech) return;
  const current = speech;
  if (cancel) { current.cancelled = true; current.child.kill(); }
  else { try { current.child.stdin.end('stop\n'); } catch {} }
  if (!current.stopTimer) current.stopTimer = setTimeout(() => current.child.kill(), 1800);
}
async function openExternal(url) {
  if (!externalPage(url) || pendingExternal) return;
  pendingExternal = true;
  try {
    const destination = new URL(url);
    const { response } = await dialog.showMessageBox(window, { type: 'question', title: 'Open in your browser?', message: `Open ${destination.hostname} in your default browser?`, buttons: ['Open browser', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true });
    if (response === 0) await shell.openExternal(url);
  } finally { pendingExternal = false; }
}
ipcMain.handle('jarvis:speech-start', async (event, id) => {
  if (!window || !trustedSender(event, window.webContents) || typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(id)) throw new Error('Speech request is unavailable.');
  if (speech) throw new Error('Already listening.');
  if (!micConsent) {
    const { response } = await dialog.showMessageBox(window, { type: 'question', title: 'Jarvis microphone', message: 'Allow Jarvis to listen while you hold the microphone button?', detail: 'Windows recognizes speech locally. The resulting command is sent to your Jarvis server when you release the button. Listening stops on release, loss of focus, or after 60 seconds.', buttons: ['Allow for this app session', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
    if (response !== 0) throw new Error('Microphone access was not allowed.');
    micConsent = true;
  }
  if (!trustedSender(event, window.webContents) || speech) throw new Error('Speech request cancelled.');
  const speechScript = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'speech.ps1') : join(__dirname, 'speech.ps1');
  const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', speechScript], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const current = { child, id, cancelled: false, timer: undefined, stopTimer: undefined };
  speech = current;
  current.timer = setTimeout(() => stopSpeech(), 60_000);
  let finished = false;
  const finish = () => {
    if (finished) return; finished = true;
    clearTimeout(current.timer); clearTimeout(current.stopTimer);
    if (speech === current) speech = undefined;
    sendSpeech(id, { type: 'end' });
  };
  createInterface({ input: child.stdout }).on('line', line => {
    if (current.cancelled) return;
    try {
      const data = JSON.parse(line);
      if (['ready', 'final', 'interim', 'error'].includes(data.type)) sendSpeech(id, { type: data.type, text: typeof data.text === 'string' ? data.text.slice(0, 12_000) : '' });
    } catch { /* PowerShell startup noise is never interpreted as a command. */ }
  });
  child.stderr.on('data', () => { if (!current.cancelled) sendSpeech(id, { type: 'error', text: 'Windows speech recognition could not start. Check microphone access in Windows Settings.' }); });
  child.stdin.on('error', () => {});
  child.on('error', () => { sendSpeech(id, { type: 'error', text: 'Windows speech recognition could not start.' }); finish(); });
  child.on('close', finish);
  return true;
});
ipcMain.handle('jarvis:speech-stop', (event, id, cancel) => {
  if (window && trustedSender(event, window.webContents) && speech?.id === id) stopSpeech(cancel === true);
});

function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 700, minHeight: 580, title: 'Jarvis', backgroundColor: '#0d1712', icon: join(__dirname, 'assets', 'jarvis.ico'), show: false, autoHideMenuBar: true, webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, partition: 'persist:jarvis' } });
  const contents = window.webContents;
  const session = contents.session;
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => { if (!trustedPage(url)) { event.preventDefault(); void openExternal(url); } });
  contents.on('will-redirect', (event, url) => { if (!trustedPage(url)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) stopSpeech(true); });
  contents.on('page-title-updated', event => { event.preventDefault(); window.setTitle('Jarvis · Dev'); });
  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && trustedPage(url)) { log(`dashboard connection failed (${code})`); void window.loadFile(join(__dirname, 'offline.html')); }
  });
  contents.on('did-finish-load', () => {
    log(trustedPage(contents.getURL()) ? 'dashboard loaded' : 'connection screen loaded');
    if (diagnostics && trustedPage(contents.getURL())) {
      // A one-time local startup report contains no page content, cookies or credentials.
      const { writeFileSync } = require('node:fs');
      writeFileSync(join(app.getPath('userData'), 'startup-check.json'), JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), executable: process.execPath, url: contents.getURL(), packaged: app.isPackaged, sandbox: contents.getLastWebPreferences().sandbox, contextIsolation: contents.getLastWebPreferences().contextIsolation, nodeIntegration: contents.getLastWebPreferences().nodeIntegration }, null, 2));
    }
  });
  window.on('blur', () => stopSpeech());
  window.once('ready-to-show', showDashboard);
  window.on('closed', () => { stopSpeech(true); window = undefined; app.quit(); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Jarvis', submenu: [
      { label: 'Show dashboard', click: showDashboard },
      { label: 'Reload dashboard', accelerator: 'CmdOrCtrl+R', click: loadDashboard },
      { label: 'Open dashboard in browser', click: () => shell.openExternal(DASHBOARD_URL) },
      { type: 'separator' },
      { label: 'About Jarvis', click: () => dialog.showMessageBox(window, { title: 'Jarvis', message: `Jarvis ${app.getVersion()} · Development`, detail: 'Your shared dashboard, in a Windows application.\n\nPC actions use your existing Jarvis PC worker. Closing this app does not stop the worker.\n\nThis local build has no automatic desktop updater. Dashboard updates appear on reload.' }) },
      { type: 'separator' }, { role: 'quit' }
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]));
  tray = new Tray(nativeImage.createFromPath(join(__dirname, 'assets', 'jarvis-192.png')).resize({ width: 24, height: 24 }));
  tray.setToolTip('Jarvis · Your personal dashboard');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Jarvis', click: showDashboard }, { label: 'Reload dashboard', click: loadDashboard }, { type: 'separator' }, { label: 'Quit Jarvis', click: () => app.quit() }]));
  tray.on('double-click', showDashboard);
  loadDashboard();
  setTimeout(showDashboard, 4000).unref();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showDashboard);
  app.whenReady().then(createWindow).catch(error => { log(`startup failed: ${error.code || error.name}`); app.quit(); });
  app.on('before-quit', () => stopSpeech(true));
  app.on('window-all-closed', () => app.quit());
  app.on('certificate-error', (event, _contents, _url, _error, _certificate, callback) => { event.preventDefault(); callback(false); });
}
