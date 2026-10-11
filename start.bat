@echo off
title Textile ERP POS
cd /d "%~dp0"
echo Starting Textile ERP POS...
start "" http://localhost:3000
node server.js
pause
