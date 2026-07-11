@echo off
setlocal
cd /d "%~dp0"
title Study OS
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-study-os.ps1"
pause
