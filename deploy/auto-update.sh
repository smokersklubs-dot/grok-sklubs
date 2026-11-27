#!/usr/bin/env bash
# Mises à jour automatiques de Sklubot (A-FAIRE L168) — une OPTION pour un Sklubot installé chez soi (VPS), ÉTEINTE par défaut.
#
#   sudo bash deploy/auto-update.sh install    installe un minuteur systemd (toutes les heures ; le script ne fait rien hors du créneau)
#   sudo bash deploy/auto-update.sh remove     retire le minuteur
#   bash deploy/auto-update.sh status          l'état de la dernière tentative
#   bash deploy/auto-update.sh run             une tentative maintenant (respecte le créneau, sauf SKLUBOT_UPDATE_FORCE=1)
#
# Réglages (lignes du fichier .env à la racine) :
#   SKLUBOT_AUTO_UPDATE=1                 obligatoire : sans cette ligne, rien ne se passe.
#   SKLUBOT_UPDATE_WINDOW=03:00-05:00     le créneau calme, heure du serveur (par défaut 03:00-05:00).
#   SKLUBOT_UPDATE_SIGNERS=<fichier>      la liste des signataires autorisés (format « allowed signers » de ssh-keygen,
#                                         man ssh-keygen(1) « ALLOWED SIGNERS ») ; par défaut deploy/allowed_signers.
#   SKLUBOT_UPDATE_GNUPGHOME=<dossier>    ou bien : un trousseau GnuPG qui ne contient QUE les clés publiques autorisées
#                                         (signatures OpenPGP ; https://git-scm.com/docs/git-config#Documentation/git-config.txt-gpgformat).
#   SKLUBOT_UPDATE_TAGS='v*'              les étiquettes de version prises en compte.
#
# Ce que fait une tentative, dans l'ordre (toute étape qui échoue arrête tout ; rien n'est changé avant l'étape 5) :
#  1. Mode hébergé (SKLUBOT_HOSTED_MODE=1) : JAMAIS de mise à jour sans l'opérateur. Le script regarde seulement s'il y a
#     une version et l'écrit dans l'état (« disponible, à appliquer par l'opérateur avec deploy/update.sh »).
#  2. Hors du créneau : rien.
#  3. `git fetch --tags`, puis la version la plus récente dont l'étiquette est SIGNÉE par un signataire autorisé :
#     `git verify-tag` (https://git-scm.com/docs/git-verify-tag) avec gpg.format=ssh et gpg.ssh.allowedSignersFile
#     (https://git-scm.com/docs/git-config#Documentation/git-config.txt-gpgsshallowedSignersFile). Sans signataire
#     configuré, ou sans étiquette signée, ou si la version n'est pas plus récente que celle qui tourne (jamais de retour
#     en arrière par ce chemin) : rien.
#  4. Sauvegarde complète (deploy/backup.sh). Si elle échoue : rien n'est changé.
#  5. Passage sur la version signée (git checkout --detach <étiquette>), reconstruction et redémarrage (docker compose).
#  6. Vérification de santé : GET /api/health doit répondre 200 (6 essais sur 3 minutes).
#  7. Si la santé échoue : retour automatique à la version d'avant (même reconstruction) ; si la santé échoue encore, la
#     sauvegarde de l'étape 4 est remise (deploy/restore.sh, SKLUBOT_RESTORE_YES=OUI). L'état dit ce qui s'est passé.
# Journal : /var/log/sklubot-auto-update.log (ou ./auto-update.log sans droits root) ; état : ./auto-update-status.json.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STATUS="${SKLUBOT_UPDATE_STATUS:-$ROOT/auto-update-status.json}"
LOG="${SKLUBOT_UPDATE_LOG:-/var/log/sklubot-auto-update.log}"
[ -w "$(dirname "$LOG")" ] || LOG="$ROOT/auto-update.log"
COMPOSE="${SKLUBOT_COMPOSE_FILE:-docker-compose.vps.yml}"
HEALTH_URL="${SKLUBOT_HEALTH_URL:-http://127.0.0.1:${SKLUBOT_HTTP_PORT:-80}/api/health}"
HEALTH_TRIES="${SKLUBOT_HEALTH_TRIES:-6}"
HEALTH_WAIT="${SKLUBOT_HEALTH_WAIT:-30}"

