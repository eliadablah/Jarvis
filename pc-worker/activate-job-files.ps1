$ErrorActionPreference = 'Stop'
$sdkRuntime = Join-Path $env:USERPROFILE '.jarvis\claude-sdk'
$sdkPackage = Join-Path $sdkRuntime 'node_modules\@anthropic-ai\claude-agent-sdk\package.json'
$sdkReady = Join-Path $sdkRuntime 'ready-0.3.304'
if (-not (Test-Path -LiteralPath $sdkReady) -or -not (Test-Path -LiteralPath $sdkPackage) -or (Get-Content -LiteralPath $sdkPackage -Raw | ConvertFrom-Json).version -ne '0.3.304') {
  & npm install --prefix $sdkRuntime @anthropic-ai/claude-agent-sdk@0.3.304 --save-exact --omit=optional --ignore-scripts --cache (Join-Path $env:USERPROFILE '.jarvis\npm-cache') --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Claude approval runtime installation failed. No worker restart attempted.' }
  Set-Content -LiteralPath $sdkReady -Value 'installed' -Encoding ascii
}
$runtime = Join-Path $env:USERPROFILE '.jarvis\job-files'
$package = Join-Path $runtime 'node_modules\pdf-parse\package.json'
if (-not (Test-Path -LiteralPath $package) -or (Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).version -ne '2.4.5') {
  & npm install --prefix $runtime pdf-parse@2.4.5 --save-exact --include=optional --ignore-scripts --cache (Join-Path $env:USERPROFILE '.jarvis\npm-cache') --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Job PDF runtime installation failed. No worker restart attempted.' }
}
& (Join-Path $PSScriptRoot 'restart.ps1')
if (-not $?) { throw 'Worker activation did not finish.' }
Write-Host 'Full personal tools, Firecrawl permission and dashboard approval prompts are active in Jarvis.'
