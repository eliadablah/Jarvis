# Install/update the local PC worker. Existing credentials and workspace aliases are preserved.
param(
  [string]$Server = "https://dev-jarvis.eliadablah.com",
  [string]$JobsDir = "$env:USERPROFILE\Desktop\ai-job-search",
  [int]$MaxApplications = 10,
  [switch]$RotateToken
)
$ErrorActionPreference = "Stop"
foreach ($tool in "node", "claude", "gh") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed or not on PATH." }
}
if (-not (Test-Path -LiteralPath (Join-Path $JobsDir "CLAUDE.md"))) { throw "No job-search profile at $JobsDir." }
$dir = Join-Path $env:USERPROFILE ".jarvis"
New-Item -ItemType Directory -Force $dir | Out-Null
$settingsPath = Join-Path $dir "pc-worker.json"
$settings = @{}
if (Test-Path -LiteralPath $settingsPath) {
  $existing = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  foreach ($property in $existing.PSObject.Properties) { $settings[$property.Name] = $property.Value }
}
$newToken = $RotateToken -or -not $settings.token
if ($newToken) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $settings.token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}
if (-not $settings.server -or $PSBoundParameters.ContainsKey("Server")) { $settings.server = $Server }
if (-not $settings.jobsDir -or $PSBoundParameters.ContainsKey("JobsDir")) { $settings.jobsDir = $JobsDir }
if (-not $settings.maxApplications -or $PSBoundParameters.ContainsKey("MaxApplications")) { $settings.maxApplications = [Math]::Min(25, [Math]::Max(1, $MaxApplications)) }
$settings.claudeBin = (Get-Command claude).Source
$settings.needsTokenSync = $newToken -or $settings.needsTokenSync -eq $true
[IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
if ($settings.needsTokenSync) {
  $settings.token | gh secret set PC_WORKER_TOKEN --repo eliadablah/Jarvis
  if ($LASTEXITCODE -ne 0) { throw "Could not save the GitHub secret; rerun setup to retry the same token." }
  $settings.needsTokenSync = $false
}
# Install/use the pinned official CLI and a separate private runtime cache.
$codexSetup = Join-Path $PSScriptRoot "setup-codex.ts"
node $codexSetup
if ($LASTEXITCODE -ne 0) { throw "Could not set up standalone Codex." }
$codexSettings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$settings.codexBin = $codexSettings.codexBin
$settings.codexHome = $codexSettings.codexHome
if (-not $settings.workspaces) {
  $assistant = Join-Path $dir "workspace"
  New-Item -ItemType Directory -Force $assistant | Out-Null
  $settings.workspaces = @{ assistant = $assistant; jarvis = (Split-Path $PSScriptRoot) }
}
[IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
icacls $settingsPath /inheritance:r /grant:r ($env:USERNAME + ':(R,W)') | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not restrict the settings file." }

$worker = Join-Path $PSScriptRoot "worker.ts"
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument ('--headless "{0}" "{1}"' -f $node,$worker) -WorkingDirectory (Split-Path $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$options = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "Jarvis PC worker" -Action $action -Trigger $trigger -Settings $options -Force | Out-Null
Start-ScheduledTask -TaskName "Jarvis PC worker"
Write-Host "PC worker installed. Settings: $settingsPath"
if ($newToken) { Write-Host "Redeploy dev so it receives the new worker token." }
else { Write-Host "Existing worker token preserved. Restart an older worker when no task is running." }
