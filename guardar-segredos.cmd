@echo off
rem Guarda no Cloudflare a chave do Google e a senha inicial do painel.
rem A chave e a senha vao direto para o Cloudflare: nao ficam no codigo nem aparecem na tela.
chcp 65001 >nul
setlocal
set "EMAIL=studio-erica-goes@studio-erica-goes.iam.gserviceaccount.com"
if not defined PASTA set "PASTA=%USERPROFILE%\Downloads"
set "KEY="
for /f "delims=" %%F in ('dir /b /o-d "%PASTA%\*.json" 2^>nul') do (
  if not defined KEY findstr /c:"%EMAIL%" "%PASTA%\%%F" >nul 2>&1 && set "KEY=%PASTA%\%%F"
)
if not defined KEY (
  echo.
  echo  Nao achei a chave do Google na pasta %PASTA%.
  echo  Baixe a chave JSON da conta de servico no Google Cloud e rode este script de novo.
  exit /b 1
)
if "%~1"=="--teste" ( echo achado: %KEY% & exit /b 0 )

echo.
echo  [1/2] Chave encontrada: %KEY%
echo        Guardando no Cloudflare...
type "%KEY%" | npx.cmd --yes wrangler@4.148.0 pages secret put GOOGLE_SERVICE_ACCOUNT_JSON --project-name studio-erica-goes
if errorlevel 1 ( echo. & echo  Falhou ao guardar a chave. Me mande o que apareceu acima. & exit /b 1 )

echo.
echo  [2/2] Agora a senha inicial do painel /admin.
echo        Quando aparecer "Enter a secret value", digite a senha e aperte Enter.
echo        (Os caracteres nao aparecem enquanto voce digita - e normal.)
call npx.cmd --yes wrangler@4.148.0 pages secret put ADMIN_PASSWORD --project-name studio-erica-goes
if errorlevel 1 ( echo. & echo  Falhou ao guardar a senha. Me mande o que apareceu acima. & exit /b 1 )

echo.
echo  Pronto! Os dois segredos estao no Cloudflare. Pode avisar o Claude.
