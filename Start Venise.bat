@echo off
rem Double-click to run Venise from source (needs Node.js from https://nodejs.org).
cd /d "%~dp0"
if not exist node_modules (
  echo Installing Venise for the first time, this takes a minute...
  call npm install || (pause & exit /b 1)
)
start "" "%~dp0node_modules\electron\dist\electron.exe" .
