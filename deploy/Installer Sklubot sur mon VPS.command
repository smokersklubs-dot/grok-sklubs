#!/usr/bin/env bash
# Mac et Linux : se connecte a ton VPS et y installe Sklubot. Lance-le avec :  bash "Installer Sklubot sur mon VPS.command"
set -u
BRANCH="${SKLUBOT_BRANCH:-claude/trusting-knuth-awqogb}"
echo
echo "  Installation de Sklubot sur ton VPS"
echo "  -----------------------------------"
echo "  Il te faut : l'adresse IP du VPS et son mot de passe administrateur (donnes par ton hebergeur)."
echo
read -r -p "  Adresse IP (ou nom) du VPS : " HOST
read -r -p "  Utilisateur [root] : " WHO
WHO="${WHO:-root}"
[ -n "$HOST" ] || { echo "  Il faut une adresse."; exit 1; }
echo
echo "  Connexion a $WHO@$HOST. La premiere fois, reponds 'yes' a la question sur l'empreinte, puis saisis le mot de passe"
echo "  (rien ne s'affiche pendant la frappe, c'est normal)."
echo
SUDO=""; [ "$WHO" = "root" ] || SUDO="sudo "
ssh -t "$WHO@$HOST" "curl -fsSL https://raw.githubusercontent.com/smokersklubs-dot/grok-sklubs/$BRANCH/deploy/install.sh -o /tmp/sklubot-install.sh && ${SUDO}env SKLUBOT_BRANCH=$BRANCH bash /tmp/sklubot-install.sh"
echo
read -r -p "  Termine. Appuie sur Entree pour fermer." _
