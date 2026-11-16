#!/usr/bin/env bash
# Protège un petit VPS contre le manque de mémoire, avant que tout le serveur ne se fige.
# Appelé par deploy/install.sh (étape 2) ; peut aussi être lancé seul : sudo bash deploy/memory-guard.sh
# Il peut être relancé autant de fois qu'on veut : il ne refait que ce qui manque, ne supprime jamais rien.
#
# 1. Fichier d'échange (swap). Règle de taille :
#    - s'il y a déjà un swap actif (fichier ou partition), on n'y touche pas ;
#    - à partir de 8 Go de mémoire, pas de fichier d'échange ;
#    - sinon : taille = mémoire arrondie au Go supérieur, au moins 2 Go et au plus 4 Go
#      (1 Go de mémoire -> 2 Go, 3 Go -> 3 Go, 6 Go -> 4 Go) ;
#    - il faut garder au moins 5 Go libres sur le disque après la création (images Docker, ordinateurs des
#      bots) : sinon la taille est réduite, et en dessous de 1 Go on n'en crée pas ;
#    - sur Btrfs, ou quand le noyau refuse (certains VPS « conteneurs » OpenVZ/LXC), on n'insiste pas.
#    vm.swappiness passe à 10 : le swap reste un filet de sécurité, la mémoire vive reste utilisée d'abord.
# 2. earlyoom (paquet de la distribution) : quand la mémoire disponible ET le swap libre sont presque épuisés,
#    il arrête un programme avant que le noyau ne gèle la machine. Il est réglé pour viser d'abord les
#    navigateurs des bots (Chromium / Chrome) et pour éviter Sklubot (node), le proxy HTTPS (caddy), le proxy
#    Docker (haproxy), SSH (sshd), Docker (dockerd, containerd, containerd-shim, docker-proxy) et systemd.
#    Options vérifiées sur earlyoom 1.7 (Debian 12 ; `earlyoom -h`, et MANPAGE.md / README.md du projet,
#    https://github.com/rfjakob/earlyoom/blob/v1.7/README.md#preferred-processes) :
#      -m PERCENT[,KILL_PERCENT]  minimum de mémoire disponible (SIGTERM en dessous, SIGKILL sous KILL_PERCENT)
#      -s PERCENT[,KILL_PERCENT]  minimum de swap libre ; « both memory and swap must be below minimum »
#      -r INTERVAL                intervalle du rapport mémoire dans le journal, en secondes
#      --prefer REGEX / --avoid REGEX  ajoute / retire 300 au score ; la REGEX est comparée au nom du
#                                 processus tel que dans /proc/PID/comm (15 caractères au plus)
#    Le réglage va dans /etc/default/earlyoom (EARLYOOM_ARGS), lu par le service du paquet
#    (ExecStart=/usr/bin/earlyoom $EARLYOOM_ARGS). Les expressions n'ont ni espace ni guillemet : systemd
#    découpe $EARLYOOM_ARGS aux espaces, sans tenir compte des guillemets.
#
# Variables pour les essais (chemins remplaçables) : SKLUBOT_MEMINFO, SKLUBOT_PROC_SWAPS, SKLUBOT_SWAPFILE,
# SKLUBOT_FSTAB, SKLUBOT_SYSCTL_FILE, SKLUBOT_EARLYOOM_DEFAULTS. SKLUBOT_SKIP_SWAP=1 / SKLUBOT_SKIP_EARLYOOM=1
# sautent une partie.
set -uo pipefail

