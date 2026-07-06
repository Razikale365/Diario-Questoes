$WshShell = New-Object -ComObject WScript.Shell
$StartupFolder = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$LegacyShortcutPath = Join-Path $StartupFolder "DiarioQuestoes.lnk"
$ShortcutPath = Join-Path $StartupFolder "StudySystemFiscal.lnk"

if (Test-Path $LegacyShortcutPath) {
    Remove-Item -LiteralPath $LegacyShortcutPath -Force
}

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "$PSScriptRoot\start-app.bat"
$Shortcut.WorkingDirectory = "$PSScriptRoot"
$Shortcut.Description = "Starts the Study System Fiscal app on login"
$Shortcut.Save()
Write-Host "Success! Shortcut created in Windows Startup folder: $ShortcutPath"
