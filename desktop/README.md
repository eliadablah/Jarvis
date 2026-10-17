# Jarvis for Windows

An installed Electron application using the same private dev dashboard at
https://dev-jarvis.eliadablah.com/?design=auto. A/B/C views, task history and
model routing come from that server. The desktop shell has its own window,
tray, Start menu and desktop shortcuts. The existing authenticated PC worker
continues separately; installation does not rotate credentials, start duplicate
workers, grant models new tools, or change production.

## Build and install

Use Windows x64 with Node.js 24 or later:

```powershell
npm ci
npm test
npm run dist
& '.\release\Jarvis-Setup-0.1.0.exe'
```

The installer is per-user and requires no administrator access. Windows Settings
can uninstall it. Personal worker settings are not packaged or removed. The
initial local build is unsigned; no signing identity or automatic update feed is
configured. Website updates appear on reload; desktop shell updates require a
new installer. Existing dashboard preferences use a separate app browser profile.

## Desktop behavior

- The same dev dashboard loads directly; internet and private server connectivity
  are required. A connection page appears when it cannot load.
- Closing the window closes the desktop app; minimizing leaves its tray available.
- A second launch focuses the existing window. Ctrl+R reloads the dashboard.
- HTTPS links outside the dashboard open in the system browser after confirmation.
  Remote pages cannot navigate to local files or execute commands.
- The dashboard renderer is sandboxed, isolated, and has no Node integration.
  No general-purpose IPC bridge or remote debugging endpoint exists.
- Hold-to-talk uses the installed Windows en-US speech recognizer through a
  narrowly scoped speech bridge. First use asks for microphone consent. Audio
  stays in the local recognizer; the resulting command follows normal Jarvis routing.
  Listening stops on release, loss of focus, navigation, app exit, or after 60 seconds.
  Windows microphone restrictions and missing recognizers are reported.

## Checks

Tests cover trusted origin/frame enforcement, external URL scheme rejection and
voice bridge lifetime. The Windows speech helper supports `-Probe` to check the
recognizer without accessing the microphone. Live microphone accuracy requires
the user speaking and is not established by a setup probe.

Electron and Chromium retain their bundled upstream license files in the app.

## Restricted Windows build sessions

The standard electron-builder dependency collector forks npm, which can fail
with `spawn EPERM` in restricted agent sessions. The included `package.cjs`
uses the pinned Electron runtime, official ASAR and resource-edit APIs directly,
then downloads the official NSIS 3.12 bundle through electron-builder's pinned
SHA-256 verification. `build.ps1` invokes the native NSIS compiler directly.
It does not alter Windows execution policy, access rules or app sandboxing.

If npm's lifecycle launcher is blocked during dependency setup, install with
`npm ci --ignore-scripts`, then run `node node_modules/electron/install.js`
directly. Set `electron_config_cache` to a writable cache directory when needed.
The `-ExecutionPolicy Bypass` option in the build command applies only to that
PowerShell process; it does not persist a machine/user policy change.

## Local installation checkpoint (2026-10-17)

Built `release/Jarvis-Setup-0.1.0.exe` (115286927 bytes), with the official
Electron 44.9.0 runtime and verified official NSIS 3.12 compiler. Six desktop
checks passed; the Windows speech recognizer probe and helper compilation passed
without opening the microphone. Live microphone recognition is unverified.

The agent session's native installer and development launch exited with
0xc0000005. Direct installation copied and SHA-256 verified Jarvis.exe into
`%LOCALAPPDATA%/Programs/Jarvis` and created desktop/Start menu shortcuts. Windows
denied the HKCU Uninstall registry write, so Settings registration is incomplete.
The Roaming/Jarvis profile directory was created and the installed executable
was launched, but no successful dashboard startup was verified: subsequent shell
checks were refused because the restricted-token sandbox could not enforce the
granted writable-root set. Do not disable sandboxing or Windows protections.

Run the built setup executable once from Explorer to finish normal Windows
registration, then open Jarvis. `install-local.ps1` and `uninstall-local.ps1`
document the direct per-user installation path; an error during registration can
leave installed files/shortcuts, so inspect those before retrying. No worker
credentials, scheduled tasks, production deployment or Git metadata were changed.
Desktop source has not been pushed to GitHub.
