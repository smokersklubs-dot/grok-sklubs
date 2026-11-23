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
  requêtes (1 Mo pour le JSON, 8 Mo par bloc pour un fichier allant jusqu’à 1 Go, 96 Mo pour l’ancien envoi direct).
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
  (texte → voix, voix françaises et anglaise gratuites, licences CC BY / CC BY-SA, une voix différente par bot :
  [VOIX.md](VOIX.md)) démarrent avec Sklubot, sans profil, sur le
  réseau interne `sklubot_voice` seulement (ni publiés, ni joignables par les ordinateurs des bots) : la dictée et les
  appels marchent sur tous les navigateurs, iPhone compris. Compte ≈ 0,5 à 1,4 Go de RAM de plus selon le nombre de voix utilisées (plafonds
  `WHISPER_MEM_LIMIT` 1 Go, `PIPER_MEM_LIMIT` 1200 Mo). Le premier déploiement télécharge le modèle (142 Mo, service
  `whisper-model`, qui s'arrête ensuite : « Exited (0) » est normal). Dans Coolify, ne donne **pas** de domaine à
  `whisper`, `piper`, `kokoro` ni `whisper-model`. **Kokoro** (voix gratuites de meilleure qualité, ≈ 1 à 1,5 Go de RAM, plafond
  `KOKORO_MEM_LIMIT` 2 Go) tourne aussi par défaut ; `SKLUBOT_KOKORO=0` le met en veille (les bots parlent alors avec Piper). Pour les couper : `SKLUBOT_VOICE_LOCAL=0`, puis redéploie. Détails, licences
  et réglages : [INSTALLATION-VPS.md](INSTALLATION-VPS.md#voix-du-serveur-active-par-défaut-gratuite).
- **E-mails du serveur** (« Mot de passe oublié ? », confirmation d'un changement d'adresse) : à régler par le
  propriétaire dans Réglages → Compte → E-mails du serveur, ou par les variables `SKLUBOT_SMTP_HOST`,
  `SKLUBOT_SMTP_PORT`, `SKLUBOT_SMTP_TLS` (`tls`, `starttls` ou `none`), `SKLUBOT_SMTP_USER`, `SKLUBOT_SMTP_PASS`,
  `SKLUBOT_SMTP_FROM` (elles l'emportent sur la page). Le propriétaire qui a perdu l'accès, sur son téléphone, passe
  aussi par « Mot de passe oublié ? ». Sans e-mails du serveur, seule la commande reste : Coolify → service `sklubot`
  → *Terminal* → `node server/dist/reset-password.js ton@email.fr`. Il n'y a volontairement pas d'autre porte de secours.

### Clé de données (facultative, recommandée) et rotation

Les secrets que Sklubot garde dans sa base (coffre, jetons des connexions et des applis, clés de la sauvegarde
automatique, clés des voix, graines de double authentification…) sont scellés en AES-256-GCM. Sans réglage, la clé
est dérivée de `SKLUBOT_SESSION_SECRET` (identifiant `s0`) : rien à faire, tout continue de marcher. Mais alors,
changer `SKLUBOT_SESSION_SECRET` rendrait ces secrets illisibles. Une **clé de données dédiée** sépare les deux.

1. Génère une clé : `openssl rand -base64 32`.
2. Ajoute-la avec un identifiant court de ton choix (lettres, chiffres, `-`, `_`) :
   - VPS : dans `/opt/sklubot/.env`, `SKLUBOT_DATA_KEYS=k1:<la clé>` ;
   - Coolify : variable `SKLUBOT_DATA_KEYS` avec la même valeur ;
   puis redémarre Sklubot. Les **nouveaux** secrets sont scellés avec `k1` ; les anciens restent lisibles (avec
   `SESSION_SECRET`). Une clé mal écrite empêche le démarrage, avec la raison dans le journal.
3. Rechiffre tout de suite les anciens secrets sous `k1` (essai à blanc d'abord, rien n'est modifié) :
   ```bash
   docker compose exec sklubot node server/dist/rotatekey.js --dry-run   # Coolify : « Terminal » du conteneur Sklubot
   docker compose exec sklubot node server/dist/rotatekey.js
   ```
   Le rapport liste chaque emplacement (table et colonne), combien de valeurs étaient sous quelle clé, combien ont
   été rechiffrées, et celles qu'aucune clé n'ouvre (laissées telles quelles). Tout se fait en une seule transaction :
   tout ou rien. Le Cerveau peut rester allumé.

**Changer de clé plus tard (rotation).** Ajoute la nouvelle clé **en tête** et garde l'ancienne derrière :
`SKLUBOT_DATA_KEYS=k2:<nouvelle>,k1:<ancienne>`, redémarre, lance `rotatekey.js` (comme au 3). Quand le rapport dit
« illisibles : 0 », tu peux retirer `k1` : `SKLUBOT_DATA_KEYS=k2:<nouvelle>`. Garde l'ancienne clé avec tes anciennes
sauvegardes : elles en ont encore besoin. Le propriétaire du serveur peut aussi voir l'état sans SSH :
`GET /api/admin/data-key` (essai à blanc) et `POST /api/admin/data-key/rotate` avec `{"dryRun": false}`.

Format : `SKLUBOT_DATA_KEYS="id:clé,id:clé"` (la plus récente d'abord ; clé de 32 octets en base64 ou 64 caractères
hexadécimaux). `DATA_KEY=<clé>` seule marche aussi (identifiant tiré de l'empreinte de la clé). L'identifiant `s0`
est réservé à la clé dérivée de `SESSION_SECRET`. Une valeur scellée commence par `v2:<id>:` ; une valeur sans ce
préfixe date d'avant et s'ouvre avec la clé `s0`. La sauvegarde chiffrée emporte `DATA_KEYS` (docs/SAUVEGARDE.md).

### Un seul serveur par dossier de données

Au démarrage, Sklubot pose un verrou dans son dossier de données (`DATA_DIR/server.lock`). Si un deuxième serveur
est lancé par erreur sur le même dossier (deux conteneurs sur le même volume, un `npm run dev` oublié…), il refuse de
démarrer avec un message clair : « Un autre serveur Sklubot utilise déjà ce dossier de données… », le numéro du
processus et la machine. Arrête l'autre serveur, ou choisis un autre dossier avec `DATA_DIR`.

Après un arrêt brutal (coupure, `kill -9`, conteneur relancé), le verrou laissé derrière est repris tout seul : le
processus n'existe plus (vérifié avec son heure de démarrage sous Linux), ou, sur un disque partagé entre machines,
il ne donne plus signe de vie depuis 1 minute (le serveur réécrit le verrou toutes les 10 s). Rien à faire à la main.
Si un serveur découvre que son verrou a été repris par un autre, il s'arrête : deux serveurs ne tournent jamais
ensemble sur les mêmes données (`server/src/datalock.ts`).

### Comptes : double authentification et sessions

- **Double authentification** (Réglages → Compte) : chacun peut l'activer avec une appli comme Google Authenticator,
  Aegis ou 1Password (codes TOTP, RFC 6238, 6 chiffres, 30 s). Le QR code est dessiné dans la page, la graine est
  scellée avec la clé de données, 10 codes de secours (chacun une fois) sont affichés une seule fois et gardés hachés.
- Elle s'applique à **toutes** les entrées : mot de passe, « Continuer avec Google » (Google prouve qui tu es, pas que
  tu as le téléphone : le code est demandé aussi), lien de connexion imprimé par le serveur, appli mobile, et la
  réinitialisation du mot de passe par e-mail (le nouveau mot de passe est enregistré, mais la connexion demande
  encore le code ou un code de secours : une boîte mail seule ne suffit pas).
- Deuxième étape limitée : 5 minutes, 5 essais par connexion, 10 codes faux par compte par quart d'heure, 30 essais
  par adresse ; un même code ne sert qu'une fois.
- Téléphone **et** codes de secours perdus : le propriétaire du serveur la retire en ligne de commande :
  `docker compose exec sklubot node server/dist/reset-password.js <e-mail> --disable-2fa`.
- **Sessions** : Réglages → Compte → « Se déconnecter de tous les appareils » (celui-ci reste connecté). En mode
  hébergé, un opérateur peut déconnecter un compte partout : `POST /api/admin/customers/<id>/sessions/revoke`
  (inscrit au journal d'administration). Les sessions durent 30 jours ; les sessions expirées, les connexions en
  attente du code et les liens de connexion périmés sont effacés au démarrage puis toutes les heures.

### Mise à jour depuis une version précédente (Coolify)

Rien à faire à la main : redéploie comme d'habitude. Au démarrage, la nouvelle version met la base à jour par
migrations numérotées (`PRAGMA user_version`) après en avoir fait une copie à côté d'elle
(`sklubot.db.pre-vX-to-vY-….bak`, les 3 dernières gardées) ; une base plus récente que le code est refusée sans être
touchée (revenir en arrière = restaurer la sauvegarde d'avant la mise à jour). Au premier usage de chaque ordinateur de bot, Sklubot le
refait sur le nouveau réseau (son dossier personnel — fichiers, connexions, navigateur — et sa bibliothèque sont
gardés ; ce qui avait été installé hors de `/root` est à réinstaller, comme lors d'un changement de dossier d'équipe).
Le réseau `sklubot_bots` est créé tout seul. Si quelque chose ne va pas, `SKLUBOT_BOT_LINK=network` (et
`SKLUBOT_PROXY_NETWORKS=sklubot_bots,sklubot_net`) remet l'ancienne façon le temps de regarder.

### Mise à jour : bac à sable du navigateur des bots (L48, 2026-11-22)

Le navigateur des ordinateurs des bots tourne désormais avec un utilisateur à part et son propre bac à sable
(docs/SECURITE.md, « Navigateur des bots »). Il faut **reconstruire les deux images** : celle de l'ordinateur
(`sklubot-desktop`, qui crée l'utilisateur `browser`) et celle de l'application (qui contient le profil seccomp
`docker/desktop/seccomp-chromium.json`, lu par le serveur et par son proxy Docker).

- **VPS** : `bash deploy/update.sh` (il fait `docker compose -f docker-compose.vps.yml up -d --build`, qui reconstruit
  aussi `desktop-image`). À la main : `docker compose -f docker-compose.vps.yml build desktop-image sklubot docker-proxy`
  puis `docker compose -f docker-compose.vps.yml up -d`.
- **Coolify** : redéploie (le service `desktop-image` est reconstruit avec le reste).
- **Sans Docker Compose** : `npm run computer:build`, puis redémarre le serveur.

Ensuite rien à faire : chaque ordinateur fait avec l'ancienne image est **refait tout seul** la prochaine fois qu'il ne
sert pas (dossier personnel, connexions et bibliothèque gardés ; paquets Debian remis par `sklubot-install`). Tant
qu'il ne l'est pas, il marche comme avant. Réglages → Autorisations → Sécurité dit où on en est : « Bac à sable du
navigateur : actif », ou combien d'ordinateurs sont encore sur l'ancienne image, ou s'il a fallu démarrer un navigateur
sans bac à sable (hôte qui interdit les espaces de noms utilisateur : sur Ubuntu 23.10 ou plus récent, vérifie que
`sysctl kernel.apparmor_restrict_unprivileged_userns` ne bloque pas les conteneurs ; le navigateur reste alors utilisable,
sans bac à sable mais pas en root). Pour vérifier un ordinateur : `docker exec sklubot-<bot> cat /tmp/sklubot-browser-sandbox`
doit répondre `on`.

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

### Mémoire : limites par conteneur, échange et arrêt préventif (L95)

- Chaque service qui tourne en continu a un plafond de mémoire dans `docker-compose.vps.yml` et `docker-compose.coolify.yml` : Sklubot `SKLUBOT_MEM_LIMIT` (3 Go par défaut), le proxy Docker `SKLUBOT_PROXY_MEM_LIMIT` (192 Mo), Caddy `CADDY_MEM_LIMIT` (256 Mo), les voix comme avant (`WHISPER_MEM_LIMIT`, `PIPER_MEM_LIMIT`, `KOKORO_MEM_LIMIT`). Les ordinateurs des bots ont le leur (`DESKTOP_MEMORY`, 2 Go, sans swap en plus). Le plafond ne gêne pas un usage normal : il empêche seulement un service d'emporter toute la machine. À changer dans `.env` (ou les variables de Coolify).
- Sur un VPS installé avec `deploy/install.sh`, le fichier d'échange et **earlyoom** sont posés tout seuls (`deploy/memory-guard.sh`, voir INSTALLATION-VPS.md). **Sous Coolify** ou sur un serveur installé autrement, fais-le une fois : `sudo bash deploy/memory-guard.sh` (fichier d'échange de 2 à 4 Go s'il n'y en a pas, `vm.swappiness=10`, earlyoom qui arrête d'abord les navigateurs des bots, jamais en priorité Sklubot, Caddy, SSH ni Docker). Vérifie avec `free -h` et `journalctl -u earlyoom`.
- Chrome en root : le navigateur des bots ne tourne jamais en root (`open-browser.sh` le lance sous un compte à part, avec son propre bac à sable) ; s'il refuse de démarrer, `docker/desktop/open-browser.sh` le relance sans bac à sable et Réglages → Sécurité le dit (L48).
- Pas fait ici : un plafond « heures d'ordinateur » séparé, l'arrêt automatique des conteneurs sans bot (voir A-FAIRE L95).

### Mises à jour automatiques (option, éteinte par défaut — L168)

Pour un Sklubot installé chez toi (VPS) seulement. `deploy/auto-update.sh` ne fait **rien** tant que tu ne l'as pas allumé, et n'installe que des versions **signées** :

1. Mets dans `.env` : `SKLUBOT_AUTO_UPDATE=1` et, si tu veux, `SKLUBOT_UPDATE_WINDOW=03:00-05:00` (le créneau calme, heure du serveur).
2. Dis qui a le droit de signer une version : le fichier `deploy/allowed_signers` (format « allowed signers » de `ssh-keygen`), ou bien `SKLUBOT_UPDATE_GNUPGHOME=<dossier>`, un trousseau GnuPG qui ne contient que les clés publiques autorisées. Sans signataire : rien n'est installé.
3. Installe le minuteur : `sudo bash deploy/auto-update.sh install` (essai toutes les heures, rien hors du créneau). `bash deploy/auto-update.sh status` dit ce qui s'est passé ; `sudo bash deploy/auto-update.sh remove` l'enlève.

À chaque essai : la plus récente étiquette `v*` **signée par un signataire autorisé** (`git verify-tag`) et plus récente que la version qui tourne (jamais de retour en arrière par ce chemin) → **sauvegarde complète d'abord** (`deploy/backup.sh` ; si elle échoue, rien ne change) → passage à cette version, reconstruction → vérification de santé (`/api/health`, 6 essais sur 3 minutes) → si la santé ne répond pas : **retour automatique** à la version d'avant ; si elle ne répond toujours pas, la sauvegarde faite juste avant est remise (`deploy/restore.sh`). Journal : `/var/log/sklubot-auto-update.log`, état : `auto-update-status.json`.

**Mode hébergé** (`SKLUBOT_HOSTED_MODE=1`) : jamais de mise à jour sans l'opérateur. Le script dit seulement « version disponible » ; l'opérateur l'applique lui-même avec `deploy/update.sh`. Sous Coolify, les mises à jour restent celles de Coolify (ce script ne s'en occupe pas).

### Ordinateurs partagés entre les bots

Dans les réglages d'un bot (section Ordinateur), « Ordinateur : le sien / partagé ». Les bots réglés sur
« partagé » utilisent les ordinateurs partagés du compte (un au départ, jusqu'à `SKLUBOT_MAX_SHARED_COMPUTERS`,
3 par défaut, ajoutés dans Réglages → Ordinateur) : mêmes fichiers personnels, même navigateur, mêmes connexions
Claude / ChatGPT. Un seul bot à la fois s'en sert ; un autre attend qu'il se libère (puis un message clair « occupé »).
Chaque bot garde sa bibliothèque à `~/files` (toutes celles des bots partageant l'ordinateur y sont montées sous
`~/libraries/`, donc lisibles entre eux). Un ordinateur partagé n'appartient qu'à un compte.

## Métriques pour un outil de surveillance (L184)

`GET /api/metrics` donne les chiffres du serveur au format Prometheus (bots, groupes, applis, messages, jetons, coût
estimé, accords en attente, passages des routines) : des nombres seulement, aucun nom ni texte. Fermé par défaut :
mets `METRICS_TOKEN` (32 caractères ou plus) dans l'environnement du serveur, et fais lire la page avec l'en-tête
`Authorization: Bearer <METRICS_TOKEN>`. Les chiffres de ton compte sont aussi dans Réglages → Usage → « Métriques ».

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

## Un abonnement ChatGPT pour les bots du propriétaire

Sur une installation personnelle avec `BOT_LINK=socket`, le propriétaire peut autoriser son propre forfait une fois. Sous le répertoire de données du serveur, créer `personal-chatgpt` avec les droits `0700`. Dans ce répertoire, le fichier `owner` doit contenir l’identifiant du compte Sklubot du propriétaire, sur une seule ligne. Le serveur lit ce réglage à la demande.

Dans **Réglages → Modèles → ChatGPT pour mes bots**, choisir **Continuer avec ChatGPT**. Le bureau Linux choisi affiche la demande d’OpenAI. Le propriétaire vérifie le compte et les permissions. Après autorisation, les bots configurés avec un modèle ChatGPT utilisent le forfait personnel. Chacun conserve sa bibliothèque, son historique et son bureau. Le bouton **Déconnecter l’abonnement partagé** révoque cet accès.

Le serveur conserve l’autorisation de cette installation dans son répertoire privé. Chaque bot n’accède qu’au service de génération, sur son propre socket et pendant son tour. Une installation destinée à des clients doit appliquer les conditions du fournisseur avant de proposer l’intégration à ces clients. Les abonnements Claude utilisent le client officiel Claude Code sur le bureau du bot. [Parcours OpenAI pour les installations personnelles](https://developers.openai.com/siwc/token-sharing-open-source) · [Conditions de Claude Code](https://code.claude.com/docs/en/legal-and-compliance)
