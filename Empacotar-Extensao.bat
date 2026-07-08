@echo off
title Empacotador SGD - PowerTools
set "SCRIPT_DIR=%~dp0"
set "SRC_ARG=%SCRIPT_DIR:~0,-1%"

echo ================================================
echo   EMPACOTADOR - SGD PowerTools (Chrome Web Store)
echo ================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Empacotar-Extensao.ps1" -SrcDir "%SRC_ARG%"

set "RESULT=%errorlevel%"

echo.
if "%RESULT%"=="0" (
    color 0A
    echo ================================================
    echo             PACOTE CRIADO COM SUCESSO
    echo ================================================
) else (
    color 0C
    echo ================================================
    echo         ERRO NO PROCESSO DE EMPACOTAMENTO
    echo ================================================
    echo Veja a mensagem em vermelho acima para o detalhe do erro.
)

echo.
echo Pressione qualquer tecla para fechar esta janela...
pause >nul
exit /b %RESULT%