envval() { # la valeur d'une ligne NOM=valeur du .env (l'environnement passe avant)
  local v="${!1:-}"
  if [ -z "$v" ] && [ -f .env ]; then v="$(grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"; fi
  printf '%s' "$v"
}
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG" >&2; }
state() { # state <résultat> <phrase> [version]
  printf '{"at":"%s","result":"%s","message":"%s","version":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-}" > "$STATUS"
  log "$1 — $2"
}
in_window() { # in_window HH:MM-HH:MM [maintenant HH:MM]
  local w="$1" now="${2:-$(date +%H:%M)}" a b
  a="${w%-*}"; b="${w#*-}"
  if [[ "$a" < "$b" ]]; then [[ ! "$now" < "$a" && "$now" < "$b" ]]; else [[ ! "$now" < "$a" || "$now" < "$b" ]]; fi
}
healthy() {
  local i
  for i in $(seq 1 "$HEALTH_TRIES"); do
    if curl -fsS -o /dev/null --max-time 10 "$HEALTH_URL"; then return 0; fi
    sleep "$HEALTH_WAIT"
  done
  return 1
}
rebuild() { docker compose -f "$COMPOSE" up -d --build; }

run() {
  [ "$(envval SKLUBOT_AUTO_UPDATE)" = "1" ] || { state off "Mises à jour automatiques éteintes (SKLUBOT_AUTO_UPDATE=1 dans .env pour les allumer)."; return 0; }
  [ -d .git ] || { state error "Ce dossier n'est pas un dépôt git : impossible de vérifier les versions."; return 1; }
  local signers tags window hosted current target
  signers="$(envval SKLUBOT_UPDATE_SIGNERS)"; signers="${signers:-deploy/allowed_signers}"
  tags="$(envval SKLUBOT_UPDATE_TAGS)"; tags="${tags:-v*}"
  window="$(envval SKLUBOT_UPDATE_WINDOW)"; window="${window:-03:00-05:00}"
  hosted="$(envval SKLUBOT_HOSTED_MODE)"
  if [ "${SKLUBOT_UPDATE_FORCE:-}" != "1" ] && ! in_window "$window"; then state waiting "Hors du créneau calme ($window)."; return 0; fi
  local gnupg; gnupg="$(envval SKLUBOT_UPDATE_GNUPGHOME)"
  if [ -n "$gnupg" ]; then [ -d "$gnupg" ] || { state refused "Trousseau des signataires introuvable ($gnupg)."; return 0; }
  elif [ ! -s "$signers" ]; then state refused "Aucun signataire autorisé ($signers) : seules les versions signées sont installées."; return 0; fi
  verify() { if [ -n "$gnupg" ]; then GNUPGHOME="$gnupg" git -c gpg.format=openpgp verify-tag "$1"; else git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile="$signers" verify-tag "$1"; fi; }
  git fetch --tags --quiet
  current="$(git rev-parse HEAD)"
  target=""
  local t
  for t in $(git tag --list "$tags" --sort=-version:refname); do
    if verify "$t" >/dev/null 2>&1; then target="$t"; break; fi
  done
  [ -n "$target" ] || { state refused "Aucune version signée par un signataire autorisé."; return 0; }
  local tc; tc="$(git rev-list -n 1 "$target")"
  if [ "$tc" = "$current" ]; then state uptodate "Déjà à jour." "$target"; return 0; fi
  git merge-base --is-ancestor "$current" "$tc" || { state refused "La version signée $target n'est pas plus récente que celle qui tourne : pas de retour en arrière automatique." "$target"; return 0; }
  if [ "$hosted" = "1" ] || [ "$hosted" = "true" ]; then state available "Mode hébergé : la version $target est disponible ; l'opérateur l'applique lui-même (deploy/update.sh)." "$target"; return 0; fi

  log "Sauvegarde avant la mise à jour vers $target…"
  local before; before="$(date +%s)"
  deploy/backup.sh || { state error "La sauvegarde a échoué : rien n'a changé." "$target"; return 1; }
  local dir archive
  dir="$(envval SKLUBOT_BACKUP_DIR)"; dir="${dir:-$ROOT/sauvegardes}"
  archive="$(ls -t "$dir"/sklubot-sauvegarde-*.tar 2>/dev/null | head -1 || true)"
  [ -n "$archive" ] && [ "$(stat -c %Y "$archive")" -ge "$((before - 5))" ] || { state error "Sauvegarde introuvable après deploy/backup.sh : rien n'a changé." "$target"; return 1; }

  log "Passage à $target ($tc)…"
  git -c advice.detachedHead=false checkout --quiet --detach "$target"
  if rebuild && healthy; then docker image prune -f >/dev/null 2>&1 || true; state updated "Mis à jour vers $target. Sauvegarde : $(basename "$archive")." "$target"; return 0; fi

  log "La santé ne répond pas après $target : retour à la version d'avant ($current)."
  git -c advice.detachedHead=false checkout --quiet --detach "$current"
  if rebuild && healthy; then state rolled_back "La version $target ne démarrait pas : retour automatique à la version d'avant. Rien n'est perdu." "$target"; return 1; fi
  log "Toujours pas de santé : remise de la sauvegarde $(basename "$archive")."
  if SKLUBOT_RESTORE_YES=OUI deploy/restore.sh "$archive" && rebuild && healthy; then state restored "La version $target ne démarrait pas : version d'avant et sauvegarde $(basename "$archive") remises." "$target"; return 1; fi
  state error "La version $target ne démarrait pas et le retour arrière a échoué : intervention nécessaire (deploy/restore.sh $archive)." "$target"
  return 1
}

