@echo off
setlocal
cd /d "%~dp0"
echo Starting Diario-Questoes...
start http://localhost:3000
npm run dev
pause
