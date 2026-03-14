# Run this once to create a desktop shortcut for the Teaching Platform
# Right-click this file and select "Run with PowerShell"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startBat = Join-Path $scriptDir "start.bat"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Teaching Platform.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $startBat
$shortcut.WorkingDirectory = $scriptDir
$shortcut.Description = "Launch Teaching Platform"
$shortcut.WindowStyle = 1
$iconPath = "$env:SystemRoot\System32\shell32.dll"
$shortcut.IconLocation = "$iconPath,23"
$shortcut.Save()

Write-Host ""
Write-Host "Shortcut created on your desktop: Teaching Platform" -ForegroundColor Green
Write-Host ""
Write-Host "Double-click it anytime to launch the app." -ForegroundColor Cyan
Write-Host ""
pause
