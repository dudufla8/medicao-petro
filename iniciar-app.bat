@echo off
title Táxi 2.0 - Medição Petrobras
echo ========================================================
echo       TAXI 2.0 - APP DE MEDICAO E CONCILIACAO
echo       Contrato Petrobras SAP: 4600686169
echo ========================================================
echo.
echo Iniciando servidor local...
cd /d "%~dp0"
start "" http://localhost:5173/
npm run dev
pause
