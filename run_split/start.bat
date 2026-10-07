@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
echo Starting Run Split (port 8520)...
start "" http://localhost:8520/?sim=1^&speed=20
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
) else (
  python server.py
)
pause >nul
