# Run interactively in normal Windows PowerShell; never changes sandbox policy.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$privateRoot = Join-Path $env:USERPROFILE '.jarvis'
$runtime = Join-Path $privateRoot 'ruflo'
$package = Join-Path $runtime 'node_modules\@claude-flow\cli\package.json'
if (-not (Test-Path -LiteralPath $package)) {
  & npm install --prefix $runtime ruflo@3.57.1 --save-exact --omit=optional --ignore-scripts --cache (Join-Path $privateRoot 'npm-cache') --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Ruflo installation failed; worker was not restarted.' }
}
if ((Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).version -ne '3.57.1') { throw 'Unexpected Ruflo version.' }
$settingsPath = Join-Path $privateRoot 'pc-worker.json'
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$ezlynx = Join-Path $env:USERPROFILE 'Documents\ezlynx-ui-project'
if (Test-Path -LiteralPath $ezlynx) {
  $settings.workspaces | Add-Member -NotePropertyName ezlynx -NotePropertyValue $ezlynx -Force
  # Preserve all existing credentials and aliases. Never print them.
  $settings | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
}
@{ enabled = $true; root = $runtime; version = '3.57.1' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privateRoot 'ruflo-runtime.json') -Encoding UTF8
# Existing helper refuses unfinished tasks/recovery holds and verifies fresh heartbeat.
& (Join-Path $PSScriptRoot 'restart.ps1')
if (-not $?) { throw 'Activation did not finish. Existing restart diagnostics explain why.' }
Write-Host 'Ruflo connected to the local Jarvis workspace worker. Server changes must also be deployed to dev.'
