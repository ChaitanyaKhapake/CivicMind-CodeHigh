@echo off
REM ============================================================
REM  CivicMind - DEMO server reachable by the citizen Android app on the same Wi-Fi.
REM    Same isolated demo database as run_demo.bat, but listens on all network interfaces
REM    (0.0.0.0) and accepts requests from the app (origin https://localhost).
REM    Windows may ask to allow Python through the firewall: allow PRIVATE networks only.
REM    In the app, set the server to  http://<this-PC's-IP>:8000   (shown below).
REM  Use only on a trusted network. For real users, deploy behind HTTPS (docs\DEPLOYMENT.md).
REM ============================================================
cd /d "%~dp0backend"
set "CIVICMIND_DB=%~dp0data\demo\civicmind_demo.db"
set "CIVICMIND_EVIDENCE_DIR=%~dp0data\demo\evidence"
set "CIVICMIND_DEMO_MODE=1"
set "CIVICMIND_CORS_ORIGINS=https://localhost"
if not defined CIVICMIND_REVERSE_GEOCODER set "CIVICMIND_REVERSE_GEOCODER=nominatim"

python -m pip install -q -r requirements.txt
if errorlevel 1 ( echo  Dependency install failed. & pause & exit /b 1 )
python seed_demo.py --db "%CIVICMIND_DB%"
if errorlevel 1 ( echo  Demo seeding failed. & pause & exit /b 1 )

echo.
echo  Server address(es) to enter in the CivicMind app:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     http://%%a:8000
echo  (remove the space after http://)   Ctrl+C to stop.
echo.
python -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
