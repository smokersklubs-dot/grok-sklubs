# Installer Sklubot sur un VPS, depuis ton ordinateur

Tu n'as rien à installer sur ton ordinateur. Tout se passe sur le VPS ; ton ordinateur sert seulement à s'y connecter.

## Ce qu'il te faut

| | |
|---|---|
| **Un VPS** | Ubuntu 22.04 ou 24.04 (ou Debian 12). **4 Go de mémoire au minimum, 8 Go conseillés** : chaque ordinateur de bot éveillé en prend 2. 40 Go de disque. |
| **Ses accès** | L'adresse IP et le mot de passe administrateur (`root`), envoyés par l'hébergeur à la commande. |
| **Un nom de domaine** (conseillé) | Par exemple `bots.tonsite.fr`. Sans lui, pas de HTTPS : le micro, l'installation sur iPhone et la plupart des connexions OAuth aux applications (HubSpot, Notion…) ne marcheront pas. Si tu changes de domaine plus tard, mets à jour l'adresse publique dans `.env` : c'est elle qui sert d'adresse de retour après une connexion. |
| **Une clé Claude** (facultatif au début) | Sur console.anthropic.com. Sans clé, Sklubot démarre en mode démo, gratuit, pour tout visiter. |

## Étape 1 — Faire pointer le domaine vers le VPS

Chez le vendeur de ton nom de domaine, ajoute un enregistrement **A** : nom `bots` (ou ce que tu veux), valeur = l'adresse IP du VPS. Attends quelques minutes.

## Étape 2 — Lancer l'installation

**Le plus simple : le lanceur.** Télécharge le dossier `deploy` du dépôt, puis :

- **Windows** : double-clique sur **`Installer Sklubot sur mon VPS.cmd`**.
- **Mac** : ouvre le Terminal, tape `bash ` (avec un espace), glisse **`Installer Sklubot sur mon VPS.command`** dans la fenêtre, puis Entrée.

Il te demande l'adresse IP du VPS, puis le mot de passe (rien ne s'affiche pendant la frappe : c'est normal).

**À la main**, c'est la même chose en deux commandes. Ouvre un terminal (Windows : PowerShell) :

```bash
ssh root@ADRESSE_IP_DU_VPS
```

puis, une fois connecté au VPS :

```bash
curl -fsSL https://raw.githubusercontent.com/smokersklubs-dot/grok-sklubs/claude/trusting-knuth-awqogb/deploy/install.sh -o install.sh && SKLUBOT_BRANCH=claude/trusting-knuth-awqogb bash install.sh
```

## Étape 3 — Répondre aux deux questions

1. **Nom de domaine** : celui de l'étape 1 (laisse vide pour essayer sans domaine).
2. **Clé Claude** : colle-la (laisse vide pour le mode démo).

L'installation dure 5 à 10 minutes. À la fin, l'adresse de ton Sklubot s'affiche en vert, avec un
**code d'installation** (par exemple `3f9a-c2e1-07bd`) : note-le, il te sera demandé à l'étape 4.

## Étape 4 — Créer ton compte

Ouvre l'adresse dans ton navigateur et crée ton compte en saisissant le **code d'installation** affiché à la fin
de l'étape 3. **Le premier compte créé est le tien** ; les inscriptions se ferment ensuite.

Pourquoi ce code : sans lui, quelqu'un qui tomberait sur ton serveur juste après l'installation, avant toi,
pourrait créer le premier compte et en prendre possession. Le code ne sert qu'une fois ; une fois ton compte
créé, il ne sert plus à rien. Tu l'as perdu ? Il est dans `/opt/sklubot/.env`, à la ligne `SKLUBOT_SETUP_CODE`.

Téléphone : voir [DEPLOIEMENT.md](DEPLOIEMENT.md) (iPhone : Safari → Partager → Sur l'écran d'accueil ; Android : `/download/sklubot.apk`).

## Ensuite

Sur le VPS, dans `/opt/sklubot` :

