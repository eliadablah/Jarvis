'use strict';
// Package only the explicit desktop files; private repository/worker data never
// enters the application. Native NSIS runs from build.ps1 rather than npm pipes.
const { cp, mkdir, readFile, writeFile, rename, access } = require('node:fs/promises');
const { join } = require('node:path');
const { createPackageWithOptions, listPackage } = require('@electron/asar');
const { editWindowsResources } = require('app-builder-lib/out/util/resEdit');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
async function main() {
  const root = __dirname, release = join(root, 'release');
  const stage = join(release, 'app-source'), output = join(release, 'win-unpacked');
  await mkdir(stage, { recursive: true }); await mkdir(output, { recursive: true });
  const files = ['main.cjs', 'policy.cjs', 'preload.cjs', 'speech.ps1', 'offline.html'];
  for (const file of files) await cp(join(root, file), join(stage, file));
  await cp(join(root, 'assets'), join(stage, 'assets'), { recursive: true });
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await writeFile(join(stage, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, author: pkg.author, description: pkg.description, main: pkg.main }));
  await cp(join(root, 'node_modules', 'electron', 'dist'), output, { recursive: true });
  const exe = join(output, 'Jarvis.exe');
  // rename only the runtime's known executable, never a checkout or user folder.
  try { await access(exe); } catch { await rename(join(output, 'electron.exe'), exe); }
  const asar = join(output, 'resources', 'app.asar');
  await createPackageWithOptions(stage, asar, { unpack: 'speech.ps1' });
  const allowed = new Set([...files, 'package.json', 'assets', 'assets/jarvis.ico', 'assets/jarvis-192.png', 'assets/jarvis-512.png']);
  for (const entry of listPackage(asar)) { const normalized = entry.replaceAll('\\', '/').replace(/^\//, ''); if (!allowed.has(normalized)) throw new Error(`Unexpected packaged file: ${normalized}`); }
  await editWindowsResources({ file: exe, versionStrings: { CompanyName: 'Elikem Adablah', FileDescription: 'Jarvis', ProductName: 'Jarvis', OriginalFilename: 'Jarvis.exe', LegalCopyright: 'Copyright © Elikem Adablah' }, fileVersion: pkg.version, productVersion: pkg.version, requestedExecutionLevel: 'asInvoker', iconPath: join(root, 'assets', 'jarvis.ico') });
  const nsis = await getMakeNsisPath('1.2.1');
  await writeFile(join(release, 'build-tools.json'), JSON.stringify(nsis));
  console.log(`Packaged Jarvis ${pkg.version}; verified ${listPackage(asar).length} allowlisted application entries.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
