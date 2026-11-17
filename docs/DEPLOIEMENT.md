# Mettre Sklubot en ligne, et l'avoir sur ton téléphone

## 1. Mise en ligne (Coolify ou tout serveur avec Docker)

Il te faut un serveur Linux avec Docker, et un nom de domaine. Compte 2 Go de mémoire par ordinateur de bot
éveillé (4 au maximum par défaut), plus environ 1 Go pour Sklubot lui-même.

**Avec Coolify**

1. Nouveau projet → *Docker Compose* → ce dépôt, branche de ton choix, fichier `docker-compose.coolify.yml`.
2. Dans les variables d'environnement, recopie `.env.coolify.example` et remplis :
   - `SKLUBOT_PUBLIC_URL` : l'adresse publique, par exemple `https://bots.exemple.fr` (exactement celle que tu
     tapes dans le navigateur : les connexions OAuth aux applications reviennent sur
     `<adresse>/api/connectors/oauth/callback`) ;
   - `SKLUBOT_SESSION_SECRET` : le résultat de `openssl rand -hex 32` ;
   - une clé de modèle (`ANTHROPIC_API_KEY`), ou `SKLUBOT_DEMO_MODE=1` pour essayer sans clé ;
   - `SKLUBOT_SETUP_CODE` : un code au hasard (par exemple le résultat de `openssl rand -hex 6`), demandé
     pour créer le premier compte.
3. Associe ton domaine au service `sklubot`, port `3000`. Coolify s'occupe du HTTPS.
4. Déploie. La première fois, la construction de l'image de l'ordinateur des bots prend quelques minutes.
5. Ouvre l'adresse et crée ton compte avec le code `SKLUBOT_SETUP_CODE` : le premier compte créé est le tien,
   les inscriptions se ferment ensuite (le code ne sert plus ensuite).

**Sans Coolify**

```bash
cp .env.coolify.example .env        # puis remplis-le
docker compose -f docker-compose.coolify.yml up -d --build
```

Sklubot écoute alors sur le port 3000 du conteneur ; place un proxy HTTPS (Caddy, Traefik, nginx) devant.

**À savoir**

- Sklubot crée l'ordinateur Linux de chaque bot à travers le service `docker-proxy`, le seul à monter
  `/var/run/docker.sock`. C'est le proxy de Sklubot (`server/src/dockerproxy.ts`, même image que l'application) :
  il lit le contenu de chaque demande et ne laisse créer que des ordinateurs depuis l'image `sklubot-desktop`,
  sans privilège, avec les capacités réduites, sur le réseau des bots, sans dossier de l'hôte ; les autres actions
  ne touchent que les conteneurs étiquetés `sklubot`. Cela reste un accès à Docker : réserve ce serveur à Sklubot.
- L'application tourne sans privilège Linux et sur un système de fichiers en lecture seule (seuls `/data` et
  `/tmp` s'écrivent). Elle envoie une politique de sécurité du contenu (CSP) stricte et limite la taille des
  requêtes (1 Mo, 25 Mo pour un fichier envoyé).
- Les ordinateurs des bots sont sur leur propre réseau Docker, `sklubot_bots` (créé par Sklubot, sans trafic entre
  conteneurs). Ils joignent Sklubot par une prise (socket) qui leur est propre, dans `sklubot_data/botlink/`, qui ne
  sert que leurs outils (`/mcp/…`) et le relais d'identifiants (`/egress/…`) : ni le port 3000, ni le courrier, ni le
  proxy Docker, ni la voix, ni les autres ordinateurs. Le port web n'a plus du tout `/mcp/` ni `/egress/`.
- Toutes les données sont dans le volume `sklubot_data` (base, fichiers des bots), plus un volume `sklubot-home-*` par
  ordinateur. **Sauvegarde** : `deploy/backup.sh` en SSH sur le serveur (copie en ligne, secrets chiffrés, rotation,
  copie distante), exercice de restauration `deploy/restore-drill.sh`, et une tâche planifiée Coolify en complément :
  voir [SAUVEGARDE.md](SAUVEGARDE.md#coolify).
- Surveillance : `/api/health` (public, rapide) répond `{"ok":true,"status":"ok"|"degraded","code":"…"}` — `degraded`
  avec un code court (`disk_low`, `docker_unreachable`, `scheduler_stalled`, `queue_stuck`, `backup_old`…) reste en
  HTTP 200 pour que le healthcheck de Coolify ne relance pas le conteneur pour rien ; seuls une base qui n'accepte plus
  d'écriture ou un disque plein donnent `down` (HTTP 503). Le détail (place libre, âge de la dernière sauvegarde et du
  dernier exercice…) est réservé au propriétaire du serveur, connecté : `GET /api/health/deep`. Un moniteur externe
  (Uptime Kuma, etc.) peut surveiller `/api/health` et alerter si `status` n'est pas `ok`.