| Pour… | Commande |
|---|---|
| Ajouter ou changer la clé Claude, le domaine | `nano .env` puis `docker compose -f docker-compose.vps.yml up -d` |
| Mettre à jour Sklubot (fait d'abord une sauvegarde) | `bash deploy/update.sh` |
| Sauvegarder les données (sans arrêt ; chiffrement, rotation, copie distante : [SAUVEGARDE.md](SAUVEGARDE.md)) | `bash deploy/backup.sh` |
| Vérifier qu'une sauvegarde se restaure (copie isolée, détruite à la fin) | `bash deploy/restore-drill.sh` |
| Voir ce qui se passe | `docker compose -f docker-compose.vps.yml logs -f sklubot` |
| Arrêter | `docker compose -f docker-compose.vps.yml down` |
| Recevoir un lien de connexion (mot de passe perdu) | `docker compose -f docker-compose.vps.yml exec sklubot node server/dist/sign-in-link.js ton@adresse.fr` |
| Vérifier un ordinateur de bot de bout en bout | `docker compose -f docker-compose.vps.yml exec sklubot node server/dist/desk-cli.js` (ou Réglages → Ordinateur → **Lancer le banc d'essai**) |
| Tout désinstaller | `sudo bash deploy/uninstall.sh` (voir plus bas) |

**Lien de connexion.** La commande affiche une adresse valable **15 minutes**, utilisable **une seule fois** : ouvre-la
et tu es connecté. Déjà utilisée ou expirée, elle répond « ce lien a expiré ou a déjà servi » : relance la commande
pour en avoir un nouveau.

**Nom du premier bot.** À la création du compte, tu choisis le nom et le rôle de ton premier bot (par défaut
« Juno », « Bras droit »). Pour changer ces valeurs par défaut sur tout le serveur, lance l'installation avec
`SKLUBOT_FIRST_BOT_NAME=Maya SKLUBOT_FIRST_BOT_LABEL="Associée"` (écrit dans `.env` seulement si tu les fournis).
Le nom reste modifiable ensuite dans les réglages du bot.

**Nombre de bots.** Par défaut il n'y a pas de limite. `SKLUBOT_MAX_BOTS=6` dans `.env` (puis
`docker compose -f docker-compose.vps.yml up -d`) limite toute l'installation à 6 bots, tous comptes confondus
(les salons de groupe ne comptent pas). Au-delà, la création est refusée avec un message clair : retire un bot
d'abord. Aucun bot n'est jamais supprimé à ta place.

## Voix en temps réel (facultatif, gratuit)

Par défaut, les appels vocaux utilisent la reconnaissance et la synthèse vocales du navigateur, tour par tour. Pour
des appels à faible latence où **tu peux couper la parole au bot** (il se tait aussitôt et sa réponse en cours est
annulée), lance les deux services vocaux auto-hébergés :

```bash
cd /opt/sklubot
docker compose -f docker-compose.vps.yml --profile voice up -d whisper piper
# puis dans .env :
SKLUBOT_VOICE_STT_URL=http://whisper:8080
SKLUBOT_VOICE_TTS_URL=http://piper:5000
docker compose -f docker-compose.vps.yml up -d sklubot
```

- **whisper.cpp** (voix → texte) : image officielle `ghcr.io/ggml-org/whisper.cpp`, épinglée par empreinte. Le modèle
  (`base` par défaut, `WHISPER_MODEL=small` pour mieux comprendre, plus lent) est téléchargé une fois dans le volume
  `whisper_models`. Un VPS de 2 vCPU transcrit une phrase en moins d'une seconde avec `base`.
- **Piper** (texte → voix) : construit depuis `docker/piper` (version de `piper-tts` épinglée, voix `fr_FR-siwis-medium`
  par défaut ; autre voix : `docker compose build --build-arg PIPER_VOICE=en_US-lessac-medium piper`).
- Les deux restent sur le réseau interne : rien n'est publié sur Internet, Caddy n'est pas concerné.
- **OpenAI** (payant, facultatif) : dans Réglages → Voix, choisis OpenAI et colle une clé d'API (scellée sur le
  serveur), ou mets `OPENAI_API_KEY` dans `.env`.
