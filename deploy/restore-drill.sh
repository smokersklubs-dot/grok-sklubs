#!/usr/bin/env bash
# Exercice de restauration (SK-P0-04) : prouve qu'une sauvegarde se restaure, SANS toucher à l'installation en service.
#  1. prend la dernière archive (ou celle donnée), vérifie ses empreintes (SHA256SUMS) ;
#  2. déchiffre ses secrets (age ou openssl) pour retrouver SESSION_SECRET ;
#  3. restaure tout dans un projet Docker Compose ISOLÉ (« sklubot-drill-… », son propre volume, AUCUN réseau :
#     network_mode none — il ne peut ni joindre Internet, ni les bots, ni l'installation en service ; planificateur,
#     Telegram, courrier et ordinateurs coupés) ;
#  4. le démarre avec l'image actuelle de Sklubot (ce qui teste aussi les migrations de base sur les vraies données),
#     attend /api/health, compare les comptes de lignes (comptes, bots, messages…) au manifeste de l'archive, vérifie
#     PRAGMA integrity_check et déchiffre UNE valeur scellée du coffre/connexions pour prouver que la clé est la bonne ;
#  5. détruit le projet et son volume, écrit un rapport (DOSSIER/restore-drill-dernier.txt) et l'état dans le volume
#     de données (restore-drill-status.json). Code de sortie 0 seulement si tout est vert.
#
# Utilisation : deploy/restore-drill.sh [ARCHIVE | DOSSIER]
# Archives acceptées : celles de deploy/backup.sh (sklubot-sauvegarde-….tar) et celles de la sauvegarde automatique de
# l'application vers un stockage S3 (sklubot-auto-….tar.gz.age, entièrement chiffrées avec age ; à télécharger avec
# « node server/dist/backupcheck.js restore-from-s3 », voir docs/SAUVEGARDE.md). Pour ces dernières, la clé privée age
# (SKLUBOT_BACKUP_AGE_IDENTITY) est obligatoire, et c'est l'image testée qui déchiffre, vérifie et restaure
# (server/dist/backupcheck.js extract) : pas besoin d'age sur le serveur.
# Réglages : SKLUBOT_BACKUP_DIR (dossier des archives), SKLUBOT_BACKUP_AGE_IDENTITY (fichier de clé privée age, à
# n'apporter que pour l'exercice), SKLUBOT_BACKUP_PASSPHRASE_FILE (phrase openssl), SKLUBOT_APP_IMAGE (image à tester),
# SKLUBOT_DRILL_TIMEOUT (secondes d'attente du démarrage, 180).
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
ROOT="$PWD"
ENVFILE="${SKLUBOT_ENV_FILE:-$ROOT/.env}"
envfile_get() { [ -f "$ENVFILE" ] || return 0; sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENVFILE" | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }
setting() { local v="${!1:-}"; [ -n "$v" ] && { printf '%s' "$v"; return; }; envfile_get "$1"; }

ARG="${1:-$(setting SKLUBOT_BACKUP_DIR)}"; ARG="${ARG:-$ROOT/sauvegardes}"
if [ -d "$ARG" ]; then
  DIR="$(cd "$ARG" && pwd)"
  # La plus récente des deux sortes, d'après la date de son nom.
  LAST="$(ls -1 "$DIR" | sed -nE 's/^sklubot-(sauvegarde|auto)-([0-9]{8}-[0-9]{6})\.(tar|tar\.gz\.age)$/\2 &/p' | sort | tail -n1 | cut -d' ' -f2 || true)"
  [ -n "$LAST" ] || { echo "Aucune sauvegarde dans $DIR." >&2; exit 1; }
  ARCHIVE="$DIR/$LAST"
else
  [ -f "$ARG" ] || { echo "Utilisation : deploy/restore-drill.sh [archive | dossier]" >&2; exit 1; }
  ARCHIVE="$(cd "$(dirname "$ARG")" && pwd)/$(basename "$ARG")"; DIR="$(dirname "$ARCHIVE")"
fi
STAMP="$(basename "$ARCHIVE")"; STAMP="$(printf '%s' "$STAMP" | sed -nE 's/^sklubot-(sauvegarde|auto)-([0-9]{8}-[0-9]{6}).*/\2/p')"
case "$ARCHIVE" in *.age) FORMAT=3 ;; *) FORMAT=2 ;; esac
P="sklubot-drill-$(date +%s)-$$"
VOLD="${P}_data"
WORK="$(mktemp -d "$DIR/.exercice-XXXXXX")" # à côté des archives : /tmp est parfois en mémoire (tmpfs)
REPORT="$WORK/report.txt"
RESULT=1
VOL="$(setting SKLUBOT_DATA_VOLUME)"; VOL="${VOL:-sklubot_data}"

