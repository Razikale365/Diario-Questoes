@echo off
setlocal
cd /d "%~dp0"
title Study System Fiscal
echo Starting Study System Fiscal from %CD%...
start http://localhost:3000
npm run dev
pause