- Réglages → Voix → **Tester** prononce une phrase puis la retranscrit. Sans service configuré, les appels repassent
  tout seuls en mode navigateur.

### Une voix par bot : Kokoro (gratuit) et Fish Audio (payant, clé à toi)

- **Kokoro** (texte → voix, gratuit, auto-hébergé) : [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI)
  (Apache-2.0) avec le modèle [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (poids Apache-2.0). Image CPU
  officielle épinglée (`ghcr.io/remsky/kokoro-fastapi-cpu:v0.10.0`, modèles inclus). Une cinquantaine de voix
  (anglais US/GB, français, espagnol, italien, portugais du Brésil, hindi, japonais, mandarin). Compte **1 à 2 Go de
  RAM** de plus quand il tourne (plafond `KOKORO_MEM_LIMIT`, 3 Go par défaut) : laisse-le éteint sur un petit VPS.

  ```bash
  docker compose -f docker-compose.vps.yml --profile kokoro up -d kokoro
  # puis dans .env :
  SKLUBOT_VOICE_KOKORO_URL=http://kokoro:8880
  docker compose -f docker-compose.vps.yml up -d sklubot
  ```

  Kokoro n'est que sur le réseau interne `sklubot_voice` (sans Internet), que seule l'application rejoint : il n'est
  ni publié, ni joignable par les ordinateurs des bots. **Coolify** : ajoute `COMPOSE_PROFILES=kokoro` et
  `SKLUBOT_VOICE_KOKORO_URL=http://kokoro:8880` aux variables, puis redéploie ; si le service `kokoro` n'apparaît pas
  (version de Coolify qui ignore les profils), lance la commande ci-dessus sur le serveur.
- **Fish Audio** (payant, facultatif) : chaque compte crée une clé d'API sur
  [fish.audio](https://fish.audio/app/api-keys/) et la colle dans Réglages → Voix (scellée sur le serveur, jamais
  renvoyée au navigateur). Seule l'API officielle est utilisée ; les voix sont désignées par leur identifiant public,
  rien n'est téléchargé. Le modèle `s2.1-pro-free` est gratuit ; les autres sont facturés par Fish Audio (15 $ par
  million d'octets de texte pour `s2.1-pro`), et chaque phrase lue apparaît dans Usage.
- Puis, dans les réglages d'un bot → **Voix** : cherche une voix (Fish Audio ou Kokoro), **Écouter**, **Choisir**. Sans
  voix choisie, le bot parle avec la voix par défaut du compte. Respecte les conditions de Fish Audio et les droits de
  chaque voix (auteur affiché) ; ne clone jamais la voix de quelqu'un sans son accord.

## Une adresse e-mail pour chaque bot (facultatif)

Chaque bot peut recevoir des e-mails à sa propre adresse (`juno@bots.ton-domaine.fr`) et répondre par ton relais SMTP.

1. **DNS** : crée un enregistrement `MX` pour un sous-domaine (ex. `bots.ton-domaine.fr`) qui pointe vers le nom du
   VPS (un enregistrement `A` du même nom, ou celui de Sklubot). Utilise un sous-domaine dédié : ta boîte mail
   habituelle n'est pas touchée.
2. **`.env`** : `SKLUBOT_MAIL_DOMAIN=bots.ton-domaine.fr` et `SKLUBOT_MAIL_SMTP_PORT=2525`.
3. **Ouvrir le port 25** : `docker compose -f docker-compose.vps.yml -f deploy/docker-compose.mail.yml up -d` (le port
   25 public est relié au 2525 du conteneur, qui tourne sans privilège). Ouvre aussi le port 25 entrant dans le
   pare-feu du VPS (`ufw allow 25/tcp`).
4. **Le port 25 est souvent bloqué** par les hébergeurs (contre le spam), surtout en **sortie**, parfois en entrée
   (c'est le cas par défaut chez plusieurs grands hébergeurs et clouds ; vérifie la page « port 25 / SMTP » de la
   documentation du tien). Pour la **réception**, il faut que l'entrée soit ouverte : teste depuis une autre machine
   avec `nc -vz bots.ton-domaine.fr 25` ; si c'est fermé, demande le déblocage au support de l'hébergeur (souvent un
   formulaire dans sa console, parfois après une vérification du compte). Les **envois** des bots ne passent pas par le port 25 de ton
   VPS : ils partent par ton relais SMTP (port 587 ou 465), réglé dans Réglages → E-mail.
5. **Relais et DKIM** (Réglages → E-mail) : serveur SMTP de ton fournisseur, identifiant, mot de passe (scellé). Pour
   signer en DKIM, génère une clé (`openssl genrsa -out dkim.pem 2048`, puis
   `openssl rsa -in dkim.pem -pubout -outform der | base64 -w0`), publie `sklubot._domainkey.bots.ton-domaine.fr TXT
   "v=DKIM1; k=rsa; p=<clé publique>"`, colle la clé privée et le sélecteur `sklubot`. Ajoute aussi un SPF qui inclut
   ton relais et une politique DMARC sur le domaine d'envoi.
6. Dans les réglages du bot → **E-mail** : choisis l'adresse, les expéditeurs autorisés (vide = tout le monde) ; la
   réponse automatique est coupée par défaut.

À l'arrivée, chaque e-mail est vérifié (SPF, DKIM, DMARC enregistrés), limité en taille (10 Mo par défaut,
`MAIL_MAX_BYTES`) et en débit (`MAIL_PER_IP_MINUTE`, `MAIL_PER_SENDER_HOUR`), noté contre le spam, et **mis de côté**
si l'expéditeur n'est pas autorisé, si DMARC échoue ou s'il ressemble à du spam (tu peux le libérer d'un clic). Ce que
le bot lit d'un e-mail est du contenu extérieur : il ne peut pas lui donner d'ordres, et toute réponse demande tes mots
ou ton accord. Les e-mails d'accès (codes, liens de réinitialisation) sont masqués.

