@echo off
rem Windows : installe (la premiere fois) puis lance Sklubot sur ce PC. Double-clique sur ce fichier.
rem Le code va dans %USERPROFILE%\Sklubot\code, tes donnees dans %USERPROFILE%\Sklubot\donnees.
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Sklubot sur mon PC
if not defined SKLUBOT_BRANCH set SKLUBOT_BRANCH=claude/trusting-knuth-awqogb
set "BASE=%USERPROFILE%\Sklubot"
set "CODE=%BASE%\code"
set "DATA=%BASE%\donnees"
echo.
echo   Sklubot sur ton PC
echo   ------------------
echo   Les fenetres restent ouvertes tant que Sklubot tourne. Pour l'arreter : ferme cette fenetre.
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo   Git est introuvable. Installe-le depuis https://git-scm.com/download/win ^(choix par defaut^), puis relance ce fichier.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js est introuvable. Installe la version LTS ^(22.13 ou plus recente^) depuis https://nodejs.org , puis relance ce fichier.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo   Ta version de Node.js est trop ancienne. Installe la version LTS depuis https://nodejs.org , puis relance ce fichier.
  pause
  exit /b 1
)

if not exist "%BASE%" mkdir "%BASE%"
if not exist "%DATA%" mkdir "%DATA%"

if not exist "%CODE%\.git" (
  echo   Premiere fois : telechargement du code. Si une fenetre GitHub s'ouvre, connecte-toi avec ton compte GitHub.
  git clone --branch %SKLUBOT_BRANCH% --depth 50 https://github.com/smokersklubs-dot/grok-sklubs.git "%CODE%"
  if errorlevel 1 (
    echo   Le telechargement a echoue. Verifie Internet et ta connexion GitHub, puis relance.
    pause
    exit /b 1
  )
) else (
  echo   Mise a jour du code...
  git -C "%CODE%" fetch origin %SKLUBOT_BRANCH%
  git -C "%CODE%" checkout %SKLUBOT_BRANCH%
  git -C "%CODE%" merge --ff-only origin/%SKLUBOT_BRANCH%
  if errorlevel 1 echo   Mise a jour impossible ^(modification locale ?^). Je lance la version deja installee.
)

rem Fichier de reglages, cree une seule fois. Le secret est fabrique ici, sur ton PC, et n'est montre nulle part.
if not exist "%CODE%\.env" (
  for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "$b=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);($b|ForEach-Object{$_.ToString('x2')}) -join ''"`) do set "SECRET=%%S"
  > "%CODE%\.env" (
    echo SESSION_SECRET=!SECRET!
    echo PORT=8787
    echo PUBLIC_URL=http://localhost:8787
    echo DATA_DIR=%DATA%
  )
  set "SECRET="
)

cd /d "%CODE%"
echo   Installation des modules ^(la premiere fois : quelques minutes^)...
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo   L'installation a echoue. Verifie Internet, evite un dossier synchronise ^(OneDrive^), puis relance.
  pause
  exit /b 1
)
echo   Preparation de l'application...
call npm run build
if errorlevel 1 (
  echo   La preparation a echoue. Copie le message ci-dessus et envoie-le-moi.
  pause
  exit /b 1
)

rem Ordinateurs des bots : il faut Docker Desktop allume. Sans lui, Sklubot marche quand meme, avec un navigateur a la place.
where docker >nul 2>nul
if not errorlevel 1 (
  docker info >nul 2>nul
  if not errorlevel 1 (
    docker image inspect sklubot-desktop >nul 2>nul
    if errorlevel 1 (
      echo   Docker est allume : je prepare l'ordinateur des bots ^(la premiere fois : 10 a 20 minutes^)...
      call npm run computer:build
    )
  ) else (
    echo   Docker Desktop est installe mais pas allume : les bots auront un navigateur au lieu de leur ordinateur Linux.
  )
) else (
  echo   Docker Desktop n'est pas installe : les bots auront un navigateur au lieu de leur ordinateur Linux.
  echo   Pour leur donner leur ordinateur : installe Docker Desktop ^(https://www.docker.com/products/docker-desktop/^), allume-le, relance ce fichier.
)

echo.
echo   Sklubot demarre. Ouvre-le dans ton navigateur : http://localhost:8787
echo   ^(la premiere fois, cree ton compte, puis ajoute ta cle ou ton abonnement dans Reglages ^> Mes comptes IA^)
echo.
rem Le navigateur s'ouvre quelques secondes apres, le temps que le serveur demarre.
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 8; Start-Process 'http://localhost:8787'"
call npm start
echo.
echo   Sklubot s'est arrete.
pause