APP_ANY="$(docker ps -aq --filter "volume=$VOL" --filter "label=com.docker.compose.service=sklubot" | head -n1)"
APP_IMG="${SKLUBOT_APP_IMAGE:-}"
[ -z "$APP_IMG" ] && [ -n "$APP_ANY" ] && APP_IMG="$(docker inspect -f '{{.Config.Image}}' "$APP_ANY")"
APP_IMG="${APP_IMG:-sklubot-server}"
docker image inspect "$APP_IMG" >/dev/null 2>&1 || { echo "Image de Sklubot introuvable ($APP_IMG). Indique-la avec SKLUBOT_APP_IMAGE=…" >&2; exit 1; }

line() { printf '%s\n' "$*" | tee -a "$REPORT"; }
PASS=0; FAIL=0
ok() { line "  [OK]    $*"; PASS=$((PASS + 1)); }
ko() { line "  [ÉCHEC] $*"; FAIL=$((FAIL + 1)); }

cleanup() {
  docker compose -p "$P" -f "$WORK/drill.yml" down -v --remove-orphans >/dev/null 2>&1 || true
  docker volume rm -f "$VOLD" >/dev/null 2>&1 || true
  if [ -f "$REPORT" ]; then
    cp "$REPORT" "$DIR/restore-drill-dernier.txt" 2>/dev/null || true
    # L'état du dernier exercice, à côté de celui de la sauvegarde (volume de données de l'installation en service).
    if docker volume inspect "$VOL" >/dev/null 2>&1; then
      printf '{"at":%s,"archive":"%s","ok":%s,"passed":%s,"failed":%s}\n' "$(($(date +%s) * 1000))" "$(basename "$ARCHIVE")" "$([ "$RESULT" = 0 ] && echo true || echo false)" "$PASS" "$FAIL" \
        | docker run --rm -i -v "$VOL":/data "$APP_IMG" sh -c 'cat > /data/restore-drill-status.json' >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

line "Exercice de restauration — $(date '+%Y-%m-%d %H:%M:%S')"
line "Archive : $ARCHIVE"
line "Image testée : $APP_IMG ; projet isolé : $P (sans réseau)"

MANIFEST="$WORK/x/manifest.json"
if [ "$FORMAT" = 3 ]; then
  # ── Sauvegarde automatique de l'application (age + tar.gz) : l'image testée déchiffre, vérifie et restaure ─────────
  ID="$(setting SKLUBOT_BACKUP_AGE_IDENTITY)"
  [ -n "$ID" ] && [ -r "$ID" ] || { ko "archive chiffrée (sauvegarde automatique) : indique la clé privée age avec SKLUBOT_BACKUP_AGE_IDENTITY=<fichier>"; exit 1; }
  ID="$(cd "$(dirname "$ID")" && pwd)/$(basename "$ID")"
  MANIFEST="$WORK/meta/manifest.json"
  mkdir -p "$WORK/meta"
  docker volume create "$VOLD" >/dev/null
  if docker run --rm --network none -v "$VOLD":/data -v "$ARCHIVE":/b/archive.age:ro -v "$ID":/b/key:ro -v "$WORK/meta":/meta "$APP_IMG" \
      node --no-warnings server/dist/backupcheck.js extract --identity /b/key /b/archive.age /data --meta /meta >"$WORK/extract.json" 2>"$WORK/extract.err"; then
    ok "archive déchiffrée avec la clé privée, empreintes SHA256SUMS vérifiées ($(sed -n 's/.*"checked":\([0-9]*\).*/\1/p' "$WORK/extract.json") fichiers), données restaurées dans la copie"
  else
    ko "archive non restaurée : $(tail -c 300 "$WORK/extract.err" "$WORK/extract.json" 2>/dev/null | tr '\n' ' ')"
    grep -q "Unknown command\|backupcheck: usage\|Cannot find module" "$WORK/extract.err" 2>/dev/null && line "     (l'image $APP_IMG est-elle assez récente ? Il faut une version avec la sauvegarde automatique.)"
    exit 1
  fi
  SECRETS="$WORK/meta/secrets.env"; SECRET_SRC="archive (age, sauvegarde automatique)"
  SESSION="$(sed -n 's/^SKLUBOT_SESSION_SECRET=//p; s/^SESSION_SECRET=//p' "$SECRETS" 2>/dev/null | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
  if [ -n "$SESSION" ]; then ok "secrets de la sauvegarde ouverts ($SECRET_SRC)"; else ko "pas de SESSION_SECRET dans les secrets de la sauvegarde"; fi
  DBREL="$(sed -n 's/.*"dbPath":"\([^"]*\)".*/\1/p' "$MANIFEST" 2>/dev/null || true)"; DBREL="${DBREL:-sklubot.db}"
  line "  [—]     sauvegarde de l'application : sans les ordinateurs des bots (installations et connexions à refaire après une vraie restauration)"
else
mkdir -p "$WORK/x"
tar xf "$ARCHIVE" -C "$WORK/x"
if [ -f "$WORK/x/SHA256SUMS" ]; then
  if (cd "$WORK/x" && sha256sum --quiet -c SHA256SUMS); then ok "empreintes SHA256SUMS de l'archive"; else ko "empreintes SHA256SUMS de l'archive"; fi
else line "  [—]     archive d'avant le manifeste : pas d'empreintes à vérifier"; fi
[ -f "$WORK/x/data.tar.gz" ] || { ko "ce n'est pas une sauvegarde Sklubot"; exit 1; }

# ── Secrets ──────────────────────────────────────────────────────────────────────────────────────────────────────
SECRETS=""
SECRET_SRC=""
if [ -f "$WORK/x/secrets.env.age" ]; then
  ID="$(setting SKLUBOT_BACKUP_AGE_IDENTITY)"
  if [ -n "$ID" ] && command -v age >/dev/null && age -d -i "$ID" -o "$WORK/secrets.env" "$WORK/x/secrets.env.age" 2>/dev/null; then SECRETS="$WORK/secrets.env"; SECRET_SRC="archive (age)"; fi
elif [ -f "$WORK/x/secrets.env.enc" ]; then
  PF="$(setting SKLUBOT_BACKUP_PASSPHRASE_FILE)"
  if [ -n "$PF" ] && openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$PF" -in "$WORK/x/secrets.env.enc" -out "$WORK/secrets.env" 2>/dev/null; then SECRETS="$WORK/secrets.env"; SECRET_SRC="archive (openssl)"
  elif [ -z "$PF" ] && [ -t 0 ] && openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$WORK/x/secrets.env.enc" -out "$WORK/secrets.env"; then SECRETS="$WORK/secrets.env"; SECRET_SRC="archive (openssl, phrase tapée)"; fi
elif [ -f "$DIR/secrets/sklubot-secrets-$STAMP.env" ]; then
  SECRETS="$DIR/secrets/sklubot-secrets-$STAMP.env"; SECRET_SRC="fichier à part (en clair)"
fi
SESSION=""
if [ -n "$SECRETS" ]; then
  SESSION="$(sed -n 's/^SKLUBOT_SESSION_SECRET=//p; s/^SESSION_SECRET=//p' "$SECRETS" | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
fi
if [ -n "$SESSION" ]; then ok "secrets de la sauvegarde ouverts ($SECRET_SRC)"
else ko "secrets de la sauvegarde non ouverts (clé age/phrase de passe absente ou fausse) — la clé ne peut pas être vérifiée"; fi

# ── Restauration dans le volume isolé ────────────────────────────────────────────────────────────────────────────
DBREL="$(sed -n 's/.*"dbPath":"\([^"]*\)".*/\1/p' "$MANIFEST" 2>/dev/null || true)"; DBREL="${DBREL:-sklubot.db}"
docker volume create "$VOLD" >/dev/null
docker run --rm -v "$VOLD":/data -v "$WORK/x":/b:ro "$APP_IMG" sh -c 'tar xzf /b/data.tar.gz -C /data && if [ -f /b/db.sqlite ]; then cp /b/db.sqlite "/data/$1"; fi; rm -f /data/backup-status.json /data/restore-drill-status.json' sh "$DBREL"
NH="$(ls "$WORK/x/homes" 2>/dev/null | wc -l | tr -d ' ')"
HOK=0
for f in "$WORK"/x/homes/*.tar.gz; do [ -e "$f" ] || continue; gzip -t "$f" && HOK=$((HOK + 1)); done
[ "$HOK" = "$NH" ] && ok "dossiers des ordinateurs lisibles ($HOK/$NH archives)" || ko "dossiers des ordinateurs : $HOK/$NH archives lisibles"
fi

# Clé de données dédiée (SKLUBOT_DATA_KEYS / DATA_KEY) : sans elle, les secrets scellés avec ne s'ouvriraient pas.
DATAKEYS=""; DATAKEY=""
if [ -n "${SECRETS:-}" ] && [ -f "$SECRETS" ]; then
  unq() { tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }
  DATAKEYS="$(sed -n 's/^SKLUBOT_DATA_KEYS=//p; s/^DATA_KEYS=//p' "$SECRETS" | unq)"
  DATAKEY="$(sed -n 's/^SKLUBOT_DATA_KEY=//p; s/^DATA_KEY=//p' "$SECRETS" | unq)"
fi
export DRILL_DATA_KEYS="$DATAKEYS" DRILL_DATA_KEY="$DATAKEY"
cat > "$WORK/drill.yml" <<EOF
# Généré par deploy/restore-drill.sh : une copie jetable, sans réseau, détruite à la fin.
services:
  sklubot:
    image: "$APP_IMG"
    network_mode: "none"
    environment:
      SESSION_SECRET: "\${DRILL_SESSION_SECRET}"
      DATA_KEYS: "\${DRILL_DATA_KEYS}"
      DATA_KEY: "\${DRILL_DATA_KEY}"
      DATA_DIR: "/data"
      DB_PATH: "/data/$DBREL"
      PORT: "3000"
      PUBLIC_URL: "http://127.0.0.1:3000"
      NO_SCHEDULER: "1"
      COMPUTER: "browser"
      SHELL_ENABLED: "0"
      MAIL_SMTP_PORT: "0"
      FILE_SNAPSHOTS: "0"
    volumes:
      - drill_data:/data
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
volumes:
  drill_data:
    external: true
    name: "$VOLD"
EOF
# Sans secret retrouvé, le serveur démarre quand même avec une clé de secours (la vérification du coffre échouera).
export DRILL_SESSION_SECRET="${SESSION:-drill-without-the-backup-secret-$(date +%s%N)}"
docker compose -p "$P" -f "$WORK/drill.yml" up -d >"$WORK/up.log" 2>&1 || { cat "$WORK/up.log" >&2; ko "la copie n'a pas pu être créée (docker compose up)"; exit 1; }
EXEC=(docker compose -p "$P" -f "$WORK/drill.yml" exec -T sklubot)
HEALTH=""
DEADLINE=$(( $(date +%s) + ${SKLUBOT_DRILL_TIMEOUT:-180} ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  HEALTH="$("${EXEC[@]}" curl -sS http://127.0.0.1:3000/api/health 2>/dev/null || true)"
  case "$HEALTH" in *'"ok":true'*) break ;; esac
  if [ -z "$(docker compose -p "$P" -f "$WORK/drill.yml" ps -q --status running sklubot)" ]; then break; fi
  sleep 2
done
case "$HEALTH" in
  *'"ok":true'*) ok "la copie démarre et répond à /api/health ($HEALTH)" ;;
  *) ko "la copie ne répond pas à /api/health"; line "     Journal de démarrage :"; docker compose -p "$P" -f "$WORK/drill.yml" logs --no-color --tail 30 sklubot 2>&1 | sed 's/^/     /' | tee -a "$REPORT" >/dev/null; exit 1 ;;
esac

# ── Comptes et clé ───────────────────────────────────────────────────────────────────────────────────────────────
CHECK="$("${EXEC[@]}" node --no-warnings server/dist/backupcheck.js 2>/dev/null || true)"
if [ -z "$CHECK" ]; then
  CHECK="$("${EXEC[@]}" node --no-warnings -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});const c={};for(const t of ["users","bots","rows","memories","skills","routines","connectors","vault","usage"]){try{c[t]=d.prepare("SELECT COUNT(*) AS n FROM \""+t+"\"").get().n}catch{c[t]=null}}process.stdout.write(JSON.stringify({integrity:d.prepare("PRAGMA integrity_check").get().integrity_check,counts:c}))' "/data/$DBREL" 2>/dev/null || true)"
  line "  [—]     image sans server/dist/backupcheck.js (ancienne version) : clé non vérifiée"
fi
case "$CHECK" in *'"integrity":"ok"'*) ok "PRAGMA integrity_check = ok" ;; *) ko "intégrité de la base : $CHECK" ;; esac
num() { printf '%s' "$1" | sed -n "s/.*\"counts\":{[^}]*\"$2\":\\([0-9]*\\).*/\\1/p"; }
if [ -f "$MANIFEST" ]; then
  M="$(cat "$MANIFEST")"
  for t in users bots rows memories skills routines connectors vault usage; do
    a="$(num "$M" "$t")"; b="$(num "$CHECK" "$t")"
    [ -z "$a" ] && continue
    if [ "$a" = "$b" ]; then ok "$t : $b (identique à la sauvegarde)"; else ko "$t : $b restauré(s) pour $a sauvegardé(s)"; fi
  done
else
  line "  [—]     archive d'avant le manifeste : comptes restaurés $(printf '%s' "$CHECK" | sed -n 's/.*"counts":\({[^}]*}\).*/\1/p')"
fi
case "$CHECK" in
  *'"sealed":{"checked":true,"ok":true'*) ok "une valeur scellée s'ouvre avec le SESSION_SECRET de la sauvegarde ($(printf '%s' "$CHECK" | sed -n 's/.*"where":"\([^"]*\)".*/\1/p'))" ;;
  *'"sealed":{"checked":true,"ok":false'*) ko "une valeur scellée NE s'ouvre PAS avec ce SESSION_SECRET : coffre et connexions seraient perdus" ;;
  *'"sealed":{"checked":false'*) line "  [—]     aucune valeur scellée dans la base (rien à déchiffrer)" ;;
esac

line ""
if [ "$FAIL" = 0 ]; then RESULT=0; line "RÉSULTAT : RESTAURATION VÉRIFIÉE ($PASS contrôles verts)."
else line "RÉSULTAT : $FAIL contrôle(s) en échec, $PASS vert(s). Voir ci-dessus."; fi
exit "$RESULT"
