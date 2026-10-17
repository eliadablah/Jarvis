# Per-user installation from the allowlisted, locally built release payload.
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot 'release\win-unpacked'
$targetPath = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\Jarvis'))
if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'Jarvis.exe'))) { throw 'Build the desktop payload first.' }
if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'resources\app.asar'))) { throw 'Packaged dashboard application missing.' }
if ((Test-Path -LiteralPath $targetPath) -and -not (Test-Path -LiteralPath (Join-Path $targetPath 'jarvis-install.json'))) { throw 'An existing unrecognized installation is present. No files changed.' }
$running = @(Get-Process -Name Jarvis -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $targetPath 'Jarvis.exe') })
if ($running.Count) { throw 'Close the installed Jarvis app before updating.' }
New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
Copy-Item -Path (Join-Path $sourcePath '*') -Destination $targetPath -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall-local.ps1') -Destination (Join-Path $targetPath 'Uninstall.ps1') -Force
$sourceHash = (Get-FileHash -LiteralPath (Join-Path $sourcePath 'Jarvis.exe') -Algorithm SHA256).Hash
$targetHash = (Get-FileHash -LiteralPath (Join-Path $targetPath 'Jarvis.exe') -Algorithm SHA256).Hash
if ($sourceHash -ne $targetHash) { throw 'Installed executable verification failed.' }
[IO.File]::WriteAllText((Join-Path $targetPath 'jarvis-install.json'), (@{ appId='com.eliadablah.jarvis'; version='0.1.0'; executableSha256=$targetHash; server='https://dev-jarvis.eliadablah.com'; installedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcutPaths = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Jarvis.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Jarvis.lnk'))
foreach ($shortcutPath in $shortcutPaths) {
  $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $targetPath 'Jarvis.exe'
  $shortcut.Arguments = '--diagnostics'
  $shortcut.WorkingDirectory = $targetPath
  $shortcut.IconLocation = (Join-Path $targetPath 'Jarvis.exe') + ',0'
  $shortcut.Description = 'Jarvis personal dashboard'
  $shortcut.Save()
}
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis'
New-Item -Path $uninstallKey -Force | Out-Null
$uninstallCommand = '"' + (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') + '" -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $targetPath 'Uninstall.ps1') + '"'
$values = @{ DisplayName='Jarvis'; DisplayVersion='0.1.0'; Publisher='Elikem Adablah'; InstallLocation=$targetPath; DisplayIcon=(Join-Path $targetPath 'Jarvis.exe'); UninstallString=$uninstallCommand }
foreach ($key in $values.Keys) { New-ItemProperty -Path $uninstallKey -Name $key -Value $values[$key] -PropertyType String -Force | Out-Null }
New-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null
Write-Output ('Installed and verified: ' + (Join-Path $targetPath 'Jarvis.exe'))
foreach ($shortcutPath in $shortcutPaths) { Write-Output ('Shortcut: ' + $shortcutPath) }
