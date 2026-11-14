#!/usr/bin/env bash
# Sauvegarde toutes les données de Sklubot dans une archive datée :
#  - la base et les bibliothèques des bots (volume sklubot_data),
#  - le dossier personnel de chaque ordinateur de bot (connexions Claude/ChatGPT, outils installés).
# Sklubot est mis en pause quelques secondes pendant la copie, pour que la base soit copiée d'un seul bloc.
# Restaurer : deploy/restore.sh <archive>
set -euo pipefail
# Les archives et fichiers temporaires contiennent toutes les données : lisibles par l'administrateur seulement.
umask 077
cd "$(dirname "$0")/.."
DEST="$(cd "${1:-$PWD}" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/sklubot-sauvegarde-$STAMP.tar"
IMG="${SKLUBOT_TOOL_IMAGE:-sklubot-desktop}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

docker volume inspect sklubot_data >/dev/null 2>&1 || { echo "Aucune donnée Sklubot trouvée (volume sklubot_data absent)." >&2; exit 1; }
COMPOSE=(docker compose -f docker-compose.vps.yml)
RUNNING=0
if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx sklubot; then RUNNING=1; fi
BOTS=$(docker ps -q --filter "name=^sklubot-bot_" || true)
resume() {
  [ -n "$BOTS" ] && docker start $BOTS >/dev/null 2>&1 || true
  [ "$RUNNING" = 1 ] && "${COMPOSE[@]}" start sklubot >/dev/null 2>&1 || true
}
trap 'resume; rm -rf "$WORK"' EXIT
[ "$RUNNING" = 1 ] && { echo "Pause de Sklubot pendant la copie…"; "${COMPOSE[@]}" stop sklubot >/dev/null; }
[ -n "$BOTS" ] && docker stop $BOTS >/dev/null

docker run --rm -v sklubot_data:/data:ro -v "$WORK":/b "$IMG" tar czf /b/data.tar.gz -C /data .
mkdir -p "$WORK/homes"
for v in $(docker volume ls -q --filter "name=^sklubot-home-"); do
  docker run --rm -v "$v":/h:ro -v "$WORK/homes":/b "$IMG" tar czf "/b/$v.tar.gz" -C /h .
done
resume; trap 'rm -rf "$WORK"' EXIT
tar cf "$OUT" -C "$WORK" .
echo "Sauvegarde écrite : $OUT ($(du -h "$OUT" | cut -f1), $(ls "$WORK/homes" | wc -l) ordinateur(s) de bot)"
echo "Garde aussi une copie de ton fichier .env : il contient le secret qui déchiffre le coffre et les connexions."
