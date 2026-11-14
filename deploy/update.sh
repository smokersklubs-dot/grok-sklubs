#!/usr/bin/env bash
# Met Sklubot à jour sur le VPS : récupère la dernière version, reconstruit, redémarre. Les données sont conservées.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .git ] && git pull --ff-only
docker compose -f docker-compose.vps.yml up -d --build
docker image prune -f >/dev/null
echo "Sklubot est à jour."
