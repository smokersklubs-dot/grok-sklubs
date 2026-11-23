# Mise en route : les essais en vrai

Tout ce qui pouvait être vérifié sans tes comptes l'a été (64 tests automatiques, audit de sécurité corrigé). Ces étapes-ci ne peuvent être faites que par toi. Coche au fur et à mesure et note ce qui coince.

## 1. Installer (ou mettre à jour) sur le VPS — 15 min
- Première installation : suis [INSTALLATION-VPS.md](INSTALLATION-VPS.md). **Note le code d'installation** affiché en vert à la fin.
- Déjà installé : `cd /opt/sklubot && bash deploy/update.sh`. Le script ajoute le code d'installation s'il manque et active les protections (proxy Docker, conteneur en lecture seule).
- Vérifie que `PUBLIC_URL` (dans `.env`) est bien `https://ton-domaine` : les connexions aux applis reviennent à cette adresse.
- [ ] Le site s'ouvre en HTTPS et tu as créé ton compte avec le code d'installation.

## 2. Brancher ton abonnement Claude ou ChatGPT — 5 min
Réglages du bot → **Cerveau** → choisis Claude Code ou Codex → **Se connecter sur l'ordinateur de …**. L'écran du bot s'ouvre : connecte-toi toi-même dans la fenêtre (Sklubot ne voit jamais ton mot de passe).
- [ ] Le bot répond à un message en utilisant ton abonnement (badge d'abonnement visible).
- [ ] Ordinateurs déjà créés avant cette version : panneau du bot → Ordinateur → **Réinitialiser** pour qu'il reçoive le nouveau cloisonnement (ce qui a été installé dedans est effacé).

## 3. Relier tes données business — 10 min par appli
« Connecter des applis » → catalogue → **Ajouter** → **Se connecter**.
- Commence par **Windsor.ai** (Google Analytics + Search Console + pubs) ou **Supermetrics**, puis ton CRM (**HubSpot** : suis l'aide affichée pour créer le connecteur et coller l'adresse de retour).
- [ ] Au moins une appli est « Prête » avec ses outils.

## 4. Lancer la chasse aux pépites
Panneau du bot → **Pépites** → **Lancer la chasse aux pépites** (chaque jour à 8 h 40). Pour un premier essai tout de suite : réglages du bot → Routines → **Lancer maintenant**.
- [ ] Le bot analyse tes données. S'il ne trouve rien, il ne dit rien ; s'il trouve, euphorie + ligne dorée « Pépite trouvée » avec la note et les chiffres.
- Trop ou pas assez souvent ? Réglages du bot → Apparence → Joie → **Exigence** (Très rare / Rare / Plus souvent). Dis-moi ce que tu observes : on ajuste ses consignes.

## 5. Être prévenu
- Réglages → Notifications → active-les (le navigateur te demande l'autorisation).
- Réglages du bot → **Telegram** → relie ton Telegram : les pépites y arrivent aussi.
- [ ] Une pépite (ou un message) t'a été notifiée hors de l'onglet.

## 6. Téléphones
- **iPhone** : Safari → ton adresse → Partager → **Sur l'écran d'accueil**.
- **Android** : ouvre `https://ton-domaine/download/sklubot.apk` et installe.
  - « Application non installée » : désinstalle d'abord toute ancienne Sklubot (Paramètres → Applications → Sklubot → Désinstaller), supprime les anciens `sklubot*.apk` dans Mes fichiers → Téléchargements, retélécharge, puis réessaie. Sur Samsung, vérifie aussi Paramètres → Sécurité et confidentialité → **Blocage automatique** (à désactiver le temps de l'installation) et Play Store → Play Protect.
- [ ] Discussion, personnages et pépites s'affichent bien ; le micro marche.

## 7. Le cri de joie
Réglages du bot → Apparence → **Essayer : Euphorique** (clique d'abord une fois dans la page pour autoriser le son).
- [ ] Le cri te plaît (sinon dis-moi : plus long, plus aigu, plus discret…).

## 8. Sauvegarde automatique
`crontab -e` sur le VPS, puis ajoute la ligne de [SAUVEGARDE.md](SAUVEGARDE.md). Garde une copie de `.env` ailleurs.
- [ ] Une première sauvegarde existe.

## 9. Petits raccourcis de la discussion

- **Un passage pas clair ?** Sélectionne les mots dans la réponse du bot : une barre propose « Explique ce passage », « Plus simple », « Trop long », « Un exemple » ou « Remarque… ». Un clic suffit, pas besoin de recopier la phrase. Le bouton 💡 sous une réponse demande « Explique plus simplement ».
- **Tes commandes `/`** : Réglages → Raccourcis → « Mes commandes / ». Ensuite, tape `/` dans une discussion : le texte arrive dans la saisie, tu le relis et tu envoies. Tape `@` pour citer un fichier de la bibliothèque du bot.
- **Garder une discussion** : menu du bot (en haut) → « Exporter la discussion (Markdown) » ou « Exporter en PDF ». Les mots de passe et clés trouvés sont masqués.
- **Dans la liste des bots**, une petite pastille dit pourquoi un bot s'est arrêté (limite d'étapes, erreur, arrêté…), et la barre « Au travail » montre qui travaille en ce moment.
- **Un souci ?** Réglages → Docteur : un contrôle en lecture seule, ligne par ligne « OK » ou « À corriger ». « Copier le résumé » donne un texte sans chemin, adresse, e-mail ni secret, à coller dans une demande d'aide.

## Petits conforts (23/11)
- **Plusieurs conversations par bot** : menu du bot → « Conversations… ». Titres automatiques, Renommer, Épingler, Dossier, filtre « Automatiques » ; toucher une ancienne conversation la rouvre.
- **Au-dessus de la zone de saisie** : le modèle de cette conversation (à changer en deux clics) et la jauge « Contexte » (un clic : résumé et Compacter).
- **Un bot supprimé** part 30 jours dans Réglages → Équipe → Corbeille, d'où « Restaurer ». « Voir ce qui sera supprimé » avant de confirmer. « Exporter ce bot » / « Importer un bot » : un fichier, sans secrets ni conversations.
- **Fichiers Word, Excel, PowerPoint et CSV** s'ouvrent dans l'aperçu (les macros ne sont jamais lancées).
- **Notifications** : le téléphone ne sonne qu'après 30 s sans activité sur l'ordinateur, et si le travail a pris du temps ; tout est gardé dans « Notifications » (barre latérale), avec les sons au choix.
- **Pages** : « Comparer » une version, « Copie autonome », « Fiche A4 (PDF) », « Capture ».
- **Façon de parler** d'un bot (plus simple / normal / me contredire), **Garder l'historique** (Réglages → Mémoire), mots techniques expliqués en les touchant.

## Ce que je fais de tes retours
Pour chaque point qui coince : copie le message exact affiché (ou une capture) et envoie-le-moi. Je corrige, je teste, et tu relances `bash deploy/update.sh`.
