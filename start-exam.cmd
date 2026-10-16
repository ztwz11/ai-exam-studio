@echo off
cd /d "%~dp0"
echo AI Exam Studio - http://127.0.0.1:4318
echo Keep this window open while practicing. Press Ctrl+C to stop.
node "exam-app\server.mjs"
if errorlevel 1 pause
