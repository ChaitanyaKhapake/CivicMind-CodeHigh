@echo off
REM ============================================================
REM  CivicMind - DEMO mode with an ISOLATED, FICTIONAL database
REM    database : data\demo\civicmind_demo.db
REM    logins   : data\demo\demo_credentials.txt   (generated locally)
REM    proof    : data\demo\sample_proof_photo.jpg (for the officer step)
REM  Your regular backend\civicmind.db is never touched.
REM  Add  --reset  to rebuild the demo data from scratch:  run_demo.bat --reset
REM ============================================================
cd /d "%~dp0backend"
set "CIVICMIND_DB=%~dp0data\demo\civicmind_demo.db"
set "CIVICMIND_EVIDENCE_DIR=%~dp0data\demo\evidence"
set "CIVICMIND_DEMO_MODE=1"
REM Address search and "Use my current location" address autofill via the public Nominatim service
REM (OpenStreetMap; max 1 request/s, explicit clicks only). Set CIVICMIND_REVERSE_GEOCODER=none to turn off.
if not defined CIVICMIND_REVERSE_GEOCODER set "CIVICMIND_REVERSE_GEOCODER=nominatim"

python -m pip install -q -r requirements.txt
if errorlevel 1 ( echo  Dependency install failed. & pause & exit /b 1 )

python seed_demo.py --db "%CIVICMIND_DB%" %1
if errorlevel 1 ( echo  Demo seeding failed. & pause & exit /b 1 )

echo.
echo  Demo running on http://localhost:8000   (Ctrl+C to stop)
echo  Demo logins are in data\demo\demo_credentials.txt
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