MEMINFO="${SKLUBOT_MEMINFO:-/proc/meminfo}"
PROC_SWAPS="${SKLUBOT_PROC_SWAPS:-/proc/swaps}"
SWAPFILE="${SKLUBOT_SWAPFILE:-/swapfile}"
FSTAB="${SKLUBOT_FSTAB:-/etc/fstab}"
SYSCTL_FILE="${SKLUBOT_SYSCTL_FILE:-/etc/sysctl.d/90-sklubot-swap.conf}"
EARLYOOM_DEFAULTS="${SKLUBOT_EARLYOOM_DEFAULTS:-/etc/default/earlyoom}"
MARK="# Écrit par Sklubot (deploy/memory-guard.sh)"
PREFER='^(chromium|chrome|headless_shell)$'
AVOID='^(node|caddy|haproxy|sshd|dockerd|containerd|containerd-shim|docker-proxy|systemd|systemd-journal|init)$'
EARLYOOM_ARGS="-r 3600 -m 6 -s 20 --prefer $PREFER --avoid $AVOID"

info() { printf '  %s\n' "$*"; }

GIB=$((1024 * 1024)) # en Kio

# ── 1. Swap ──────────────────────────────────────────────────────────────────
# Taille du fichier d'échange à créer, en Gio (0 : aucun). mem_kib = mémoire totale, free_kib = place libre.
swap_size_gib() {
  local mem_kib="$1" free_kib="$2" mem_gib size room
  [ "$mem_kib" -ge $((8 * GIB)) ] && { echo 0; return; }
  mem_gib=$(( (mem_kib + GIB - 1) / GIB ))
  size=$mem_gib
  [ "$size" -lt 2 ] && size=2
  [ "$size" -gt 4 ] && size=4
  room=$(( (free_kib - 5 * GIB) / GIB ))
  [ "$room" -lt "$size" ] && size=$room
  [ "$size" -lt 1 ] && size=0
  echo "$size"
}

swap_active() { [ -r "$PROC_SWAPS" ] && [ "$(awk 'NR > 1' "$PROC_SWAPS" | wc -l)" -gt 0 ]; }

ensure_fstab() {
  if ! awk -v f="$SWAPFILE" '$1 == f && $3 == "swap" { found = 1 } END { exit !found }' "$FSTAB" 2>/dev/null; then
    printf '%s none swap sw 0 0\n' "$SWAPFILE" >> "$FSTAB"
  fi
}

ensure_swappiness() {
  [ -f "$SYSCTL_FILE" ] && grep -q '^vm.swappiness=10$' "$SYSCTL_FILE" && return
  mkdir -p "$(dirname "$SYSCTL_FILE")"
  printf '%s\nvm.swappiness=10\n' "$MARK" > "$SYSCTL_FILE"
  command -v sysctl >/dev/null 2>&1 && sysctl -q -w vm.swappiness=10 >/dev/null 2>&1
  return 0
}

setup_swap() {
  local mem_kib free_kib size fs dir
  mem_kib=$(awk '/^MemTotal:/ { print $2 }' "$MEMINFO")
  [ -n "$mem_kib" ] || { info "Swap : mémoire illisible, rien fait."; return 0; }
  if swap_active; then info "Swap : déjà présent, inchangé."; return 0; fi
  if [ -e "$SWAPFILE" ]; then
    # Un fichier d'une installation précédente qui n'est plus actif : on le réactive, sans jamais le supprimer.
    if swapon "$SWAPFILE" >/dev/null 2>&1; then ensure_fstab; ensure_swappiness; info "Swap : $SWAPFILE réactivé."
    else info "Swap : $SWAPFILE existe mais n'est pas un swap utilisable ; je n'y touche pas."; fi
    return 0
  fi
  dir=$(dirname "$SWAPFILE")
  free_kib=$(df -Pk "$dir" | awk 'NR == 2 { print $4 }')
  size=$(swap_size_gib "$mem_kib" "${free_kib:-0}")
  if [ "$size" -eq 0 ]; then
    if [ "$mem_kib" -ge $((8 * GIB)) ]; then info "Swap : pas nécessaire avec $((mem_kib / 1024)) Mo de mémoire."
    else info "Swap : pas assez de place libre sur le disque pour en créer un (il faut garder 5 Go)."; fi
    return 0
  fi
  fs=$(stat -f -c %T "$dir" 2>/dev/null || echo "")
  if [ "$fs" = "btrfs" ]; then info "Swap : disque Btrfs, je n'en crée pas (à faire à la main)."; return 0; fi
  info "Swap : création de $SWAPFILE ($size Go)…"
  ( umask 077; fallocate -l "${size}G" "$SWAPFILE" 2>/dev/null || dd if=/dev/zero of="$SWAPFILE" bs=1M count=$((size * 1024)) status=none ) || { rm -f "$SWAPFILE"; info "Swap : impossible d'écrire le fichier, rien fait."; return 0; }
  chmod 600 "$SWAPFILE"
  if mkswap "$SWAPFILE" >/dev/null 2>&1 && swapon "$SWAPFILE" >/dev/null 2>&1; then
    ensure_fstab
    ensure_swappiness
    info "Swap : $size Go actifs (et au redémarrage)."
  else
    # Ce fichier vient d'être créé par ce script : on peut le retirer.
    rm -f "$SWAPFILE"
    info "Swap : le système refuse le fichier d'échange (VPS de type conteneur ?) ; rien n'est changé."
  fi
  return 0
}

