#!/usr/bin/env bash
# Installe Sklubot sur un VPS Linux (Ubuntu ou Debian), en une fois.
#
#   curl -fsSL https://raw.githubusercontent.com/smokersklubs-dot/grok-sklubs/main/deploy/install.sh | sudo bash
#
# Ce que fait ce script : installe Docker s'il manque, récupère Sklubot dans /opt/sklubot, te pose trois
# questions (nom de domaine, clé de modèle, rien d'autre d'obligatoire), écrit la configuration, construit
# et démarre le tout avec le HTTPS automatique. Il peut être relancé sans risque : il garde ta configuration
# et tes données.
#
# Sans questions (pour automatiser), fournis les réponses en variables :
#   SKLUBOT_DOMAIN=bots.exemple.fr ANTHROPIC_API_KEY=... bash install.sh
set -euo pipefail

REPO="${SKLUBOT_REPO:-https://github.com/smokersklubs-dot/grok-sklubs.git}"
BRANCH="${SKLUBOT_BRANCH:-main}"
DIR="${SKLUBOT_DIR:-/opt/sklubot}"
COMPOSE="docker compose -f docker-compose.vps.yml"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31mErreur : %s\033[0m\n' "$*" >&2; exit 1; }

# Les questions se lisent sur le terminal, même quand le script arrive par "curl | bash".
ask() { # ask VARIABLE "question" [secret]
  local var="$1" prompt="$2" secret="${3:-}" answer=""
  if [ -n "${!var:-}" ]; then return; fi
  # No terminal to ask on (automation): keep the answer empty.
  if ! { : </dev/tty; } 2>/dev/null; then printf -v "$var" '%s' ""; return; fi
  if [ -n "$secret" ]; then read -r -s -p "  $prompt " answer </dev/tty; echo; else read -r -p "  $prompt " answer </dev/tty; fi
  printf -v "$var" '%s' "$answer"
}

[ "$(id -u)" -eq 0 ] || die "lance ce script en administrateur (ajoute sudo devant)."
command -v apt-get >/dev/null 2>&1 || command -v docker >/dev/null 2>&1 || die "ce script est prévu pour Ubuntu ou Debian."

say "1/5  Préparation du serveur"
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq git curl openssl ca-certificates >/dev/null
fi
if ! command -v docker >/dev/null 2>&1; then
  info "Installation de Docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
docker compose version >/dev/null 2>&1 || die "Docker est là mais sans « docker compose ». Mets Docker à jour, puis relance."
docker info >/dev/null 2>&1 || { systemctl enable --now docker >/dev/null 2>&1 || true; sleep 3; docker info >/dev/null 2>&1 || die "Docker ne démarre pas."; }
info "Docker $(docker version --format '{{.Server.Version}}') prêt."

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
[ "$MEM_MB" -ge 3500 ] || info "Attention : ce serveur a ${MEM_MB} Mo de mémoire. Compte 2 Go par ordinateur de bot éveillé ; avec moins de 4 Go, un seul bot à la fois sera confortable."

say "2/5  Récupération de Sklubot dans $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH" && git -C "$DIR" checkout --quiet "$BRANCH" && git -C "$DIR" pull --quiet --ff-only origin "$BRANCH"
  info "Mis à jour."
elif [ -f "$DIR/docker-compose.vps.yml" ]; then
  info "Dossier déjà présent (copié à la main) : je l'utilise tel quel."
else
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
  info "Téléchargé."
fi
cd "$DIR"

say "3/5  Configuration"
if [ -f .env ] && grep -q '^SKLUBOT_SESSION_SECRET=.\{32,\}' .env; then
  info "Configuration existante conservée ($DIR/.env)."
else
  info "Nom de domaine : il doit déjà pointer vers l'adresse IP de ce serveur (enregistrement A)."
  info "Laisse vide pour essayer tout de suite sans domaine, en http sur l'adresse IP."
  ask SKLUBOT_DOMAIN "Nom de domaine (ex. bots.exemple.fr) :"
  SKLUBOT_DOMAIN="${SKLUBOT_DOMAIN#http://}"; SKLUBOT_DOMAIN="${SKLUBOT_DOMAIN#https://}"; SKLUBOT_DOMAIN="${SKLUBOT_DOMAIN%%/*}"
  info "Clé de modèle Claude (console.anthropic.com). Laisse vide pour démarrer en mode démo, sans clé ni coût."
  ask ANTHROPIC_API_KEY "Clé ANTHROPIC_API_KEY :" secret

  if [ -n "$SKLUBOT_DOMAIN" ]; then
    PUBLIC_URL="https://$SKLUBOT_DOMAIN"; SITE="$SKLUBOT_DOMAIN"
  else
    IP="${SKLUBOT_PUBLIC_IP:-$(curl -fsS -m 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')}"
    PUBLIC_URL="http://$IP"; SITE=":80"
  fi
  umask 077
  cat > .env <<ENV
# Écrit par deploy/install.sh. Modifie ce fichier puis relance : $COMPOSE up -d
SKLUBOT_PUBLIC_URL=$PUBLIC_URL
SKLUBOT_SITE_ADDRESS=$SITE
SKLUBOT_SESSION_SECRET=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
XAI_API_KEY=${XAI_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
SKLUBOT_DEMO_MODE=$([ -n "${ANTHROPIC_API_KEY:-}${XAI_API_KEY:-}${OPENAI_API_KEY:-}" ] && echo 0 || echo 1)
SKLUBOT_OPEN_SIGNUP=0
SKLUBOT_MAX_DESKTOPS=$([ "$MEM_MB" -ge 7500 ] && echo 4 || { [ "$MEM_MB" -ge 3500 ] && echo 2 || echo 1; })
SKLUBOT_DESKTOP_MEMORY=2g
${SKLUBOT_HTTP_PORT:+SKLUBOT_HTTP_PORT=$SKLUBOT_HTTP_PORT}
${SKLUBOT_HTTPS_PORT:+SKLUBOT_HTTPS_PORT=$SKLUBOT_HTTPS_PORT}
${CADDY_IMAGE:+CADDY_IMAGE=$CADDY_IMAGE}
ENV
  chmod 600 .env
  info "Configuration écrite dans $DIR/.env (lisible par l'administrateur seulement)."
fi
PUBLIC_URL=$(grep '^SKLUBOT_PUBLIC_URL=' .env | cut -d= -f2-)

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  info "Pare-feu : ports 80 et 443 ouverts."
fi

say "4/5  Construction et démarrage (5 à 10 minutes la première fois)"
if [ "${SKLUBOT_SKIP_BUILD:-0}" = "1" ]; then $COMPOSE up -d --no-build; else $COMPOSE up -d --build; fi

say "5/5  Vérification"
ok=0
for _ in $(seq 1 60); do
  if $COMPOSE exec -T sklubot curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || { $COMPOSE logs --tail 30 sklubot || true; die "Sklubot ne répond pas. Les dernières lignes du journal sont ci-dessus."; }
$COMPOSE logs sklubot 2>/dev/null | grep -E "Computers:|Model providers:|No model provider" | sed 's/^[^|]*| /  /' | tail -2

cat <<DONE

$(printf '\033[1;32m')Sklubot est en ligne : $PUBLIC_URL$(printf '\033[0m')

  • Ouvre cette adresse et crée ton compte : le premier compte est le tien, les inscriptions se ferment ensuite.
  • Avec un nom de domaine, le certificat HTTPS peut mettre une minute à arriver au premier accès.
  • Téléphone : iPhone → Safari → Partager → Sur l'écran d'accueil.  Android → $PUBLIC_URL/download/sklubot.apk

  Commandes utiles (dans $DIR) :
    Mettre à jour      bash deploy/update.sh
    Voir le journal    $COMPOSE logs -f sklubot
    Arrêter            $COMPOSE down
    Sauvegarder        bash deploy/backup.sh
    Changer un réglage nano .env   puis   $COMPOSE up -d
DONE
