@echo off
title SGM-Historicos - Sistema Municipal de Acervo Passivo

echo ======================================================================
echo   SGM-Historicos - Sistema Municipal de Acervo Passivo e Historico
echo   Prefeitura Municipal - Secretaria Municipal de Educacao
echo ======================================================================
echo.

REM 1. Verifica se o Python esta instalado
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] O Python nao foi encontrado no sistema!
    echo Por favor, instale o Python 3.11 ou superior e marque "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

REM 2. Verifica se as dependencias essenciais estao instaladas
python -c "import fastapi, uvicorn, PIL, cv2" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [AVISO] Dependencias nao encontradas. Instalando pacotes do requirements.txt...
    python -m pip install -r requirements.txt
    if %ERRORLEVEL% NEQ 0 (
        echo [ERRO] Falha ao instalar dependencias. Verifique sua conexao com a internet.
        pause
        exit /b 1
    )
)

REM 3. Carrega chave de API e modelo do Gemini a partir do .env caso exista
if exist .env (
    for /f "usebackq tokens=1,* delims==" %%G in (".env") do (
        if "%%G"=="GEMINI_API_KEY" (
            if "%GEMINI_API_KEY%"=="" set "GEMINI_API_KEY=%%H"
        )
        if "%%G"=="GEMINI_MODEL" (
            if "%GEMINI_MODEL%"=="" set "GEMINI_MODEL=%%H"
        )
    )
)

REM 4. Inicia o aplicativo desktop nativo
echo [INFO] Iniciando sistema desktop...
python app_window.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [AVISO] O aplicativo encerrou com codigo %ERRORLEVEL%.
    pause
)
