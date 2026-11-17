#!/usr/bin/env bash
# Met Sklubot à jour sur le VPS : sauvegarde d'abord (deploy/backup.sh, sans arrêter le service), puis récupère la
# dernière version, reconstruit, redémarre. Les données sont conservées ; au démarrage, la nouvelle version fait aussi
# une copie de la base avant toute migration (server/src/migrations).
#   SKLUBOT_UPDATE_SKIP_BACKUP=1  : passer la sauvegarde (déconseillé).
#   Les réglages de la sauvegarde (dossier, chiffrement, rotation, copie distante) sont ceux de deploy/backup.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${SKLUBOT_UPDATE_SKIP_BACKUP:-}" != "1" ] && docker volume inspect sklubot_data >/dev/null 2>&1; then
  echo "Sauvegarde avant la mise à jour…"
  if ! deploy/backup.sh; then
    echo "La sauvegarde a échoué : mise à jour annulée, rien n'a changé. (SKLUBOT_UPDATE_SKIP_BACKUP=1 pour passer outre.)" >&2
    exit 1
  fi
fi
[ -d .git ] && git pull --ff-only
# Kokoro (voix gratuites, ~1 à 1,5 Go) tourne désormais par défaut : sur une machine de moins de 3,5 Go qui n'a encore
# rien choisi, il reste en veille (même règle que deploy/install.sh). SKLUBOT_KOKORO=1 dans .env pour l'activer.
if [ -f .env ] && ! grep -q '^SKLUBOT_KOKORO=' .env && [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)" -lt 3500 ]; then
  echo "SKLUBOT_KOKORO=0" >> .env
  echo "Kokoro laissé en veille (moins de 3,5 Go de mémoire) : SKLUBOT_KOKORO=1 dans .env pour l'activer."
fi
docker compose -f docker-compose.vps.yml up -d --build
docker image prune -f >/dev/null
echo "Sklubot est à jour."
