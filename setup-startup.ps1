$WshShell = New-Object -ComObject WScript.Shell
$ShortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\DiarioQuestoes.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "$PSScriptRoot\start-app.bat"
$Shortcut.WorkingDirectory = "$PSScriptRoot"
$Shortcut.Description = "Starts the Diario-Questoes dev server on login"
$Shortcut.Save()
Write-Host "Success! Shortcut created in Windows Startup folder: $ShortcutPath"