**Alternative sans port 25** : connecter une boîte Gmail ou Outlook existante (Applis) et utiliser un alias « + »
(`toi+juno@gmail.com`) — Gmail et Outlook.com livrent ces alias dans la boîte principale, Microsoft 365 aussi quand
l'adressage « plus » est actif sur le locataire (vérifie dans le centre d'administration Exchange) ; une routine « nouvel e-mail » filtrée sur `to:toi+juno@…` fait le tri.
Moins cloisonné (le bot lit la même boîte que toi), mais aucun DNS ni port à ouvrir.

## Espaces d'équipe (plusieurs personnes, mêmes bots)

Réglages → **Espaces d'équipe** : crée un espace, invite des personnes par lien (usage unique, 7 jours, lié à leur
adresse ; il permet de créer un compte même quand les inscriptions sont fermées), donne un rôle à chacune
(propriétaire, admin, membre, lecteur), puis partage un bot depuis ses réglages → **Partage** (tout l'espace ou une
liste, et qui répond aux demandes d'accord : toi seul, ou toi et les admins). Le bot garde tes applis, ton coffre et
ton budget ; les autres ne voient jamais ses réglages, fichiers ou secrets, et leurs messages n'autorisent jamais une
action en ton nom. La console d'admin montre les membres, les places (`SKLUBOT_WORKSPACE_SEATS`,
`SKLUBOT_WORKSPACE_MAX_SEATS`), la consommation par membre, le journal, l'export et l'effacement des données d'un
membre. L'usage personnel ne change pas. La connexion unique (SSO) n'est pas proposée.

## Désinstaller complètement

