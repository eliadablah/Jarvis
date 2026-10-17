$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  $env:ELECTRON_BUILDER_CACHE = Join-Path $PSScriptRoot 'release\build-cache'
  node --test --test-isolation=none test/desktop.test.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Desktop checks failed.' }
  node package.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Application packaging failed.' }
  $nsisTools = Get-Content -LiteralPath 'release\build-tools.json' -Raw | ConvertFrom-Json
  if ($nsisTools.env.NSISDIR) { $env:NSISDIR = $nsisTools.env.NSISDIR }
  & $nsisTools.path /V2 installer.nsi
  if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
  Write-Host "Installer ready: $PSScriptRoot\release\Jarvis-Setup-0.1.0.exe"
} finally { Pop-Location }