- Le HTTPS est nécessaire pour le micro (dictée, appel vocal) et pour l'installation sur iPhone.
- **Voix du serveur, active par défaut** : les services `whisper` (voix → texte, whisper.cpp, modèle `base`) et `piper`
  (texte → voix, voix française `fr_FR-siwis-medium`, licence CC BY 4.0) démarrent avec Sklubot, sans profil, sur le
  réseau interne `sklubot_voice` seulement (ni publiés, ni joignables par les ordinateurs des bots) : la dictée et les
  appels marchent sur tous les navigateurs, iPhone compris. Compte ≈ 0,5 à 0,8 Go de RAM de plus (plafonds
  `WHISPER_MEM_LIMIT` 1 Go, `PIPER_MEM_LIMIT` 768 Mo). Le premier déploiement télécharge le modèle (142 Mo, service
  `whisper-model`, qui s'arrête ensuite : « Exited (0) » est normal). Dans Coolify, ne donne **pas** de domaine à
  `whisper`, `piper` ni `whisper-model`. Pour les couper : `SKLUBOT_VOICE_LOCAL=0`, puis redéploie. Détails, licences
  et réglages : [INSTALLATION-VPS.md](INSTALLATION-VPS.md#voix-du-serveur-active-par-défaut-gratuite).
- **E-mails du serveur** (« Mot de passe oublié ? », confirmation d'un changement d'adresse) : à régler par le
  propriétaire dans Réglages → Compte → E-mails du serveur, ou par les variables `SKLUBOT_SMTP_HOST`,
  `SKLUBOT_SMTP_PORT`, `SKLUBOT_SMTP_TLS` (`tls`, `starttls` ou `none`), `SKLUBOT_SMTP_USER`, `SKLUBOT_SMTP_PASS`,
  `SKLUBOT_SMTP_FROM` (elles l'emportent sur la page). Le propriétaire qui a perdu l'accès, sur son téléphone, passe
  aussi par « Mot de passe oublié ? ». Sans e-mails du serveur, seule la commande reste : Coolify → service `sklubot`
  → *Terminal* → `node server/dist/reset-password.js ton@email.fr`. Il n'y a volontairement pas d'autre porte de secours.

### Mise à jour depuis une version précédente (Coolify)

Rien à faire à la main : redéploie comme d'habitude. Au démarrage, la nouvelle version met la base à jour par
migrations numérotées (`PRAGMA user_version`) après en avoir fait une copie à côté d'elle
(`sklubot.db.pre-vX-to-vY-….bak`, les 3 dernières gardées) ; une base plus récente que le code est refusée sans être
touchée (revenir en arrière = restaurer la sauvegarde d'avant la mise à jour). Au premier usage de chaque ordinateur de bot, Sklubot le
refait sur le nouveau réseau (son dossier personnel — fichiers, connexions, navigateur — et sa bibliothèque sont
gardés ; ce qui avait été installé hors de `/root` est à réinstaller, comme lors d'un changement de dossier d'équipe).
Le réseau `sklubot_bots` est créé tout seul. Si quelque chose ne va pas, `SKLUBOT_BOT_LINK=network` (et
`SKLUBOT_PROXY_NETWORKS=sklubot_bots,sklubot_net`) remet l'ancienne façon le temps de regarder.

### Isoler encore plus les ordinateurs des bots (facultatif, sur l'hôte)

Coolify ne laisse pas une application toucher au pare-feu de la machine. Sans règle de pare-feu, un ordinateur de
bot peut encore joindre l'hôte (SSH, le tableau de bord de Coolify, une base qui écoute sur toutes les adresses), le
service de métadonnées du fournisseur cloud (`169.254.169.254`) et les réseaux privés. Pour couper cela (Internet et
le DNS restent ouverts), en SSH sur la machine, une fois :

```bash
cd /chemin/vers/une/copie/du/dépôt      # ou copie seulement deploy/bots-firewall.sh
sudo bash deploy/bots-firewall.sh on       # règles iptables (chaîne DOCKER-USER et INPUT, interface sklubot-bots)
sudo bash deploy/bots-firewall.sh persist  # les remet à chaque démarrage (service systemd)
sudo bash deploy/bots-firewall.sh status   # vérifier ;  … off  pour les retirer
```

Coolify passe par Traefik, pas par Caddy : pour limiter aussi la taille des requêtes au niveau du proxy, ajoute au
service `sklubot` un middleware Traefik « buffering » (`maxRequestBodyBytes`, ex. 31457280) dans ses étiquettes ;
l'application applique de toute façon ses propres limites.

### Ordinateurs partagés entre les bots

Dans les réglages d'un bot (section Ordinateur), « Ordinateur : le sien / partagé ». Les bots réglés sur
« partagé » utilisent les ordinateurs partagés du compte (un au départ, jusqu'à `SKLUBOT_MAX_SHARED_COMPUTERS`,
3 par défaut, ajoutés dans Réglages → Ordinateur) : mêmes fichiers personnels, même navigateur, mêmes connexions
Claude / ChatGPT. Un seul bot à la fois s'en sert ; un autre attend qu'il se libère (puis un message clair « occupé »).
Chaque bot garde sa bibliothèque à `~/files` (toutes celles des bots partageant l'ordinateur y sont montées sous
`~/libraries/`, donc lisibles entre eux). Un ordinateur partagé n'appartient qu'à un compte.

## Télécharger les applications : la page `/telecharger`

Ton serveur a une page publique **Télécharger Sklubot** : `https://ton-adresse/telecharger` (lien en bas de la page de
connexion et dans **Réglages › Général › Applications Sklubot**). Elle repère le système du visiteur pour mettre le bon
bouton en avant et liste :

- l'**application Android** (`/download/sklubot.apk`, si le fichier est sur le serveur) ;
- l'**application pour ordinateur** Windows, macOS, Linux (avec le Relais intégré) : les fichiers déposés dans
  `web/public/download/` sous le nom `Sklubot-<version>-<os>.<ext>` (par exemple `Sklubot-1.0.0-linux.AppImage`,
  `Sklubot-1.0.0-win.exe`, `Sklubot-1.0.0-mac.dmg`), la version la plus récente de chaque type ; à défaut, un lien vers la
  [page des versions GitHub](https://github.com/smokersklubs-dot/grok-sklubs/releases) ;
- les étapes pour l'**iPhone et l'iPad** (écran d'accueil, pas d'application native).

La liste vient de `GET /api/downloads` (public, aucune donnée personnelle). Les mêmes fichiers d'ordinateur sont aussi
proposés dans **Réglages › Ordinateurs** pour installer le Relais.

Les fichiers pour ordinateur pèsent 100 à 160 Mo : GitHub refuse tout fichier de plus de 100 Mo dans un dépôt, donc
**ne les commite pas** (`.gitignore` les exclut). Deux façons de les servir :

1. les attacher à une Release GitHub (workflow `companion/.github-workflow-example.yml`, tag `desktop-vX.Y.Z`) : la page
   `/telecharger` renvoie alors vers GitHub ;
2. les copier sur le serveur, dans le dossier servi : avec Docker, `docker cp Sklubot-1.0.0-linux.AppImage
   <conteneur>:/app/web/dist/download/` (dossier `web/dist/download/` de l'image ; à refaire après chaque mise à jour de
   l'image), ou les déposer dans `web/public/download/` avant de construire l'image.

## Sklubot sur ordinateur (Windows, macOS, Linux)

L'application **Sklubot** pour ordinateur (dossier `companion/`) affiche ton Sklubot dans sa propre fenêtre, avec
notifications, icône dans la barre et nombre de non-lus, et contient le **Relais** (tes bots pilotent ton ordinateur,
avec ton accord). Au premier lancement, elle demande l'adresse du serveur (`https://…` obligatoire). Rien à configurer
côté serveur : elle passe par la même adresse que le navigateur. Installation, premier lancement sous Windows
(SmartScreen) et macOS (Gatekeeper) : [`companion/LISEZMOI.md`](../companion/LISEZMOI.md).

## 2. iPhone et iPad

1. Ouvre l'adresse de ton Sklubot dans **Safari**.
2. Touche **Partager**, puis **Sur l'écran d'accueil**.
3. Sklubot apparaît comme une application et s'ouvre en plein écran.

## 3. Android

1. Sur le téléphone, ouvre Sklubot dans le navigateur → **Réglages → Général → Sur ton téléphone →
   Télécharger l'APK** (ou directement `https://ton-adresse/download/sklubot.apk`).
2. Ouvre le fichier et autorise l'installation depuis cette source.
3. Au premier lancement, saisis l'adresse de ton Sklubot. Pour en changer plus tard : appui long sur
   l'icône de l'application → **Changer de serveur**.

L'application Android affiche ton Sklubot en plein écran et gère l'envoi de fichiers, les téléchargements
et le bouton retour. La dictée et l'appel vocal n'y fonctionnent pas (la reconnaissance vocale du
navigateur n'existe pas dans ce type d'application) : utilise Chrome pour cela.

### Laisser tes bots utiliser ton téléphone (facultatif)

L'application Android peut aussi relier **ton téléphone** à Sklubot, comme un ordinateur avec Sklubot Relais : tes bots
peuvent alors le regarder et s'en servir pour toi, avec ton accord sur le téléphone.

1. Mets à jour l'application (même lien que ci-dessus), puis ouvre-la une fois pour choisir ton serveur. **Le relais exige
   une adresse en `https`.**
2. Appui long sur l'icône → **Contrôle du téléphone** (ou dans Sklubot : Réglages → Ordinateurs → **Relier ce téléphone**).
3. **Active le service d'accessibilité** : bouton « Ouvrir les réglages d'accessibilité », choisis « Sklubot — contrôle du
   téléphone » et active-le. Sur Android 13 et plus récent, si l'interrupteur est grisé (« Paramètre restreint ») :
   infos de l'appli → ⋮ en haut à droite → **Autoriser les paramètres restreints**, puis recommence (c'est normal pour une
   appli installée depuis un fichier).
4. Autorise les notifications (Android 13+) : le bouton **Stop** est dans la notification.
5. Touche **Allumer le relais** : un code de 8 caractères s'affiche. Tape-le dans Sklubot → Réglages → **Ordinateurs**.
   Le téléphone apparaît dans la liste (« Téléphone · Android »).
6. Facultatif : **Choisir les applis bloquées** (tes applis de banque, de paiement…). Android ne peut pas savoir
   lesquelles c'est : coche-les toi-même.

**Ce que les bots peuvent faire** : captures d'écran (Android 11 ou plus récent), lire le texte à l'écran, appuyer,
appuyer longuement, glisser et faire défiler, écrire dans le champ où tu es, Retour, Accueil, Applis récentes,
notifications, ouvrir une appli ou une adresse web.

**Ce qu'ils ne peuvent pas faire** : lancer des commandes, agir sans ton « oui » sur le téléphone (Autoriser cette fois /
Toujours autoriser ce bot / Refuser ; sans réponse en 60 s, c'est refusé), voir ou toucher les applis que tu as bloquées,
agir sur l'écran de verrouillage, appuyer ou écrire dans Sklubot lui-même, changer les réglages du relais. Pas de vue en
direct : Sklubot montre la dernière capture prise par un bot.

**Stop à tout moment** : le bandeau rouge en haut de l'écran, la notification, ou la vignette « Stop Sklubot » des réglages
rapides (à ajouter une fois en modifiant les réglages rapides). Stop verrouille le relais jusqu'à ce que tu touches
« Réautoriser le contrôle » dans l'appli. L'appli garde un journal de ce que les bots ont fait.

Il faut Android 7 au minimum pour l'application, **Android 11** pour que les bots voient l'écran. Le relais tourne dans un
service de premier plan (notification permanente) tant que tu le laisses allumé ; « Éteindre le relais » le coupe.

**iPhone : impossible.** iOS n'autorise aucune application à voir l'écran ni à appuyer à ta place dans les autres
applications.

### Recompiler l'APK

Il faut le kit de développement Android (plateforme 35) et Java 17 ou plus récent. Le relais téléphone est écrit en
Kotlin (greffon Gradle `org.jetbrains.kotlin.android`) et utilise OkHttp ; Gradle les télécharge.

```bash
cd android
echo "sdk.dir=/chemin/vers/android-sdk" > local.properties
gradle testDebugUnitTest      # tests JVM du relais (règles d'accord, protocole) et rendu des écrans (Robolectric)
gradle assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../web/public/download/sklubot.apk
```

Pour signer, crée `android/keystore.properties` (jamais commité) :

```properties
storeFile=/chemin/vers/sklubot-release.jks
storePassword=…
keyAlias=sklubot
keyPassword=…
```

**Garde précieusement le fichier de clé et son mot de passe** : une mise à jour de l'application ne
s'installe par-dessus l'ancienne que si elle est signée avec la même clé.
