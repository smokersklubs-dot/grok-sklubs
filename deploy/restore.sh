#!/usr/bin/env bash
# Remet Sklubot dans l'état d'une sauvegarde faite avec deploy/backup.sh.
# ATTENTION : remplace toutes les données actuelles (base, bibliothèques, ordinateurs des bots).
# Le fichier .env doit être celui de la sauvegarde (même SKLUBOT_SESSION_SECRET), sinon le coffre et les connexions ne s'ouvrent plus.
# Les secrets sont dans l'archive (secrets.env.age ou secrets.env.enc) ou à part (secrets/…) : voir docs/SAUVEGARDE.md.
# Archives des deux formats : l'ancien (base dans data.tar.gz) et le nouveau (copie en ligne de la base : db.sqlite).
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
if [ -f "$WORK/SHA256SUMS" ]; then
  (cd "$WORK" && sha256sum --quiet -c SHA256SUMS) || { echo "Les empreintes de l'archive ne correspondent pas (fichier abîmé ?). Rien n'a été changé." >&2; exit 1; }
fi
DBREL="sklubot.db"
if [ -f "$WORK/manifest.json" ]; then
  p="$(sed -n 's/.*"dbPath":"\([^"]*\)".*/\1/p' "$WORK/manifest.json")"
  [ -n "$p" ] && DBREL="$p"
fi

if [ "${SKLUBOT_RESTORE_YES:-}" != "OUI" ]; then
  echo "Toutes les données actuelles de Sklubot vont être remplacées par celles de :"
  echo "  $ARCHIVE"
  read -r -p "Tape OUI pour continuer : " answer
  [ "$answer" = "OUI" ] || { echo "Rien n'a été changé."; exit 1; }
fi

COMPOSE=(docker compose -f docker-compose.vps.yml)
# Installation VPS (ce dossier fait tourner Sklubot) : on l'arrête puis la relance. Ailleurs (Coolify, ou une simple copie
# des scripts), on ne lance RIEN avec ce fichier compose : Sklubot doit déjà être arrêté (depuis Coolify).
VPS=0
[ -n "$("${COMPOSE[@]}" ps -aq sklubot 2>/dev/null)" ] && VPS=1
if [ "$VPS" = 1 ]; then "${COMPOSE[@]}" stop sklubot >/dev/null 2>&1 || true
elif [ -n "$(docker ps -q --filter volume=sklubot_data --filter label=com.docker.compose.service=sklubot)" ]; then
  echo "Sklubot tourne encore (hors de ce dossier, par exemple sous Coolify) : arrête-le d'abord, puis relance ce script." >&2; exit 1
fi
BOTS=$(docker ps -aq --filter "name=^sklubot-bot_" || true)
[ -n "$BOTS" ] && docker rm -f $BOTS >/dev/null

docker volume create sklubot_data >/dev/null
docker run --rm -v sklubot_data:/data -v "$WORK":/b "$IMG" sh -c 'find /data -mindepth 1 -delete && tar xzf /b/data.tar.gz -C /data && if [ -f /b/db.sqlite ]; then cp /b/db.sqlite "/data/$1"; fi' sh "$DBREL"
for v in $(docker volume ls -q --filter "name=^sklubot-home-"); do docker volume rm -f "$v" >/dev/null; done
for f in "$WORK"/homes/*.tar.gz; do
  [ -e "$f" ] || continue
  v="$(basename "$f" .tar.gz)"
  docker volume create "$v" >/dev/null
  docker run --rm -v "$v":/h -v "$WORK/homes":/b "$IMG" tar xzf "/b/$v.tar.gz" -C /h
done
if [ "$VPS" = 1 ]; then "${COMPOSE[@]}" up -d >/dev/null 2>&1 || true
else echo "Redémarre maintenant Sklubot (par exemple depuis Coolify), avec le même SKLUBOT_SESSION_SECRET que la sauvegarde."; fi
echo "Restauration terminée depuis $ARCHIVE."
if [ -f "$WORK/secrets.env.age" ] || [ -f "$WORK/secrets.env.enc" ]; then
  echo "Les secrets de cette sauvegarde sont chiffrés dans l'archive. Pour les relire (et remettre SKLUBOT_SESSION_SECRET dans .env) :"
  if [ -f "$WORK/secrets.env.age" ]; then echo "  tar xOf \"$ARCHIVE\" ./secrets.env.age | age -d -i <ta-clé-privée-age>"; fi
  if [ -f "$WORK/secrets.env.enc" ]; then echo "  tar xOf \"$ARCHIVE\" ./secrets.env.enc | openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:<fichier-phrase>"; fi
fi
exit 0
