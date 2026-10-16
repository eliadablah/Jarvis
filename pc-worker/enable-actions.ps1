# Enable the installed desktop action adapter and restart only the idle Jarvis worker.
$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'setup-desktop.ts')
if ($LASTEXITCODE -ne 0) { throw 'Desktop setup failed; the running worker was not changed.' }
& (Join-Path $PSScriptRoot 'restart.ps1')
