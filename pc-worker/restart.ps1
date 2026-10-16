# Restart only this repository's idle PC worker. Run in a normal PowerShell window.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot
$worker = Join-Path $PSScriptRoot "worker.ts"
$node = (Get-Command node -ErrorAction Stop).Source
function Read-WorkerActivity {
  $statusJson = & $node (Join-Path $PSScriptRoot 'status.ts')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot verify PC activity. Check Tailscale and retry.' }
  return ($statusJson | ConvertFrom-Json)
}
$statePath = Join-Path $env:USERPROFILE ".jarvis\pc-worker-state.json"
if (Test-Path -LiteralPath $statePath) {
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ($state.recoveryHold) { throw "An interrupted run needs review before restarting. See docs/pc-worker.md." }
  if ($state.active -or $state.outbox) { throw "Worker has an unfinished task or undelivered report. Review PC activity before restarting." }
}
$activity = Read-WorkerActivity
if ($activity.tasks | Where-Object { $_.status -in @("running", "cancelling") }) {
  throw "A PC task is running. Cancel it and wait for its report before restarting."
}
# Read the command line so another Node process can never be stopped by filename alone.
$workerPattern = '^\s*"?(?:[^"]*\\)?node(?:\.exe)?"?\s+"?' + [regex]::Escape($worker) + '"?\s*$'
$workers = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $workerPattern })
foreach ($process in $workers) {
  Stop-Process -Id $process.ProcessId -ErrorAction Stop
}
# Retry only a native startup crash, never an interrupted task.
for ($attempt = 1; $attempt -le 3; $attempt++) {
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.recoveryHold -or $state.active -or $state.outbox) { throw 'Worker has unfinished activity; inspect PC activity before restarting.' }
  }
  $activity = Read-WorkerActivity
  if ($activity.tasks | Where-Object { $_.status -in @('running', 'cancelling') }) { throw 'A PC task is active; no startup retry was made.' }
  $launchedAt = [DateTimeOffset]::UtcNow
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $stdout = Join-Path $env:USERPROFILE ('.jarvis\worker-startup-' + $stamp + '.out.log')
  $stderr = Join-Path $env:USERPROFILE ('.jarvis\worker-startup-' + $stamp + '.err.log')
  $started = Start-Process -FilePath $node -ArgumentList ('"{0}"' -f $worker) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $deadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Seconds 2
    $started.Refresh()
    if ($started.HasExited) { break }
    try { $activity = Read-WorkerActivity } catch { $activity = $null }
    if ($activity.workerOnline -and $activity.protocol -eq 2 -and $activity.workerSeenAt -and [DateTimeOffset]::Parse($activity.workerSeenAt) -gt $launchedAt) {
      Write-Host 'Jarvis PC worker restarted and reporting online.'
      return
    }
  } while ((Get-Date) -lt $deadline)
  if (-not $started.HasExited) { throw "Worker started but did not report online. See $stderr and $stdout. Do not start a second worker." }
  $code = $started.ExitCode
  if ($code -eq -1073741819 -and $attempt -lt 3) {
    Write-Warning "Windows crashed Node during startup (0xc0000005). Checking for unfinished work before retry $($attempt + 1)."
    continue
  }
  throw "Worker exited with code $code. Startup error: $stderr. Startup output: $stdout."
}
