@echo off
REM ============================================================
REM  CivicMind - Windows one-click launcher
REM  Double-click this file, or run it from PowerShell/CMD.
REM ============================================================
cd /d "%~dp0backend"

echo.
echo  ============================================
echo   CivicMind  -  starting up
echo  ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo  Python was not found on your PATH.
  echo  Install it from https://www.python.org/downloads/ and tick
  echo  "Add python.exe to PATH" during setup, then run this again.
  echo.
  pause
  exit /b 1
)

echo  Installing dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo  Dependency install failed. Check the messages above.
  pause
  exit /b 1
)

echo.
echo  Starting CivicMind on http://localhost:8000
echo  Demo logins:  citizen@civicmind.in / citizen123
echo                officer@civicmind.in / officer123
echo                admin@civicmind.in   / admin123
echo.
echo  Press Ctrl+C to stop the server.
echo.

python -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
