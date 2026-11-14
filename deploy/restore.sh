#!/usr/bin/env bash
# Remet Sklubot dans l'état d'une sauvegarde faite avec deploy/backup.sh.
# ATTENTION : remplace toutes les données actuelles (base, bibliothèques, ordinateurs des bots).
# Le fichier .env doit être celui de la sauvegarde (même SKLUBOT_SESSION_SECRET), sinon le coffre et les connexions ne s'ouvrent plus.
set -euo pipefail
# Les archives et fichiers temporaires contiennent toutes les données : lisibles par l'administrateur seulement.
umask 077
cd "$(dirname "$0")/.."
ARCHIVE="${1:-}"
[ -f "$ARCHIVE" ] || { echo "Utilisation : deploy/restore.sh <sklubot-sauvegarde-….tar>" >&2; exit 1; }
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
IMG="${SKLUBOT_TOOL_IMAGE:-sklubot-desktop}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
tar xf "$ARCHIVE" -C "$WORK"
[ -f "$WORK/data.tar.gz" ] || { echo "Cette archive n'est pas une sauvegarde Sklubot." >&2; exit 1; }

if [ "${SKLUBOT_RESTORE_YES:-}" != "OUI" ]; then
  echo "Toutes les données actuelles de Sklubot vont être remplacées par celles de :"
  echo "  $ARCHIVE"
  read -r -p "Tape OUI pour continuer : " answer
  [ "$answer" = "OUI" ] || { echo "Rien n'a été changé."; exit 1; }
fi

COMPOSE=(docker compose -f docker-compose.vps.yml)
"${COMPOSE[@]}" stop sklubot >/dev/null 2>&1 || true
BOTS=$(docker ps -aq --filter "name=^sklubot-bot_" || true)
[ -n "$BOTS" ] && docker rm -f $BOTS >/dev/null

docker volume create sklubot_data >/dev/null
docker run --rm -v sklubot_data:/data -v "$WORK":/b "$IMG" sh -c 'find /data -mindepth 1 -delete && tar xzf /b/data.tar.gz -C /data'
for v in $(docker volume ls -q --filter "name=^sklubot-home-"); do docker volume rm -f "$v" >/dev/null; done
for f in "$WORK"/homes/*.tar.gz; do
  [ -e "$f" ] || continue
  v="$(basename "$f" .tar.gz)"
  docker volume create "$v" >/dev/null
  docker run --rm -v "$v":/h -v "$WORK/homes":/b "$IMG" tar xzf "/b/$v.tar.gz" -C /h
done
"${COMPOSE[@]}" up -d >/dev/null 2>&1 || true
echo "Restauration terminée depuis $ARCHIVE."
