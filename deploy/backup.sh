#!/usr/bin/env bash
# Sauvegarde complète de Sklubot (VPS ou Coolify), sans arrêter le service :
#  - la base SQLite, copiée en ligne de façon cohérente (VACUUM INTO, https://www.sqlite.org/lang_vacuum.html#vacuuminto)
#    par le Node de l'image Sklubot (node:sqlite) — pas besoin de sqlite3 sur le serveur ;
#  - le reste du volume de données (bibliothèques des bots, dossier d'équipe, botlink, pages…) ;
#  - le dossier personnel de chaque ordinateur (bots et ordinateurs partagés : volumes sklubot-home-*), chacun mis en
#    pause (docker pause) le temps de sa copie seulement, puis relancé ;
#  - les secrets qui déchiffrent le coffre et les connexions (.env du VPS, ou l'environnement du conteneur sous Coolify),
#    CHIFFRÉS (age ou openssl) dans l'archive ; sans clé configurée, ils sont mis à part, en clair, dans DEST/secrets/
#    (droits 600, jamais envoyés à la copie distante) avec un avertissement.
# Puis : manifeste (comptes de lignes, empreintes SHA256SUMS), rotation (quotidiennes/hebdomadaires), copie distante
# facultative (rclone ou rsync), et un état écrit dans le volume (backup-status.json) que /api/health lit.
#
# Utilisation : deploy/backup.sh [DOSSIER] [--keep-daily N] [--keep-weekly N] [--remote CIBLE] [--no-homes]
# Réglages (variables d'environnement, ou lignes du fichier .env à la racine) :
#   SKLUBOT_BACKUP_DIR               dossier des archives (sinon le 1er argument, sinon ./sauvegardes)
#   SKLUBOT_BACKUP_AGE_RECIPIENT     clé publique age (age1…) : chiffre les secrets (recommandé ; la clé privée reste
#                                    hors du serveur)
#   SKLUBOT_BACKUP_PASSPHRASE_FILE   sinon : fichier contenant une phrase de passe (openssl enc -aes-256-cbc -pbkdf2)
#   SKLUBOT_BACKUP_KEEP_DAILY (7)    archives les plus récentes gardées
#   SKLUBOT_BACKUP_KEEP_WEEKLY (4)   en plus : la plus récente de chacune des N semaines précédentes
#   SKLUBOT_BACKUP_REMOTE            copie hors du serveur : « rclone:<remote>:<chemin> » ou « rsync:<user@hôte:/chemin> »
#   SKLUBOT_DATA_VOLUME (sklubot_data) · SKLUBOT_ENV_FILE (.env à la racine) · SKLUBOT_APP_IMAGE (image de Sklubot)
# Restaurer : deploy/restore.sh <archive>. Vérifier qu'une archive se restaure : deploy/restore-drill.sh.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
ROOT="$PWD"

