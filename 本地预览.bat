@echo off
setlocal
cd /d "%~dp0"
set PORT=8765
set PY=python
where python >nul 2>nul && goto run
set PY=py
where py >nul 2>nul && goto run
echo Python not found. Please install Python 3 (https://www.python.org/downloads/)
echo and tick "Add python.exe to PATH", then run this file again.
echo Or start a server by hand:  python -m http.server %PORT%
echo then open http://127.0.0.1:%PORT%/
pause
exit /b 1
:run
echo Starting local server at http://127.0.0.1:%PORT%/ ...
start "book-atlas server" %PY% -m http.server %PORT%
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"
endlocal