```bash
sudo bash /opt/sklubot/deploy/uninstall.sh --dry-run   # montre ce qui serait supprimé, sans rien toucher
sudo bash /opt/sklubot/deploy/uninstall.sh             # propose une sauvegarde, puis demande « OUI »
```

Le script commence par **proposer une sauvegarde** (base, bibliothèques des bots, dossiers de leurs ordinateurs,
plus une copie de `.env`) dans ton dossier personnel, hors du dossier qui va être effacé. Il demande ensuite de
taper **OUI**, puis retire, dans cet ordre :

1. les ordinateurs des bots (arrêtés d'abord : les outils Claude Code / Codex qui y tournent s'arrêtent avec eux) ;
2. les conteneurs de l'application : Sklubot, le proxy Docker filtrant, Caddy ;
3. les volumes : données, dossiers des ordinateurs des bots (profils de navigateur, connexions), certificats Caddy ;
4. les réseaux `sklubot_net`, `sklubot_docker` et `sklubot_voice` ;
5. les images construites ou téléchargées pour Sklubot (une image utilisée par un autre conteneur est gardée) ;
6. le dossier `/opt/sklubot` (code et `.env`).

À la fin, il affiche ce qui a été retiré et ce qui reste. Rien ne tourne plus. Docker lui-même, les règles du
pare-feu et tes autres conteneurs ne sont pas touchés. Le script peut être relancé sans risque.
Options : `--no-backup`, `--keep-images` ; sans terminal : `SKLUBOT_CONFIRM=OUI` et `SKLUBOT_BACKUP=1` ou `0`.

## Connecter Google / Microsoft / Slack

Gmail, Google Agenda, Google Drive, Outlook et Slack sont intégrés : tes données vont directement du fournisseur à ton
serveur, avec un « client OAuth » que tu crées une fois dans ton propre compte.

1. Dans Sklubot : **Connecter des applis** → choisis l'app (par ex. Gmail) → **Ajouter**.
2. Suis les étapes affichées (elles reprennent les guides officiels de Google, Microsoft ou Slack). Copie l'**adresse de
   retour** affichée et colle-la telle quelle dans la console du fournisseur :
   `https://<ton-domaine>/api/native/google/callback`, `…/microsoft/callback` ou `…/slack/callback`.
   Elle doit correspondre exactement à `PUBLIC_URL` (https, sans barre finale). Slack exige https.
3. Colle l'identifiant et le secret du client, puis **Enregistrer le client**.
4. Donne un libellé au compte (« perso », « pro »…) et clique **Se connecter avec …**. Recommence avec un autre libellé
   pour connecter un deuxième compte de la même app.
5. Slack : invite l'app dans les canaux qu'elle doit lire (`/invite @ton-app`). Pour des déclencheurs instantanés sans
   ouvrir de port, ajoute le jeton d'app `xapp-…` (Socket Mode, autorisation `connections:write`).

Ensuite, dans les réglages d'un bot → **Routines** → **Nouveau déclencheur depuis une app** : nouvel e-mail, nouveau
message Slack ou événement à venir. Si un compte affiche « Connexion requise », clique **Se reconnecter**. Google :
tant que l'app est en mode Test, seuls les « Test users » ajoutés peuvent se connecter.

## Mémoire : fichier d'échange et earlyoom (automatique)

Pendant l'installation (et à chaque relance du script), `deploy/memory-guard.sh` protège un petit serveur contre le
manque de mémoire. Il peut être relancé sans risque : il ne refait que ce qui manque et ne supprime jamais rien.

- **Fichier d'échange** (`/swapfile`), seulement s'il n'y a encore aucun swap : taille = la mémoire du serveur arrondie
  au Go supérieur, **au moins 2 Go, au plus 4 Go** (1 Go → 2 Go, 3 Go → 3 Go, 6 Go → 4 Go). Pas de fichier à partir de
  8 Go de mémoire, ni si le disque n'aurait plus 5 Go libres (la taille est réduite, et rien sous 1 Go), ni sur un
  disque Btrfs, ni si l'hébergeur l'interdit (certains VPS « conteneurs »). Il est ajouté à `/etc/fstab` et
  `vm.swappiness` passe à 10 (`/etc/sysctl.d/90-sklubot-swap.conf`) : le swap reste un filet de sécurité.
