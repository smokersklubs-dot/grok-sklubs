#!/usr/bin/env bash
# Désinstalle complètement Sklubot d'un VPS installé avec deploy/install.sh.
#
#   sudo bash /opt/sklubot/deploy/uninstall.sh              (demande une sauvegarde, puis « OUI »)
#   sudo bash /opt/sklubot/deploy/uninstall.sh --dry-run    (montre seulement ce qui serait supprimé)
#
# Ce qui est supprimé, dans cet ordre (rien d'autre n'est touché) :
#   1. les ordinateurs des bots (conteneurs « sklubot=desktop ») : arrêtés d'abord, puis supprimés — y compris les
#      outils qui tournaient dedans (Claude Code, Codex), qui sinon survivraient à l'arrêt de l'application ;
#   2. les conteneurs de l'application : Sklubot, le proxy Docker filtrant (socket proxy), Caddy ;
#   3. les volumes : données (base, bibliothèques), dossier personnel de chaque ordinateur de bot (profils de navigateur,
#      connexions), certificats et réglages de Caddy ;
#   4. les réseaux sklubot_net, sklubot_docker et sklubot_voice ;
#   5. les images construites ou téléchargées pour Sklubot (une image encore utilisée par autre chose est gardée) ;
#   6. le dossier d'installation (code, fichier .env).
# Docker lui-même, le pare-feu et tes autres conteneurs restent en place.
#
# Options : --dry-run (rien n'est supprimé) · --no-backup (ne propose pas de sauvegarde) · --keep-images.
# Sans terminal (automatisation) : SKLUBOT_CONFIRM=OUI, et SKLUBOT_BACKUP=1 ou 0.
# Relançable sans risque : ce qui n'existe plus est simplement ignoré.
set -uo pipefail

DRY=0; BACKUP_OFFER=1; KEEP_IMAGES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY=1 ;;
    --no-backup) BACKUP_OFFER=0 ;;
    --keep-images) KEEP_IMAGES=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) printf 'Option inconnue : %s (voir --help)\n' "$arg" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${SKLUBOT_DIR:-$(cd "$HERE/.." && pwd)}"
PROJECT="${SKLUBOT_PROJECT:-$(basename "$DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')}"
BACKUP_DIR="${SKLUBOT_BACKUP_DIR:-${HOME:-/root}}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31mErreur : %s\033[0m\n' "$*" >&2; exit 1; }
# Les réponses se lisent sur le terminal quand il y en a un, sinon sur l'entrée standard.
ask() { local answer=""; if { : </dev/tty; } 2>/dev/null; then read -r -p "  $1 " answer </dev/tty; else read -r answer || true; fi; printf '%s' "$answer"; }

command -v docker >/dev/null 2>&1 || die "Docker est introuvable : il n'y a rien de Sklubot à retirer ici."
[ "$DRY" = 1 ] || [ "$(id -u)" -eq 0 ] || [ "${SKLUBOT_ALLOW_NONROOT:-0}" = 1 ] || die "lance ce script en administrateur (ajoute sudo devant)."

# ── Inventaire : seulement ce que Sklubot a créé ─────────────────────────────
inventory() {
  BOTS=$(docker ps -a --filter "label=sklubot=desktop" --format '{{.Names}}' 2>/dev/null | sort -u)
  APPS=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}' 2>/dev/null | sort -u)
  VOLUMES=$(docker volume ls -q 2>/dev/null | grep -E "^(sklubot_data|sklubot-home-.+|${PROJECT}_caddy_data|${PROJECT}_caddy_config)$" | sort -u)
  NETWORKS=$(docker network ls --format '{{.Name}}' 2>/dev/null | grep -E '^(sklubot_net|sklubot_docker|sklubot_voice)$' | sort -u)
  IMAGES=""
  if [ "$KEEP_IMAGES" = 0 ]; then
    IMAGES=$(docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^(sklubot-server|sklubot-desktop|tecnativa/docker-socket-proxy|caddy|public\.ecr\.aws/docker/library/caddy):' | sort -u)
  fi
  INSTALL=""
  [ -f "$DIR/docker-compose.vps.yml" ] && INSTALL="$DIR"
}
count() { [ -z "$1" ] && echo 0 || printf '%s\n' "$1" | grep -c .; }
show() { # show "titre" "liste"
  [ -z "$2" ] && return
  info "$1 ($(count "$2")) :"
  printf '%s\n' "$2" | sed 's/^/      - /'
}

inventory
say "Sklubot sur cette machine (projet « $PROJECT », dossier $DIR)"
if [ -z "$BOTS$APPS$VOLUMES$NETWORKS$IMAGES$INSTALL" ]; then info "Rien à retirer : Sklubot n'est pas (ou plus) installé ici."; exit 0; fi
show "Ordinateurs des bots (conteneurs)" "$BOTS"
show "Conteneurs de l'application (Sklubot, proxy Docker, Caddy)" "$APPS"
show "Volumes (données, dossiers des ordinateurs, certificats)" "$VOLUMES"
show "Réseaux" "$NETWORKS"
show "Images" "$IMAGES"
[ -n "$INSTALL" ] && info "Dossier d'installation : $INSTALL"

