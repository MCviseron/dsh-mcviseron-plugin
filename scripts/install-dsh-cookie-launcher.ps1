param(
  [string]$ExePath = 'D:\DeepSeek Harness\DeepSeek Harness.exe',
  [string]$LauncherDir = (Join-Path $env:LOCALAPPDATA 'dsh-mcviseron')
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'dsh-cookie-launcher'
if (-not (Test-Path -LiteralPath $ExePath)) { throw "DSH executable not found: $ExePath" }
if (-not (Test-Path -LiteralPath $source)) { throw "launcher sources not found: $source" }

New-Item -ItemType Directory -Force -Path $LauncherDir | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'clean-dsh-auth-cookies.py') -Destination $LauncherDir -Force
Copy-Item -LiteralPath (Join-Path $source 'launch-dsh.vbs') -Destination $LauncherDir -Force

$ws = New-Object -ComObject WScript.Shell
$roots = @(
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
  'C:\Users\Public\Desktop'
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -Unique

$changed = 0
foreach ($root in $roots) {
  Get-ChildItem -LiteralPath $root -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    $lnk = $_.FullName
    $shortcut = $ws.CreateShortcut($lnk)
    if ($shortcut.TargetPath -ne $ExePath) { return }
    $backup = "$lnk.bak-dsh-cookie"
    if (-not (Test-Path -LiteralPath $backup)) {
      Copy-Item -LiteralPath $lnk -Destination $backup -Force
    }
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $shortcut.Arguments = '//nologo "' + (Join-Path $LauncherDir 'launch-dsh.vbs') + '"'
    $shortcut.WorkingDirectory = Split-Path -Parent $ExePath
    $shortcut.IconLocation = "$ExePath,0"
    $shortcut.Description = 'DeepSeek Harness (clears stale DSH auth cookies before launch)'
    $shortcut.Save()
    $changed += 1
    Write-Output "updated: $lnk"
  }
}

if ($changed -eq 0) {
  Write-Output 'no DSH shortcut was changed; check the Start Menu shortcut target'
} else {
  Write-Output "changed $changed shortcut(s); launcher: $LauncherDir"
}
