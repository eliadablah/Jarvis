$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:USERPROFILE '.jarvis\job-files'
$package = Join-Path $runtime 'node_modules\pdf-parse\package.json'
if (-not (Test-Path -LiteralPath $package) -or (Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).version -ne '2.4.5') {
  & npm install --prefix $runtime pdf-parse@2.4.5 --save-exact --include=optional --ignore-scripts --cache (Join-Path $env:USERPROFILE '.jarvis\npm-cache') --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Job PDF runtime installation failed. No worker restart attempted.' }
}
& (Join-Path $PSScriptRoot 'restart.ps1')
if (-not $?) { throw 'Worker activation did not finish.' }
Write-Host 'Job file tools and bounded startup retries are active in Jarvis.'