if [ "$DRY" = 1 ]; then
  say "Mode essai : rien n'a été supprimé."
  info "Pour tout retirer : sudo bash $HERE/uninstall.sh"
  exit 0
fi

# ── Sauvegarde d'abord (proposée) ────────────────────────────────────────────
if [ "$BACKUP_OFFER" = 1 ] && printf '%s\n' "$VOLUMES" | grep -qx sklubot_data; then
  say "Sauvegarde"
  info "La désinstallation efface la base, les bibliothèques des bots et leurs connexions."
  want="${SKLUBOT_BACKUP:-}"
  [ -z "$want" ] && want=$(ask "Faire une sauvegarde dans $BACKUP_DIR avant de tout effacer ? (O/n)")
  case "$want" in
    n|N|non|NON|0) info "Pas de sauvegarde." ;;
    *)
      [ -f "$HERE/backup.sh" ] || die "deploy/backup.sh est introuvable : sauvegarde impossible, rien n'a été supprimé."
      mkdir -p "$BACKUP_DIR"
      bash "$HERE/backup.sh" "$BACKUP_DIR" || die "la sauvegarde a échoué : rien n'a été supprimé."
      [ -f "$DIR/.env" ] && { cp "$DIR/.env" "$BACKUP_DIR/sklubot-env-$(date +%Y%m%d-%H%M%S)"; chmod 600 "$BACKUP_DIR"/sklubot-env-* 2>/dev/null; info "Copie du fichier .env gardée dans $BACKUP_DIR (il déchiffre le coffre)."; }
      ;;
  esac
fi

# ── Confirmation explicite ───────────────────────────────────────────────────
say "Confirmation"
info "Tout ce qui est listé plus haut va être supprimé définitivement."
confirm="${SKLUBOT_CONFIRM:-}"
[ -z "$confirm" ] && confirm=$(ask "Tape OUI (en majuscules) pour tout supprimer :")
[ "$confirm" = "OUI" ] || { info "Annulé : rien n'a été supprimé."; exit 1; }

REMOVED=()
FAILED=()
KEPT=()
did() { if "$@" >/dev/null 2>&1; then return 0; else return 1; fi; }

say "Suppression"
# 1. Les ordinateurs des bots d'abord : les outils qui y tournent survivraient à l'arrêt de l'application.
for c in $BOTS; do
  did docker stop -t 5 "$c"
  if did docker rm -f "$c"; then REMOVED+=("ordinateur de bot $c"); else FAILED+=("conteneur $c"); fi
done
# 2. L'application, le proxy Docker et Caddy.
for c in $APPS; do
  did docker stop -t 10 "$c"
  if did docker rm -f "$c"; then REMOVED+=("conteneur $c"); else FAILED+=("conteneur $c"); fi
done
# 3. Les volumes (un conteneur qui les utilisait encore vient d'être retiré).
for v in $VOLUMES; do
  if did docker volume rm -f "$v"; then REMOVED+=("volume $v"); else FAILED+=("volume $v"); fi
done
# 4. Les réseaux.
for n in $NETWORKS; do
  if did docker network rm "$n"; then REMOVED+=("réseau $n"); else FAILED+=("réseau $n"); fi
done
# 5. Les images (sans forcer : une image dont un autre conteneur se sert reste).
for i in $IMAGES; do
  if did docker image rm "$i"; then REMOVED+=("image $i"); else KEPT+=("image $i (encore utilisée par un autre conteneur)"); fi
done
# 6. Le dossier d'installation, seulement s'il ressemble bien à une installation de Sklubot.
if [ -n "$INSTALL" ]; then
  case "$INSTALL" in
    /|/root|/home|/opt|/usr|/etc|/var) FAILED+=("dossier $INSTALL (refusé : dossier système)") ;;
    *) cd / && if rm -rf -- "$INSTALL"; then REMOVED+=("dossier $INSTALL"); else FAILED+=("dossier $INSTALL"); fi ;;
  esac
fi

say "Retiré"
if [ "${#REMOVED[@]}" -eq 0 ]; then info "rien"; else for r in "${REMOVED[@]}"; do info "✓ $r"; done; fi
inventory
LEFT="$BOTS$APPS$VOLUMES$NETWORKS$INSTALL"
say "Ce qui reste"
if [ "${#FAILED[@]}" -gt 0 ]; then for f in "${FAILED[@]}"; do info "✗ $f"; done; fi
if [ "${#KEPT[@]}" -gt 0 ]; then for k in "${KEPT[@]}"; do info "• $k"; done; fi
if [ -z "$LEFT" ]; then info "Plus rien de Sklubot ne tourne ni n'est stocké ici (hors sauvegardes)."; fi
info "Gardés volontairement : Docker lui-même, les règles du pare-feu (ports 80 et 443), tes sauvegardes."
[ -z "$LEFT" ] && [ "${#FAILED[@]}" -eq 0 ] && exit 0
exit 1