- **earlyoom** (paquet Debian / Ubuntu) : quand la mémoire disponible passe sous 6 % **et** le swap libre sous 20 %, il
  arrête un programme avant que le serveur ne gèle — d'abord les navigateurs des bots (Chromium, Chrome), jamais en
  priorité Sklubot (`node`), Caddy, SSH ni Docker. Réglage : `/etc/default/earlyoom` (si tu l'as modifié toi-même, il
  est conservé). Journal : `journalctl -u earlyoom`.
- Pour sauter cette étape : `SKLUBOT_SKIP_MEMORY_GUARD=1`. Pour la lancer seule : `sudo bash /opt/sklubot/deploy/memory-guard.sh`.

## Si ça coince

| Symptôme | Que faire |
|---|---|
| « Connection refused » ou rien à la connexion | Vérifie l'adresse IP et que le VPS est démarré chez l'hébergeur. |
| « Permission denied » | Mauvais mot de passe ; certains hébergeurs imposent un autre utilisateur que `root` (`ubuntu`, `debian`). |
| « Le code d'installation est manquant ou faux » | Recopie le code affiché à la fin de l'installation, ou lis-le avec `grep SETUP_CODE /opt/sklubot/.env`. |
| La page ne s'ouvre pas en https | Le domaine ne pointe pas encore vers le VPS (étape 1), ou les ports 80 et 443 sont fermés dans le pare-feu de l'hébergeur. |
| « Sklubot ne répond pas » en fin d'installation | Le journal s'affiche juste au-dessus : la cause y est. Le plus souvent, pas assez de mémoire (voir la section Mémoire ci-dessus ; `free -h` montre le swap). |
| Les bots ne répondent pas | Pas de clé de modèle : ajoute `ANTHROPIC_API_KEY` dans `.env` et mets `SKLUBOT_DEMO_MODE=0`. |

## Sécurité

- Sklubot crée les ordinateurs des bots avec le Docker du VPS : **réserve ce VPS à Sklubot**.
- Après l'installation, pense à remplacer la connexion par mot de passe par une clé SSH (ton hébergeur a un guide).
- Le fichier `/opt/sklubot/.env` contient tes clés : il n'est lisible que par l'administrateur. Ne le partage pas.
- Pare-feu des ordinateurs des bots : l'installation propose de couper leur accès à l'hôte, au service de métadonnées
  du fournisseur et aux réseaux privés (`deploy/bots-firewall.sh`, réversible avec `sudo bash deploy/bots-firewall.sh off`).
- `ALLOWED_EMAILS` n'est **pas** une authentification : l'adresse n'est pas vérifiée. Garde les inscriptions fermées
  et invite les gens.

### Renforcements facultatifs (rien n'est imposé)

- **Navigateur des bots** : Chromium tourne en root avec `--no-sandbox` dans l'ordinateur du bot. Son bac à sable
  a besoin soit d'un programme setuid (neutralisé par `no-new-privileges`, que l'on garde), soit d'espaces de noms
  utilisateur, que le profil seccomp par défaut de Docker interdit (essai : « No usable sandbox! » en utilisateur
  normal). L'activer demanderait d'assouplir seccomp pour tous les ordinateurs : on ne le fait pas. La frontière reste
  le conteneur (aucune capacité dangereuse, réseau à part, pas de privilège possible).
- **gVisor** (noyau isolé par conteneur) : installe `runsc` sur l'hôte (gvisor.dev/docs/user_guide/install/, il
  s'enregistre comme runtime Docker), puis dans `.env` : `SKLUBOT_DESKTOP_RUNTIME=runsc`. Les ordinateurs sont refaits
  à leur prochain usage. Vérifie ensuite le bureau et le navigateur avec le test d'ordinateur.
