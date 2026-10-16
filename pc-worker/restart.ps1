# Restart only this repository's idle PC worker. Run in a normal PowerShell window.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot
$worker = Join-Path $PSScriptRoot "worker.ts"
$settingsPath = Join-Path $env:USERPROFILE ".jarvis\pc-worker.json"
$statePath = Join-Path $env:USERPROFILE ".jarvis\pc-worker-state.json"
if (Test-Path -LiteralPath $statePath) {
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ($state.recoveryHold) { throw "An interrupted run needs review before restarting. See docs/pc-worker.md." }
  if ($state.active -or $state.outbox) { throw "Worker has an unfinished task or undelivered report. Review PC activity before restarting." }
}
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$activity = Invoke-RestMethod -Uri ($settings.server.TrimEnd("/") + "/api/pc/tasks")
if ($activity.tasks | Where-Object { $_.status -in @("running", "cancelling") }) {
  throw "A PC task is running. Cancel it and wait for its report before restarting."
}
# Read the command line so another Node process can never be stopped by filename alone.
$workerPattern = '^\s*"?(?:[^"]*\\)?node(?:\.exe)?"?\s+"?' + [regex]::Escape($worker) + '"?\s*$'
$workers = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $workerPattern })
foreach ($process in $workers) {
  Stop-Process -Id $process.ProcessId -ErrorAction Stop
}
$node = (Get-Command node).Source
$launchedAt = [DateTimeOffset]::UtcNow
$started = Start-Process -FilePath $node -ArgumentList ('"{0}"' -f $worker) -WorkingDirectory $root -WindowStyle Hidden -PassThru
$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Seconds 2
  $started.Refresh()
  if ($started.HasExited) { throw "Worker exited. See $env:USERPROFILE\.jarvis\pc-worker.log." }
  $activity = Invoke-RestMethod -Uri ($settings.server.TrimEnd("/") + "/api/pc/tasks")
} until (($activity.workerOnline -and $activity.protocol -eq 2 -and $activity.workerSeenAt -and [DateTimeOffset]::Parse($activity.workerSeenAt) -gt $launchedAt) -or (Get-Date) -gt $deadline)
if (-not $activity.workerSeenAt -or [DateTimeOffset]::Parse($activity.workerSeenAt) -le $launchedAt) { throw "Worker started but did not report online. Check its log." }
Write-Host "Jarvis PC worker restarted and reporting online."