# ── 2. earlyoom ──────────────────────────────────────────────────────────────
setup_earlyoom() {
  if ! command -v earlyoom >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || { info "earlyoom : pas d'apt-get, je passe."; return 0; }
    info "earlyoom : installation…"
    if ! { apt-get install -y -qq earlyoom >/dev/null 2>&1 || { apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq earlyoom >/dev/null 2>&1; }; }; then
      info "earlyoom : paquet indisponible sur cette distribution, je passe."
      return 0
    fi
  fi
  local want changed=0
  want=$(printf '%s\n# Vise les navigateurs des bots, épargne Sklubot, le proxy, SSH et Docker (voir deploy/memory-guard.sh).\nEARLYOOM_ARGS="%s"\n' "$MARK" "$EARLYOOM_ARGS")
  if [ -f "$EARLYOOM_DEFAULTS" ] && ! grep -qF "$MARK" "$EARLYOOM_DEFAULTS" && grep -q '^EARLYOOM_ARGS=' "$EARLYOOM_DEFAULTS" && ! grep -q '^EARLYOOM_ARGS="-r 3600"$' "$EARLYOOM_DEFAULTS"; then
    # Réglage modifié à la main par l'administrateur : on le respecte.
    info "earlyoom : réglage personnalisé trouvé dans $EARLYOOM_DEFAULTS, conservé."
  elif [ "$(cat "$EARLYOOM_DEFAULTS" 2>/dev/null)" != "$want" ]; then
    mkdir -p "$(dirname "$EARLYOOM_DEFAULTS")"
    printf '%s\n' "$want" > "$EARLYOOM_DEFAULTS"
    changed=1
  fi
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl enable earlyoom >/dev/null 2>&1 || true
    if [ "$changed" = 1 ]; then systemctl restart earlyoom >/dev/null 2>&1 || true; else systemctl start earlyoom >/dev/null 2>&1 || true; fi
    if systemctl is-active --quiet earlyoom; then info "earlyoom : actif (vise Chromium, épargne Sklubot, SSH et Docker)."
    else info "earlyoom : installé mais pas démarré (voir : journalctl -u earlyoom)."; fi
  else
    info "earlyoom : réglé ; pas de systemd ici pour le démarrer."
  fi
  return 0
}

main() {
  if [ "$(id -u)" -ne 0 ] && [ "${SKLUBOT_ALLOW_NONROOT:-0}" != "1" ]; then info "Mémoire : il faut être administrateur, je passe."; return 0; fi
  [ "${SKLUBOT_SKIP_SWAP:-0}" = "1" ] || setup_swap
  [ "${SKLUBOT_SKIP_EARLYOOM:-0}" = "1" ] || setup_earlyoom
  return 0
}

# Sourcé (essais) : seules les fonctions sont définies.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
