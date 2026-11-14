#!/usr/bin/env bash
# Sauvegarde toutes les données de Sklubot (base, fichiers des bots) dans une archive datée.
# Restaurer :  docker run --rm -v sklubot_data:/data -v "$PWD":/b debian:bookworm-slim tar xzf /b/<archive> -C /data
set -euo pipefail
OUT="${1:-$PWD}/sklubot-sauvegarde-$(date +%Y%m%d-%H%M%S).tar.gz"
docker run --rm -v sklubot_data:/data:ro -v "$(dirname "$OUT")":/b sklubot-desktop tar czf "/b/$(basename "$OUT")" -C /data .
echo "Sauvegarde écrite : $OUT"
echo "Pense aussi à garder une copie de ton fichier .env (il contient le secret qui déchiffre le coffre)."