- **userns-remap** (root des conteneurs = utilisateur sans droit sur l'hôte) : option `"userns-remap": "default"`
  de `/etc/docker/daemon.json` (docs.docker.com/engine/security/userns-remap/). Elle s'applique à **tous** les
  conteneurs et change le propriétaire attendu des volumes : à faire sur une installation neuve, ou après avoir
  sauvegardé (`bash deploy/backup.sh`) et en sachant remettre les droits des volumes.
- **Disque** : `SKLUBOT_DESKTOP_DISK_QUOTA=20G` limite le disque propre de chaque ordinateur, là où Docker le sait
  (overlay2 sur un système de fichiers xfs monté avec `pquota`, btrfs, zfs ; ailleurs le réglage est ignoré, le journal
  le dit). Indépendamment, quand il reste moins de `SKLUBOT_DISK_FREE_MIN_MB` (2048 par défaut) sur le disque des
  données, Sklubot met en veille l'ordinateur inactif qui a le plus écrit et le dit dans le fil du bot.

## Utiliser tes abonnements Claude et ChatGPT (sans clé d'API)

1. Ouvre les réglages d'un bot → **Cerveau** → choisis « Claude — Sonnet (mon abonnement) » ou « ChatGPT (mon abonnement) ».
2. Clique **Se connecter sur l'ordinateur de …** : un terminal et la page de connexion s'ouvrent sur l'écran du bot, et la vue en direct s'ouvre en mode « prise de main ».
3. Connecte-toi avec ton compte Claude ou ChatGPT, puis **rends la main**. C'est fait : ce bot travaille désormais sur ton abonnement.

À savoir :
- La connexion est faite **par bot** (chaque bot a son propre ordinateur). Refais l'étape 2 pour chaque bot que tu veux brancher.
- Ce sont les outils officiels (Claude Code d'Anthropic, Codex d'OpenAI) avec ton compte : les limites de ton forfait s'appliquent, et c'est prévu pour **ton usage personnel** — ne fais pas travailler les bots de quelqu'un d'autre sur ton abonnement.
- Après une mise à jour, efface une fois l'ordinateur des bots existants (Réglages → Ordinateur → Effacer) pour qu'ils reçoivent la nouvelle image avec Claude Code et Codex.
- **Un bot coincé ?** Réglages du bot → Cerveau → **Redémarrer le moteur** : ce qu'il faisait s'arrête, ses demandes
  d'accord en attente expirent, et son moteur repart. La conversation est gardée.
- **Pourquoi mes bots n'apparaissent pas dans l'appli Claude ou ChatGPT ?** C'est voulu : chaque bot a son propre
  ordinateur et lance l'outil officiel (Claude Code ou Codex) pour chaque tour, avec ses propres routines et sa
  propre messagerie entre bots, gérées par Sklubot. Nous n'utilisons pas le mode « plusieurs bots » intégré à ces
  outils : les bots créés dans Sklubot ne s'affichent donc pas dans leurs applications de bureau, et inversement.

## Lecture du web et des réseaux (Agent Reach) — vague 7

Chaque ordinateur de bot contient **Agent Reach** (licence MIT, <https://github.com/Panniantong/Agent-Reach>, version **1.6.1**
épinglée) : un outil en ligne de commande qui **lit** le web, Reddit, X, Instagram, Facebook, YouTube, GitHub… et ne sait
rien publier. L'image `sklubot-desktop` l'installe avec `uv` depuis la **release GitHub** v1.6.1 (empreinte SHA-256
vérifiée), jamais depuis PyPI (un autre projet y porte le même nom), puis lance son `setup` par défaut.

- **Services joints par Agent Reach** (depuis l'ordinateur du bot, pas depuis le serveur) : `r.jina.ai` pour lire une
  page, **Exa** (`mcp.exa.ai`) pour la recherche web, et les sites eux-mêmes (reddit.com, x.com, youtube.com…). Si ton
  VPS filtre les sorties, autorise ces hôtes. Aucune clé n'est nécessaire pour ces deux services.
- **Connexions de lecture** : réglages du bot → **Lecture et clés** → « Se connecter » à côté de Reddit, X, Instagram ou
  Facebook. Une fenêtre s'ouvre sur l'écran du bot ; tu te connectes **toi-même** (utilise de préférence un compte
  secondaire). Le bot ne voit jamais ton mot de passe ; « Se déconnecter » efface la connexion.
- **YouTube** bloque souvent les adresses de centres de données (« Sign in to confirm you're not a bot ») : le bot le dit
  clairement et, si ton ordinateur est relié avec Sklubot Relais, propose de passer par lui.
- Après la mise à jour, **reconstruis l'image** (`docker compose -f docker-compose.vps.yml build desktop-image`, ou
  `npm run computer:build`) puis **efface une fois l'ordinateur des bots existants** (Réglages → Ordinateur → Effacer)
  pour qu'ils reçoivent Agent Reach et l'aide `sklubot-api`.
- On peut couper la famille d'outils « Lecture (Agent Reach) » bot par bot (réglages du bot → Outils).

## Relais d'identifiants pour les programmes des bots — vague 7

Un script lancé par un bot sur son ordinateur peut appeler une API avec une clé de ton coffre **sans que la clé entre
dans l'ordinateur** : il passe par Sklubot, qui ajoute la clé de son côté, seulement pour les hôtes liés à ce secret.

- À activer **bot par bot** : réglages du bot → **Lecture et clés** → « Les programmes peuvent utiliser mes clés »
  (désactivé par défaut). La première utilisation de chaque clé te demande ton accord ; après du contenu extérieur,
  chaque modification (POST, PUT, PATCH, DELETE) le redemande.
- Dans l'ordinateur : `sklubot-api "Nom du secret" GET https://api.exemple.com/v1/...` ; dans du code :
  `$SKLUBOT_RELAY_URL/<secret>/<hôte>/<chemin>` avec l'en-tête `X-Sklubot-Relay-Token: $SKLUBOT_RELAY_TOKEN`
  (fichier `~/.sklubot/relay.env`).
- Le relais (`/egress/…`) n'est joignable **que depuis le réseau interne** des ordinateurs des bots : le `Caddyfile`
  fourni répond 404 pour `/egress/` comme pour `/mcp/`, et Sklubot refuse toute requête passée par un proxy. Avec un
  autre reverse proxy (Coolify/Traefik…), garde ce blocage.

## Santé des clés, import d'un projet, liens temporaires — vague 7

- **Réglages → Clés et connexions** : l'état de chaque clé et connexion (fonctionne, clé refusée, à reconnecter,
  incertain, jamais vérifié). Vérification gratuite en lecture seule à l'enregistrement et une fois par jour
  (`HEALTH_EVERY_MIN`, 1440 par défaut). Quand une clé casse : une notification, une ligne dans la discussion du bot
  principal, et les routines qui en dépendent se mettent en pause.
- **Importer un projet** (même page) : dépose un `.env` et/ou un zip de compétences ; tu vois les noms et les hôtes
  devinés, jamais les valeurs, puis tu confirmes.
- **Liens temporaires** (Réglages → Pages) : quand un service vidéo demande l'adresse publique d'une image de
  référence, le bot peut publier un fichier de sa bibliothèque pour 1 h (24 h au plus) à l'adresse `/l/…`, révocable.
  Cette adresse doit rester publique (ne la bloque pas dans le proxy).
- **Outils payants** : prix d'une vidéo à annoncer avant l'appel avec `VIDEO_PRICE_USD` (facultatif ; sinon « prix
  inconnu » est annoncé) ; plafond quotidien par bot dans ses réglages (Lecture et clés → Outils payants).
