@echo off
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%desktop\launch-app.mjs" set "ROOT=%~dp0.."
if exist "%ROOT%\runtime\node.exe" (
  "%ROOT%\runtime\node.exe" "%ROOT%\desktop\launch-app.mjs"
) else (
  node "%ROOT%\desktop\launch-app.mjs"
)
