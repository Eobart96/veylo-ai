@echo off
setlocal
if not exist "%~dp0src-tauri\target\debug\veylo-ai.exe" (
  echo Veylo AI has not been built yet.
  echo Run npm.cmd run desktop:app in this folder, then try again.
  pause
  exit /b 1
)
start "" "%~dp0src-tauri\target\debug\veylo-ai.exe"
