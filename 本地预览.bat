@echo off
setlocal
cd /d "%~dp0"
set PORT=8765
set PY=python
where python >nul 2>nul && goto run
set PY=py
where py >nul 2>nul && goto run
set PY="C:\Users\chw\.workbuddy\binaries\python\versions\3.13.12\python.exe"
:run
echo Starting local server at http://127.0.0.1:%PORT%/ ...
start "book-atlas server" %PY% -m http.server %PORT%
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"
endlocal
