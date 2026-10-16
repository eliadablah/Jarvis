# One-time setup for the Jarvis PC worker on this Windows PC.
#   1. Makes a random worker token and saves it, with the worker settings, to
#      %USERPROFILE%\.jarvis\pc-worker.json (readable only by me).
#   2. Stores the same token as the GitHub secret PC_WORKER_TOKEN, so the next
#      deploy gives it to the Jarvis server.
#   3. Registers a scheduled task that starts the worker hidden at sign-in,
#      and starts it now.
# Re-running it replaces the token (redeploy afterwards).
#
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File pc-worker\install.ps1

param(
  [string]$Server = "https://dev-jarvis.eliadablah.com",
  [string]$JobsDir = "$env:USERPROFILE\Desktop\ai-job-search",
  [int]$MaxApplications = 10
)
$ErrorActionPreference = "Stop"

# --- Checks ---
foreach ($tool in "node", "claude", "gh") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed or not on PATH." }
}
if (-not (Test-Path "$JobsDir\CLAUDE.md")) { throw "No ai-job-search workspace at $JobsDir." }
$worker = Join-Path $PSScriptRoot "worker.ts"

# --- 1. Token and settings ---
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")

$dir = Join-Path $env:USERPROFILE ".jarvis"
New-Item -ItemType Directory -Force $dir | Out-Null
$settingsPath = Join-Path $dir "pc-worker.json"
@{
  server = $Server
  token = $token
  jobsDir = $JobsDir
  claudeBin = (Get-Command claude).Source
  maxApplications = $MaxApplications
} | ConvertTo-Json | Out-File -Encoding utf8 $settingsPath
# Only my account can read the settings file.
icacls $settingsPath /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null

# --- 2. GitHub secret (sent over stdin, never on the command line) ---
$token | gh secret set PC_WORKER_TOKEN --repo eliadablah/Jarvis
if ($LASTEXITCODE -ne 0) { throw "Could not save the GitHub secret." }

# --- 3. Start at sign-in, hidden ---
$node = (Get-Command node).Source
# conhost --headless keeps a console window from popping up at sign-in.
$action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "--headless `"$node`" `"$worker`"" -WorkingDirectory (Split-Path $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$options = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "Jarvis PC worker" -Action $action -Trigger $trigger -Settings $options -Force | Out-Null
Start-ScheduledTask -TaskName "Jarvis PC worker"

Write-Host "Jarvis PC worker installed and running. Settings: $settingsPath"
Write-Host "Log: $dir\pc-worker.log"
Write-Host "Next: redeploy dev so the server gets the new token."
