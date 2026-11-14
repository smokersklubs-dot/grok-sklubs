@echo off
rem Windows : se connecte a ton VPS et y installe Sklubot. Double-clique sur ce fichier.
setlocal
chcp 65001 >nul
title Installer Sklubot sur mon VPS
if not defined SKLUBOT_BRANCH set SKLUBOT_BRANCH=claude/trusting-knuth-awqogb
echo.
echo   Installation de Sklubot sur ton VPS
echo   -----------------------------------
echo   Il te faut : l'adresse IP du VPS et son mot de passe administrateur (donnes par ton hebergeur).
echo   A la fin, note le code d'installation affiche : il te sera demande pour creer ton compte.
echo.
where ssh >nul 2>nul
if errorlevel 1 (
  echo   Le programme ssh est introuvable. Sous Windows 10 ou 11 : Parametres ^> Applications ^> Fonctionnalites facultatives ^> ajoute "Client OpenSSH", puis relance.
  pause
  exit /b 1
)
set /p HOST=  Adresse IP (ou nom) du VPS : 
set WHO=root
set /p WHO=  Utilisateur [root] : 
if "%HOST%"=="" (
  echo   Il faut une adresse.
  pause
  exit /b 1
)
set SUDO=
if /i not "%WHO%"=="root" set SUDO=sudo 
echo.
echo   Connexion a %WHO%@%HOST%. La premiere fois, reponds yes a la question sur l'empreinte, puis saisis le mot de passe
echo   (rien ne s'affiche pendant la frappe, c'est normal).
echo.
rem Le script est telecharge dans un fichier temporaire au nom imprevisible (mktemp), pas a un chemin fixe de /tmp.
rem (Pas de guillemets autour de $T : cmd les compterait et couperait la commande ; mktemp donne un chemin sans espace.)
ssh -t %WHO%@%HOST% "T=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/smokersklubs-dot/grok-sklubs/%SKLUBOT_BRANCH%/deploy/install.sh -o $T && %SUDO%env SKLUBOT_BRANCH=%SKLUBOT_BRANCH% bash $T; rm -f $T"
echo.
echo   Termine.
pause
