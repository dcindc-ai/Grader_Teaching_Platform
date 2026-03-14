# Run this once to create a desktop shortcut for the Teaching Platform
# Right-click this file and select "Run with PowerShell"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startBat = Join-Path $scriptDir "start.bat"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Teaching Platform.lnk"

# Create the shortcut
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $startBat
$shortcut.WorkingDirectory = $scriptDir
$shortcut.Description = "Launch Teaching Platform (GEOG 661 / AIN 714)"
$shortcut.WindowStyle = 1

# Try to set a nice icon (uses the default browser icon as fallback)
$iconPath = "$env:SystemRoot\System32\shell32.dll"
$shortcut.IconLocation = "$iconPath,23"

$shortcut.Save()

Write-Host ""
Write-Host "✓ Desktop shortcut created: Teaching Platform" -ForegroundColor Green
Write-Host ""
Write-Host "Double-click 'Teaching Platform' on your desktop to launch." -ForegroundColor Cyan
Write-Host ""
Write-Host "Make sure you have completed the one-time setup first:" -ForegroundColor Yellow
Write-Host "  1. Copy .env.example to .env and add your API key" -ForegroundColor Yellow
Write-Host "  2. Run: cd backend && npm install" -ForegroundColor Yellow
Write-Host "  3. Run: cd frontend && npm install" -ForegroundColor Yellow
Write-Host ""
pause
