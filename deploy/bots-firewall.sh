#!/usr/bin/env bash
# Pare-feu facultatif des ordinateurs des bots (revue de sécurité, H2). À lancer sur l'hôte, en root :
#   sudo bash deploy/bots-firewall.sh          met les règles (sans doublon : on peut le relancer)
#   sudo bash deploy/bots-firewall.sh off      les retire
#   sudo bash deploy/bots-firewall.sh status   les affiche
#
# Les ordinateurs des bots sont sur leur propre réseau Docker (sklubot_bots, interface « sklubot-bots », sans trafic
# entre conteneurs : com.docker.network.bridge.enable_icc=false). Sans ces règles, ils peuvent encore joindre :
#   - l'hôte lui-même (SSH, le tableau de bord de Coolify, toute base de données qui écoute sur 0.0.0.0) ;
#   - le service de métadonnées du fournisseur cloud (169.254.169.254 : parfois des identifiants !) ;
#   - les réseaux privés (10/8, 172.16/12, 192.168/16, 100.64/10) : autres conteneurs Docker, autres machines du réseau.
# Ces règles coupent tout cela et laissent Internet et le DNS. Elles vont dans la chaîne DOCKER-USER, que Docker
# laisse aux administrateurs et passe avant ses propres règles (https://docs.docker.com/engine/network/packet-filtering-firewalls/),
# et dans INPUT pour le trafic vers l'hôte lui-même.
# Options vérifiées avec iptables v1.8.10 (`iptables -h`, man iptables(8) et iptables-extensions(8) : -C vérifie qu'une
# règle existe, -I l'insère en tête, -D la retire ; -m conntrack --ctstate ESTABLISHED,RELATED laisse passer les réponses).
# Les règles ne survivent pas à un redémarrage de la machine : le service systemd installé avec « persist » les remet.
#   sudo bash deploy/bots-firewall.sh persist  installe /etc/systemd/system/sklubot-bots-firewall.service
set -euo pipefail
IF="${SKLUBOT_BOTS_INTERFACE:-sklubot-bots}"
PRIVATE=(169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 127.0.0.0/8)

[ "$(id -u)" = 0 ] || { echo "À lancer en root (sudo)." >&2; exit 1; }
command -v iptables >/dev/null || { echo "iptables est introuvable sur cette machine." >&2; exit 1; }
iptables -L DOCKER-USER -n >/dev/null 2>&1 || { echo "La chaîne DOCKER-USER n'existe pas : Docker tourne-t-il ?" >&2; exit 1; }

# Les règles, de la dernière à la première (chacune est insérée en tête de sa chaîne).
rules() {
  for net in "${PRIVATE[@]}"; do echo "DOCKER-USER -i $IF -d $net -j DROP"; done
  # Le DNS de Docker relaie les requêtes vers les serveurs de l'hôte, qui peuvent être sur un réseau privé.
  echo "DOCKER-USER -i $IF -p tcp --dport 53 -j RETURN"
  echo "DOCKER-USER -i $IF -p udp --dport 53 -j RETURN"
  echo "DOCKER-USER -i $IF -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN"
  echo "INPUT -i $IF -j DROP"
  echo "INPUT -i $IF -p tcp --dport 53 -j ACCEPT"
  echo "INPUT -i $IF -p udp --dport 53 -j ACCEPT"
  echo "INPUT -i $IF -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT"
}

case "${1:-on}" in
  on)
    while read -r chain spec; do
      # shellcheck disable=SC2086
      iptables -C "$chain" $spec 2>/dev/null || iptables -I "$chain" $spec
    done < <(rules)
    echo "Pare-feu des ordinateurs des bots en place (interface $IF)."
    ;;
  off)
    while read -r chain spec; do
      # shellcheck disable=SC2086
      while iptables -C "$chain" $spec 2>/dev/null; do iptables -D "$chain" $spec; done
    done < <(rules)
    echo "Pare-feu des ordinateurs des bots retiré."
    ;;
  status)
    iptables -S DOCKER-USER | grep -- "-i $IF" || echo "(aucune règle DOCKER-USER pour $IF)"
    iptables -S INPUT | grep -- "-i $IF" || echo "(aucune règle INPUT pour $IF)"
    ;;
  persist)
    here="$(cd "$(dirname "$0")" && pwd)"
    cat > /etc/systemd/system/sklubot-bots-firewall.service <<UNIT
[Unit]
Description=Sklubot : pare-feu des ordinateurs des bots
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $here/bots-firewall.sh on
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now sklubot-bots-firewall.service
    echo "Service sklubot-bots-firewall installé : les règles reviennent à chaque démarrage."
    ;;
  *) echo "Usage : $0 [on|off|status|persist]" >&2; exit 2 ;;
esac
