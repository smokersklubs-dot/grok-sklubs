#!/bin/bash
# Mac (et Linux) : installe (la première fois) puis lance Sklubot sur cet ordinateur.
# Double-clique dessus ; si macOS refuse, lance-le dans le Terminal : bash "Lancer Sklubot sur mon PC.command"
# Le code va dans ~/Sklubot/code, tes données dans ~/Sklubot/donnees.
set -u
BRANCH="${SKLUBOT_BRANCH:-claude/trusting-knuth-awqogb}"
BASE="$HOME/Sklubot"
CODE="$BASE/code"
DATA="$BASE/donnees"
PORT="${PORT:-8787}"

pause() { read -r -p "  Appuie sur Entrée pour fermer…" _; }
fail() { echo; echo "  $1"; pause; exit 1; }

echo
echo "  Sklubot sur ton ordinateur"
echo "  --------------------------"
echo "  Cette fenêtre reste ouverte tant que Sklubot tourne. Pour l'arrêter : ferme-la (ou Ctrl+C)."
echo

command -v git >/dev/null 2>&1 || fail "Git est introuvable. Sur Mac : tape « xcode-select --install » dans le Terminal, puis relance ce fichier."
command -v node >/dev/null 2>&1 || fail "Node.js est introuvable. Installe la version LTS (22.13 ou plus récente) depuis https://nodejs.org , puis relance ce fichier."
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" \
  || fail "Ta version de Node.js est trop ancienne. Installe la version LTS depuis https://nodejs.org , puis relance ce fichier."

mkdir -p "$BASE" "$DATA"

if [ ! -d "$CODE/.git" ]; then
  echo "  Première fois : téléchargement du code. Si GitHub te demande de te connecter, fais-le avec ton compte."
  git clone --branch "$BRANCH" --depth 50 https://github.com/smokersklubs-dot/grok-sklubs.git "$CODE" \
    || fail "Le téléchargement a échoué. Vérifie Internet et ta connexion GitHub, puis relance."
else
  echo "  Mise à jour du code…"
  git -C "$CODE" fetch origin "$BRANCH" && git -C "$CODE" checkout "$BRANCH" && git -C "$CODE" merge --ff-only "origin/$BRANCH" \
    || echo "  Mise à jour impossible (modification locale ?). Je lance la version déjà installée."
fi

# Fichier de réglages, créé une seule fois. Le secret est fabriqué ici, sur ton ordinateur, et n'est montré nulle part.
if [ ! -f "$CODE/.env" ]; then
  umask 077
  {
    echo "SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    echo "PORT=$PORT"
    echo "PUBLIC_URL=http://localhost:$PORT"
    echo "DATA_DIR=$DATA"
  } > "$CODE/.env"
  umask 022
fi

cd "$CODE" || fail "Dossier du code introuvable : $CODE"
echo "  Installation des modules (la première fois : quelques minutes)…"
npm ci --no-audit --no-fund || fail "L'installation a échoué. Vérifie Internet, évite un dossier synchronisé (iCloud, Dropbox), puis relance."
echo "  Préparation de l'application…"
npm run build || fail "La préparation a échoué. Copie le message ci-dessus et envoie-le-moi."

# Ordinateurs des bots : il faut Docker Desktop allumé. Sans lui, Sklubot marche quand même, avec un navigateur à la place.
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    if ! docker image inspect sklubot-desktop >/dev/null 2>&1; then
      echo "  Docker est allumé : je prépare l'ordinateur des bots (la première fois : 10 à 20 minutes)…"
      npm run computer:build || echo "  L'ordinateur des bots n'a pas pu être préparé : les bots auront un navigateur à la place."
    fi
  else
    echo "  Docker Desktop est installé mais pas allumé : les bots auront un navigateur au lieu de leur ordinateur Linux."
  fi
else
  echo "  Docker Desktop n'est pas installé : les bots auront un navigateur au lieu de leur ordinateur Linux."
  echo "  Pour leur donner leur ordinateur : installe Docker Desktop (https://www.docker.com/products/docker-desktop/), allume-le, relance ce fichier."
fi

echo
echo "  Sklubot démarre. Ouvre-le dans ton navigateur : http://localhost:$PORT"
echo "  (la première fois, crée ton compte, puis ajoute ta clé ou ton abonnement dans Réglages > Mes comptes IA)"
echo
( sleep 8; if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT"; fi ) >/dev/null 2>&1 &
npm start
echo
echo "  Sklubot s'est arrêté."
pause
