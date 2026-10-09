@echo off
REM ============================================================
REM  CivicMind - start with the REGULAR database (backend\civicmind.db)
REM  For the hackathon demo with fictional data use run_demo.bat instead.
REM ============================================================
cd /d "%~dp0backend"

where python >nul 2>nul
if errorlevel 1 (
  echo  Python was not found on your PATH. Install Python 3.11+ from https://www.python.org/downloads/
  pause
  exit /b 1
)

echo  Installing dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 ( echo  Dependency install failed. & pause & exit /b 1 )

echo.
echo  Starting CivicMind on http://localhost:8000
echo  No accounts are created automatically. Create an admin once with:
echo      python manage.py create-user --email you@example.org --name "Your Name" --role admin
echo  Citizens can register from the sign-in page.
echo  Press Ctrl+C to stop.
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