ENVFILE="${SKLUBOT_ENV_FILE:-$ROOT/.env}"
envfile_get() { # lit une valeur du .env sans l'exécuter
  [ -f "$ENVFILE" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENVFILE" | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}
setting() { local v="${!1:-}"; [ -n "$v" ] && { printf '%s' "$v"; return; }; envfile_get "$1"; }

DEST_ARG=""; KEEP_DAILY="$(setting SKLUBOT_BACKUP_KEEP_DAILY)"; KEEP_WEEKLY="$(setting SKLUBOT_BACKUP_KEEP_WEEKLY)"
REMOTE="$(setting SKLUBOT_BACKUP_REMOTE)"; HOMES=1
while [ $# -gt 0 ]; do
  case "$1" in
    --keep-daily) KEEP_DAILY="$2"; shift 2 ;;
    --keep-weekly) KEEP_WEEKLY="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    --no-homes) HOMES=0; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) DEST_ARG="$1"; shift ;;
  esac
done
KEEP_DAILY="${KEEP_DAILY:-7}"; KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
DEST="${DEST_ARG:-$(setting SKLUBOT_BACKUP_DIR)}"; DEST="${DEST:-$ROOT/sauvegardes}"
mkdir -p "$DEST"; DEST="$(cd "$DEST" && pwd)"
VOL="$(setting SKLUBOT_DATA_VOLUME)"; VOL="${VOL:-sklubot_data}"
HOME_PREFIX="${SKLUBOT_HOME_PREFIX:-sklubot-home-}" # volumes des ordinateurs (bots et partagés : server/src/linux.ts volumeOf)
AGE_RCPT="$(setting SKLUBOT_BACKUP_AGE_RECIPIENT)"; PASSFILE="$(setting SKLUBOT_BACKUP_PASSPHRASE_FILE)"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="sklubot-sauvegarde-$STAMP.tar"
OUT="$DEST/$NAME"
WORK="$(mktemp -d "$DEST/.travail-XXXXXX")" # à côté des archives : /tmp est parfois en mémoire (tmpfs)
PAUSED=""
STATUS_OK=false

docker volume inspect "$VOL" >/dev/null 2>&1 || { echo "Aucune donnée Sklubot trouvée (volume $VOL absent)." >&2; exit 1; }

# Le conteneur de l'application (VPS : projet docker-compose.vps.yml ; Coolify : nom généré) : celui du service
# compose « sklubot » qui monte le volume de données. Les ordinateurs des bots n'ont pas cette étiquette.
APP="$(docker ps -q --filter "volume=$VOL" --filter "label=com.docker.compose.service=sklubot" | head -n1)"
APP_ANY="${APP:-$(docker ps -aq --filter "volume=$VOL" --filter "label=com.docker.compose.service=sklubot" | head -n1)}"
APP_IMG="${SKLUBOT_APP_IMAGE:-}"
[ -z "$APP_IMG" ] && [ -n "$APP_ANY" ] && APP_IMG="$(docker inspect -f '{{.Config.Image}}' "$APP_ANY")"
APP_IMG="${APP_IMG:-sklubot-server}"
docker image inspect "$APP_IMG" >/dev/null 2>&1 || { echo "Image de Sklubot introuvable ($APP_IMG). Indique-la avec SKLUBOT_APP_IMAGE=…" >&2; exit 1; }
TOOL="${SKLUBOT_TOOL_IMAGE:-$APP_IMG}"
DBREL="sklubot.db"
if [ -n "$APP_ANY" ]; then
  p="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP_ANY" | sed -n 's/^DB_PATH=//p' | head -n1)"
  case "$p" in /data/*) DBREL="${p#/data/}" ;; esac
fi

finish() {
  local code=$?
  for c in $PAUSED; do docker unpause "$c" >/dev/null 2>&1 || true; done
  docker run --rm -v "$VOL":/data "$TOOL" rm -rf /data/.backup-tmp >/dev/null 2>&1 || true
  # L'état de la dernière sauvegarde, lu par /api/health (monitor.ts) : réussite ou échec, et quand.
  printf '{"at":%s,"archive":"%s","ok":%s,"secrets":"%s"}\n' "$(($(date +%s) * 1000))" "$NAME" "$STATUS_OK" "${SECRETS_MODE:-none}" \
    | docker run --rm -i -v "$VOL":/data "$TOOL" sh -c 'cat > /data/backup-status.json' >/dev/null 2>&1 || true
  rm -rf "$WORK"
  [ "$code" = 0 ] || { rm -f "$OUT.partial"; echo "La sauvegarde a échoué (code $code). Rien n'a été effacé." >&2; }
}
trap finish EXIT

# ── 1. La base, en ligne ────────────────────────────────────────────────────────────────────────────────────────────
# Le même petit programme sert dans le conteneur qui tourne (docker exec) ou, Sklubot arrêté, dans un conteneur jetable.
JS_SNAPSHOT='
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const src = "/data/" + process.argv[1], out = "/data/.backup-tmp/sklubot.db";
fs.mkdirSync("/data/.backup-tmp", { recursive: true, mode: 0o700 });
try { fs.rmSync(out, { force: true }); } catch {}
const db = new DatabaseSync(src);
db.exec("PRAGMA busy_timeout = 15000");
const Q = String.fromCharCode(39); // an apostrophe, which this single-quoted shell string cannot hold
db.exec("VACUUM INTO " + Q + out + Q);
db.close();
const snap = new DatabaseSync(out, { readOnly: true });
const counts = {};
for (const t of ["users","bots","rows","memories","skills","routines","connectors","vault","usage"]) {
  try { counts[t] = snap.prepare("SELECT COUNT(*) AS n FROM \"" + t + "\"").get().n; } catch { counts[t] = null; }
}
const integrity = snap.prepare("PRAGMA integrity_check").get().integrity_check;
const userVersion = snap.prepare("PRAGMA user_version").get().user_version;
snap.close();
process.stdout.write(JSON.stringify({ integrity, userVersion, counts }));
'
echo "Copie en ligne de la base…"
if [ -n "$APP" ]; then
  DBINFO="$(docker exec "$APP" node --no-warnings -e "$JS_SNAPSHOT" "$DBREL")"
else
  DBINFO="$(docker run --rm -v "$VOL":/data "$APP_IMG" node --no-warnings -e "$JS_SNAPSHOT" "$DBREL")"
fi
case "$DBINFO" in *'"integrity":"ok"'*) ;; *) echo "La copie de la base n'est pas intègre : $DBINFO" >&2; exit 1 ;; esac

# ── 2. Le volume de données, sans la base vivante (remplacée par la copie) ─────────────────────────────────────────
# GNU tar sort en code 1 quand un fichier change pendant la lecture (un bot écrit dans sa bibliothèque) : accepté.
echo "Copie des bibliothèques et du dossier d'équipe…"
docker run --rm -v "$VOL":/data:ro -v "$WORK":/b "$TOOL" sh -c '
  tar czf /b/data.tar.gz -C /data --warning=no-file-changed --warning=no-file-removed --warning=no-file-ignored \
    --exclude="./$1" --exclude="./$1-wal" --exclude="./$1-shm" --exclude="./$1.pre-v*" \
    --exclude=./.backup-tmp --exclude=./db-snapshots --exclude=./backup-status.json . || [ $? -eq 1 ]
  cp /data/.backup-tmp/sklubot.db /b/db.sqlite' sh "$DBREL"

# ── 3. Les ordinateurs (bots et partagés), un par un, en pause le temps de leur copie ───────────────────────────────
mkdir -p "$WORK/homes"
NHOMES=0
if [ "$HOMES" = 1 ]; then
  for v in $(docker volume ls -q --filter "name=^$HOME_PREFIX"); do
    running="$(docker ps -q --filter "volume=$v" --filter status=running)"
    for c in $running; do docker pause "$c" >/dev/null && PAUSED="$PAUSED $c"; done
    docker run --rm -v "$v":/h:ro -v "$WORK/homes":/b "$TOOL" sh -c 'tar czf "/b/$1.tar.gz" -C /h --warning=no-file-ignored . || [ $? -eq 1 ]' sh "$v"
    for c in $running; do docker unpause "$c" >/dev/null 2>&1 || true; done
    PAUSED=""
    NHOMES=$((NHOMES + 1))
  done
fi

# ── 4. Les secrets ─────────────────────────────────────────────────────────────────────────────────────────────────
SECRETS="$WORK/secrets.env"
{
  echo "# Secrets de Sklubot au $STAMP. SESSION_SECRET / SKLUBOT_SESSION_SECRET déchiffre le coffre et les connexions."
  if [ -f "$ENVFILE" ]; then echo "# ── fichier .env ($ENVFILE)"; cat "$ENVFILE"; echo; fi
  if [ -n "$APP_ANY" ]; then
    echo "# ── environnement du conteneur Sklubot (Coolify : les variables saisies dans Coolify)"
    docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP_ANY" | grep -Ev '^(PATH|HOME|HOSTNAME|NODE_VERSION|YARN_VERSION|NODE_ENV)=' || true
  fi
} > "$SECRETS"
SECRETS_MODE=""
if [ -n "$AGE_RCPT" ]; then
  command -v age >/dev/null || { echo "SKLUBOT_BACKUP_AGE_RECIPIENT est réglé mais « age » n'est pas installé (apt install age)." >&2; exit 1; }
  age -r "$AGE_RCPT" -o "$WORK/secrets.env.age" "$SECRETS"; SECRETS_MODE="age"
elif [ -n "$PASSFILE" ]; then
  [ -r "$PASSFILE" ] || { echo "Fichier de phrase de passe illisible : $PASSFILE" >&2; exit 1; }
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$PASSFILE" -in "$SECRETS" -out "$WORK/secrets.env.enc"; SECRETS_MODE="openssl"
else
  mkdir -p "$DEST/secrets"; chmod 700 "$DEST/secrets"
  cp "$SECRETS" "$DEST/secrets/sklubot-secrets-$STAMP.env"; chmod 600 "$DEST/secrets/sklubot-secrets-$STAMP.env"
  SECRETS_MODE="separate"
fi
rm -f "$SECRETS"

# ── 5. Manifeste, empreintes, archive ──────────────────────────────────────────────────────────────────────────────
SOURCE="none"; [ -n "$APP_ANY" ] && SOURCE="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$APP_ANY" | tr -cd 'A-Za-z0-9_.-')"
printf '{"format":2,"stamp":"%s","at":%s,"source":"%s","dbPath":"%s","db":%s,"homes":%s,"secrets":"%s"}\n' \
  "$STAMP" "$(($(date +%s) * 1000))" "$SOURCE" "$DBREL" "$DBINFO" "$NHOMES" "$SECRETS_MODE" > "$WORK/manifest.json"
(cd "$WORK" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
tar cf "$OUT.partial" -C "$WORK" .
mv "$OUT.partial" "$OUT"
STATUS_OK=true

# ── 6. Rotation : les N plus récentes, plus la plus récente de chacune des M semaines d'avant ──────────────────────
mapfile -t ALL < <(ls -1 "$DEST" | grep -E '^sklubot-sauvegarde-[0-9]{8}-[0-9]{6}\.tar$' | sort -r)
declare -A KEEP=() WEEKS=()
i=0
for f in "${ALL[@]}"; do
  i=$((i + 1))
  if [ "$i" -le "$KEEP_DAILY" ]; then KEEP[$f]=1; continue; fi
  d="${f#sklubot-sauvegarde-}"; d="${d:0:8}"
  w="$(date -d "$d" +%G-%V 2>/dev/null || echo "$d")"
  if [ -z "${WEEKS[$w]:-}" ] && [ "${#WEEKS[@]}" -lt "$KEEP_WEEKLY" ]; then WEEKS[$w]=1; KEEP[$f]=1; fi
done
for f in "${ALL[@]}"; do
  if [ -z "${KEEP[$f]:-}" ]; then
    rm -f "$DEST/$f"
    s="${f#sklubot-sauvegarde-}"; rm -f "$DEST/secrets/sklubot-secrets-${s%.tar}.env"
    echo "Ancienne sauvegarde supprimée : $f"
  fi
done

# ── 7. Copie hors du serveur (facultative) ────────────────────────────────────────────────────────────────────────
if [ -n "$REMOTE" ]; then
  case "$REMOTE" in
    rclone:*) command -v rclone >/dev/null || { echo "rclone n'est pas installé : copie distante non faite." >&2; exit 1; }
              rclone copy "$OUT" "${REMOTE#rclone:}" ;;
    rsync:*)  rsync -a "$OUT" "${REMOTE#rsync:}/" ;;
    *) echo "SKLUBOT_BACKUP_REMOTE doit commencer par rclone: ou rsync: — copie distante non faite." >&2; exit 1 ;;
  esac
  echo "Copie distante envoyée vers ${REMOTE#*:}"
fi

echo "Sauvegarde écrite : $OUT ($(du -h "$OUT" | cut -f1), base $(printf '%s' "$DBINFO" | sed -n 's/.*"users":\([0-9]*\).*"bots":\([0-9]*\).*"rows":\([0-9]*\).*/\1 compte(s), \2 bot(s), \3 ligne(s)/p'), $NHOMES ordinateur(s))"
case "$SECRETS_MODE" in
  age) echo "Secrets chiffrés pour la clé age $AGE_RCPT (garde la clé privée HORS du serveur)." ;;
  openssl) echo "Secrets chiffrés avec la phrase de passe de $PASSFILE (garde une copie de cette phrase HORS du serveur)." ;;
  separate) echo "ATTENTION : aucune clé de chiffrement réglée. Les secrets (SESSION_SECRET, clés d'API) sont EN CLAIR dans"
            echo "  $DEST/secrets/sklubot-secrets-$STAMP.env — hors de l'archive et jamais envoyés à la copie distante."
            echo "  Règle SKLUBOT_BACKUP_AGE_RECIPIENT (recommandé) ou SKLUBOT_BACKUP_PASSPHRASE_FILE (docs/SAUVEGARDE.md)." ;;
esac
