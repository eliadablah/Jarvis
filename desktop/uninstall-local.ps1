$ErrorActionPreference = 'Stop'
$expectedPath = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\Jarvis'))
$actualPath = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not [String]::Equals($actualPath, $expectedPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected uninstall location. No files removed.' }
$installItem = Get-Item -LiteralPath $actualPath -Force
if ($installItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to uninstall through a directory link.' }
$marker = Get-Content -LiteralPath (Join-Path $actualPath 'jarvis-install.json') -Raw | ConvertFrom-Json
if ($marker.appId -ne 'com.eliadablah.jarvis') { throw 'Installation identity did not match.' }
$running = @(Get-Process -Name Jarvis -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $actualPath 'Jarvis.exe') })
if ($running.Count) { throw 'Close Jarvis, then run uninstall again.' }
$linkedChildren = @(Get-ChildItem -LiteralPath $actualPath -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
if ($linkedChildren.Count) { throw 'Installation contains linked paths. No files removed.' }
foreach ($shortcutPath in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Jarvis.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Jarvis.lnk'))) {
  if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
}
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis' -Force -ErrorAction SilentlyContinue
# Both resolved absolute paths and every reparse point were checked above.
# Worker credentials, browser profile and other user files are outside this path.
Remove-Item -LiteralPath $actualPath -Recurse -Force
Write-Output 'Jarvis uninstalled. Existing PC worker and personal settings were preserved.'
