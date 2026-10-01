@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0askcosctl.ps1" %*
exit /b %ERRORLEVEL%