install_timer() {
  [ "$(id -u)" = 0 ] || { echo "À lancer en root (sudo)." >&2; exit 1; }
  # systemd : un service « oneshot » lancé par un minuteur horaire (man systemd.timer : OnCalendar=hourly, RandomizedDelaySec).
  cat > /etc/systemd/system/sklubot-auto-update.service <<EOF
[Unit]
Description=Sklubot : mise à jour automatique (créneau calme, version signée, sauvegarde, retour arrière)
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $ROOT/deploy/auto-update.sh run
EOF
  cat > /etc/systemd/system/sklubot-auto-update.timer <<EOF
[Unit]
Description=Sklubot : essai de mise à jour automatique toutes les heures
[Timer]
OnCalendar=hourly
RandomizedDelaySec=900
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now sklubot-auto-update.timer
  echo "Minuteur installé. Il ne fait rien tant que SKLUBOT_AUTO_UPDATE=1 n'est pas dans .env et qu'aucun signataire n'est dans deploy/allowed_signers."
}

case "${1:-status}" in
  run) run ;;
  install) install_timer ;;
  remove) [ "$(id -u)" = 0 ] || { echo "À lancer en root (sudo)." >&2; exit 1; }; systemctl disable --now sklubot-auto-update.timer 2>/dev/null || true; rm -f /etc/systemd/system/sklubot-auto-update.{service,timer}; systemctl daemon-reload; echo "Minuteur retiré." ;;
  status) if [ -f "$STATUS" ]; then cat "$STATUS"; else echo '{"result":"never"}'; fi ;;
  in-window) in_window "$2" "${3:-}" ;;
  *) echo "Utilisation : deploy/auto-update.sh install|remove|status|run" >&2; exit 2 ;;
esac
