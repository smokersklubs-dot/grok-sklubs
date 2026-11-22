# Sklubot

![L’équipe Sklubot](docs/characters/team_16x9.jpg)

Une équipe de bots IA auto-hébergée. Chaque bot a un nom, un rôle, sa mémoire, ses compétences, son
**propre ordinateur Linux**, ses fichiers, ses routines — et ils travaillent ensemble. Tout tourne sur ta machine,
avec tes clés ; les données restent dans un fichier SQLite local.

Sklubot a été reconstruit **en salle blanche** : voir [docs/CLEANROOM.md](docs/CLEANROOM.md).

![Discussion avec cartes de question, étapes et routines](docs/screenshots/chat.png)

## Ce que ça fait

| Domaine | Fonctions |
|---|---|
| **Bots** | Nom, rôle, description, consignes permanentes, avatar (12 formes × 11 couleurs), mode assistant personnel ou coéquipier, bot principal, niveau de réflexion, **modèle au choix par bot**, niveau d'autonomie |
| **Tes abonnements** | Un bot peut travailler sur **ton abonnement Claude (Pro/Max) ou ChatGPT (Plus/Pro)** au lieu d'une clé d'API : Claude Code et Codex, les outils officiels d'Anthropic et d'OpenAI, tournent dans l'ordinateur du bot ; tu t'y connectes une fois **sur l'écran du bot** (réglages du bot → Cerveau → Se connecter). Les outils de Sklubot leur sont branchés (mémoire, routines, applications, coffre, équipe, écran) et les approbations restent en place. Suivi des fenêtres d'utilisation de 5 h et 7 jours |
| **Discussion** | Réponses en direct, résumé « a travaillé 2 min · 7 étapes » dépliable, ligne de réflexion en direct, étapes d'outils repliables, sources web, cartes d'approbation / de question / de connexion, envoi pendant que le bot travaille (le message rejoint le tour en cours), arrêt, nouvelle conversation |
| **Ordinateur** | **Un ordinateur Linux par bot, gratuit, sur ton serveur** (aucun service payant type Orgo) : **écran en direct** (flux VNC dans le navigateur, observation en lecture seule ou prise de main, puis « rendre la main »), **bureau habillé aux couleurs du bot** (fond d'écran, dock Navigateur/Terminal/Fichiers, page d'accueil avec horloge, nom, rôle et recherche), bouton **« ranger l'écran »** (ferme les fenêtres, garde les connexions), navigateur réparé automatiquement s'il ne répond plus ; conteneur isolé : bureau graphique, navigateur Chromium, terminal, gestionnaire de fichiers, shell root, installation de logiciels ; tout est conservé entre les conversations ; **mise en veille automatique et réveil à la demande** ; capture, clic, saisie, touches, défilement, glisser ; bibliothèque de fichiers téléchargeables ; **vue en direct et prise de contrôle** depuis l'interface |
| **Applications** | **Catalogue d'applications à ajouter en une étape** (GitHub, Stripe, Hugging Face, documentation technique…), dont les **données de l'activité** pour la chasse aux pépites : HubSpot, Klaviyo, Intercom, Amplitude, Mixpanel, Semrush, Ahrefs, Supermetrics, Windsor.ai (GA4, Search Console, publicités…), Notion. **Connexion OAuth** dans une fenêtre du fournisseur (« Se connecter »), renouvelée automatiquement. Et tout serveur d'outils au standard ouvert MCP (URL + jeton, ou connexion OAuth détectée toute seule). Lectures automatiques, écritures soumises à approbation, « toujours autoriser » mémorisé et révocable |
| **Coffre** | Identifiants enregistrés et chiffrés ; le bot les saisit sur son ordinateur **sans jamais voir le mot de passe**, après ton accord ; tout ce qui revient vers le modèle est nettoyé |
| **Fichiers et images** | Pièces jointes dans la discussion (le bot voit les images, les autres fichiers arrivent sur son ordinateur), envoi de fichiers par le bot, **génération d'images** |
| **Canaux** | **Telegram** par bot : écris à ton bot depuis ton téléphone, il te répond et te prévient quand il a besoin de toi |
| **Recherche** | Dans tous les messages, y compris les conversations d'avant une remise à zéro ; recherche web pour tous les modèles (Claude nativement, les autres via Brave ou SearXNG) |
| **Surveillance** | Routines déclenchées seulement quand une page web ou un fichier change (gratuit tant que rien ne bouge) ; historique des exécutions ; rattrapage des routines manquées |
| **Pages** | Les bots publient rapports et tableaux de bord à une adresse publique, révocable |
| **Fiabilité** | Reprise du travail après un redémarrage du serveur ; modèle de secours en cas de panne ; journal d'activité non modifiable |
| **Prudence** | Le contenu venu de l'extérieur (pages, recherches, applications) est signalé au modèle comme simple information ; après en avoir lu, même un bot « de confiance » redemande avant de modifier une application |
| **Équipe** | Export et import d'une équipe de bots ; choix des familles d'outils par bot ; règles de réponse dans les groupes |
| **Compte** | Lien de connexion à usage unique (`node server/dist/sign-in-link.js email`), liste d'adresses autorisées (`ALLOWED_EMAILS` — un filtre, pas une authentification : l'adresse n'est pas vérifiée, voir `.env.example`), changement de mot de passe, export de toutes tes données, suppression du compte |
| **Langue** | Interface, textes du serveur et réponses des bots en **français ou en anglais** |
| **Téléphone** | Version mobile installable sur l'écran d'accueil (iPhone, iPad) et **application Android (APK)** à télécharger depuis ton serveur |
| **Ordinateur (application)** | **Application Sklubot pour Windows, macOS et Linux** : ton Sklubot dans sa propre fenêtre, notifications, icône dans la barre avec les non-lus, et le **Relais intégré** pour que tes bots pilotent ton ordinateur avec ton accord — voir [companion/LISEZMOI.md](companion/LISEZMOI.md) |
| **Artefacts web** | Créer un prototype privé dans le chat, le modifier, consulter ses versions et télécharger ses fichiers. [Guide des artefacts](docs/ARTEFACTS.md) |
| **Méthodes de travail** | Claude Code, Codex et Grok disposent de 60 procédures françaises consultables par titre avec `guide_read` et d’un index de 169 ressources OpenDesign. [Manuel portable](server/templates/methodes/manuel.md) · [Répertoire OpenDesign](server/templates/methodes/opendesign.md) |
| **Mise en ligne** | **Installation sur un VPS en une commande** (Docker, HTTPS automatique, mises à jour, sauvegarde) — voir [docs/INSTALLATION-VPS.md](docs/INSTALLATION-VPS.md) ; ou Coolify — voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) |
| **Mémoire** | Souvenirs enregistrés par le bot, **apprentissage automatique** après les conversations (avec dédoublonnage), sélection des souvenirs pertinents à chaque tour, **recherche classée et rappel automatique par mots-clés** (sans modèle, [docs/MEMOIRE.md](docs/MEMOIRE.md)), **résumé automatique** des longues conversations |
| **Compétences** | Procédures rédigées par toi, injectées dans le bot |
| **Automatisation** | Routines créées en discutant : planifiées (cron + fuseau), ponctuelles, ou **déclenchées par webhook** ; points réguliers proactifs du bot principal |
| **Équipe** | Messages entre bots, assistants temporaires en parallèle (4 max, compte rendu automatique), discussions de groupe avec @mentions |
| **Tâches** | Suivi du travail en cours, en attente de toi, terminé |
| **Voix** | Appel vocal et dictée sur tous les navigateurs (iPhone compris) : reconnaissance et synthèse vocales du serveur (whisper.cpp + Piper, auto-hébergés et actifs par défaut), sinon celles du navigateur ; **chaque bot a sa propre voix, automatiquement et gratuitement** (Kokoro + Piper, [docs/VOIX.md](docs/VOIX.md)), ou une voix Fish Audio en un clic ; vitesse / langue par bot |
| **Maîtrise** | Compteur de jetons et de coût par bot, **budget mensuel** qui met les bots en pause, **plafonds d'usage** par jour ou par mois (dollars ou tokens, compte ou bot, travail sans surveillance ou tout — voir `docs/PLAFONDS.md`), garde-fou contre les boucles, limite d'étapes |

## Télécharger les applications

Sur ton serveur, la page **`/telecharger`** (lien en bas de la page de connexion) propose tout, en mettant en avant le
bon fichier pour l'appareil du visiteur :

| Appareil | Quoi | Où |
|---|---|---|
| Windows 10/11 | Application Sklubot (installateur `.exe` ou `.zip` sans installation), Relais intégré | `/telecharger`, ou les [versions GitHub](https://github.com/smokersklubs-dot/grok-sklubs/releases) (`desktop-v…`) |
| macOS 11+ (Intel et Apple Silicon) | Application Sklubot (`.dmg`), Relais intégré | idem |
| Linux | Application Sklubot (`.deb` ou `.AppImage`), Relais intégré | idem |
| Android | Application Sklubot (`.apk`) | `/download/sklubot.apk` |
| iPhone, iPad | Pas d'application native : Safari › Partager › « Sur l'écran d'accueil » | — |

Applications non signées pour l'instant : premier lancement sous Windows (SmartScreen) et macOS (Gatekeeper) expliqué
dans [companion/LISEZMOI.md](companion/LISEZMOI.md). Publier une version : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Démarrage

Il te faut **Node.js 22.13 ou plus récent**.

```bash
npm install
cp .env.example .env        # puis remplis SESSION_SECRET et ANTHROPIC_API_KEY
npm run build
npm start                   # http://localhost:8787
```

**Essayer sans clé ni coût** : mets `DEMO_MODE=1` dans `.env` (sans clé de modèle). Un faux modèle qui suit
des mots-clés permet de parcourir toute l'application : outils, approbations, cartes, routines, navigateur.

**Sans aucune clé** : choisis « Mes abonnements » dans le Cerveau d'un bot, puis connecte-toi sur son écran.

Le premier compte créé est le tien ; les inscriptions se ferment ensuite (sauf `OPEN_SIGNUP=1`). Sur un serveur
public, mets un code dans `SETUP_CODE` (l'installeur VPS le fait seul) : il sera demandé pour créer ce premier compte.

### L'ordinateur Linux de chaque bot

Il te faut **Docker** sur la machine qui héberge Sklubot. Construis l'image du bureau une fois (quelques minutes) :

```bash
npm run computer:build
```

Au démarrage, Sklubot affiche `Computers: a Linux desktop per bot`. Chaque bot reçoit alors son propre
conteneur à la première utilisation : Debian, bureau graphique 1280×800, Chromium, terminal, Python, Node.
Son dossier personnel est conservé (logiciels installés, connexions du navigateur, fichiers). Le dossier
`~/files` de l'ordinateur est la bibliothèque visible dans l'interface. Un ordinateur inactif depuis 20 minutes
s'endort ; il se réveille tout seul. Quatre ordinateurs peuvent être éveillés en même temps (`MAX_DESKTOPS`),
avec 2 Go de mémoire et 2 processeurs chacun (`DESKTOP_MEMORY`, `DESKTOP_CPUS`). Pour en réveiller un autre, Sklubot
endort le moins récent des ordinateurs **inactifs** ; un ordinateur occupé (une commande, un tour Claude Code ou Codex)
n'est jamais endormi : s'ils le sont tous, il attend qu'un se libère (`COMPUTER_WAIT_SEC`, 90 s), puis le dit clairement.
Un tour Claude Code ou Codex dure au plus `ENGINE_TURN_TIMEOUT_MINUTES` (60 min, 0 = sans limite) : au-delà il est
arrêté, ce qui a été fait est gardé et un bouton « Continuer » le reprend. Un tour (abonnement ou modèle API) dont l'IA
ne dit encore rien au bout de `FIRST_REPLY_RESCUE_SEC` (20 s) reçoit une ligne « … ne répond pas encore » (Attendre,
Changer d'IA pour ce message, Vérifier la connexion) ; sans aucun progrès pendant `STALL_NOTICE_MIN` (5 min), une ligne
« … semble bloqué » (Continuer d'attendre, Arrêter et reprendre). Une approbation, une question, une pause ou un outil
en cours ne comptent jamais comme un silence ; un outil Claude Code / Codex dont le processus a disparu de l'ordinateur
arrête le tour aussitôt, avec « Continuer ». Un appel à un modèle par API qui ne répond pas (rien en
`MODEL_CONNECT_TIMEOUT_SEC`, 180 s) ou qui se tait en cours de réponse (`MODEL_IDLE_TIMEOUT_SEC`, 180 s) est coupé et
relancé tout seul, puis passe au modèle de secours ; s'il échoue encore, une carte dit quoi faire. Une demande d'accord
n'expire plus : la carte attend ta réponse, même après un redémarrage, et un message tapé entre-temps est gardé pour
après. La liste des modèles Codex proposés est lue
dans Codex lui-même (`codex debug models`, gardée 10 min) ; `CODEX_MODELS` sert de secours.

Sur la page du navigateur, un bot peut agir par **références d'éléments** plutôt que par pixels : `element_snapshot` liste
liens, boutons, champs et listes (via le protocole DevTools de Chromium), puis `element_click` / `element_type` /
`element_select` agissent sur l'un d'eux ; une référence d'une page qui a changé est refusée. Un bot peut **demander à un
autre et attendre** sa réponse dans le même tour (`bot_message` avec `wait`, `BOT_WAIT_DEFAULT_SECONDS` / `BOT_WAIT_MAX_SECONDS`) ;
au-delà, la réponse arrive en message. Le **dossier d'équipe** (bibliothèque → « Dossier d'équipe », désactivé par défaut)
partage `~/team` entre les ordinateurs des bots d'un même compte, jamais avec un autre compte ; chaque ordinateur le
reçoit à son prochain démarrage. Quand le disque d'un ordinateur dépasse `DISK_ALERT_PERCENT` (90 %), une carte liste les
plus gros fichiers et ne supprime que ce que tu coches et confirmes.

**Commandes longues en arrière-plan.** Une commande (`shell_run`) encore en cours à sa limite de temps (290 s au plus)
n'est plus tuée : elle continue en **commande en arrière-plan** sur l'ordinateur du bot (sortie dans
`~/.sklubot/jobs/<id>.log`), et `shell_run` avec `background: true` en lance une tout de suite. Le bot la suit avec
`job_output` (qui peut attendre sa fin), l'arrête avec `job_stop`, et reçoit **un seul** message quand elle se termine —
jamais pendant qu'il attend ton accord ou un point de contrôle des dépenses (il arrive ensuite). Elles apparaissent dans
le panneau Ordinateur, avec un bouton Arrêter. L'ordinateur n'est jamais endormi pendant qu'une commande tourne ; au plus
`JOBS_PER_BOT` (4) à la fois, et chacune est arrêtée après `JOB_MAX_HOURS` (6 h). Effacer ou endormir l'ordinateur les
arrête. Les bots sur abonnement (Claude Code, Codex) gardent leurs propres moyens de lancer des commandes longues :
Sklubot ne les change pas. Une sortie longue (plus de `SPILL_CHARS`, 20 000 caractères) de `shell_run`, `web_fetch` ou
`page_read` est gardée en entier dans `~/.sklubot/outputs/` ; le modèle en reçoit le début, la fin et le chemin.

**Documents bureautiques.** L'image du bureau contient LibreOffice (sans interface) : `office_convert` (pdf, docx, xlsx,
pptx, odt, ods, odp, csv, html, txt, rtf), `office_recalculate` (recalcule toutes les formules d'un tableur) et
`office_render` (une page, une diapositive ou une feuille en image que le bot voit). L'original n'est jamais modifié :
le résultat va dans un nouveau fichier. **Après la mise à jour, reconstruis l'image du bureau** (`npm run computer:build`,
ou le redéploiement qui la reconstruit) puis efface une fois l'ordinateur des bots qui en ont déjà un (Réglages →
Ordinateur → Effacer) : un ordinateur existant garde l'ancienne image.

**Mode objectif.** « Mode objectif » dans le menu + du champ de saisie, ou `/objectif …` au début d'un message (aussi au
début du texte d'une routine) : le bot travaille **tour après tour sans que tu appuies sur Continuer**, jusqu'à marquer
l'objectif atteint (avec preuves), bloqué (avec la raison), ou la limite de tours (`GOAL_MAX_ROUNDS`, 20 ; au plus
`GOAL_ROUNDS_LIMIT`, 100). Une carte suit les tours ; Pause, Reprendre, Arrêter. Un bot peut aussi proposer un objectif
(tu acceptes ou non). Les approbations restent en place : tant qu'une carte attend ton accord, une question ou un point de
contrôle des dépenses, aucun nouveau tour ne part. Marche avec les modèles par API et avec Claude Code / Codex (chaque
tour reprend la session).

**Longs tours (modèles par API).** Avant chaque étape, si la demande dépasse `COMPACT_RATIO` (80 %) de la fenêtre de
contexte du modèle (`CONTEXT_WINDOW_TOKENS`, 200 000 par défaut ; celle d'un fournisseur ajouté dans Réglages → Modèles
sinon), le début du tour est résumé et la fin gardée telle quelle ; un « trop long » renvoyé par le fournisseur déclenche
un résumé puis un nouvel essai avant de passer au modèle de secours. Les anciens résultats d'outils très longs sont
raccourcis à l'envoi, seules les 8 dernières captures d'écran d'un tour sont renvoyées (`KEEP_SCREENSHOTS`), et les
lectures sans effet (pages, recherches, mémoire…) d'une même étape partent en parallèle (`PARALLEL_TOOLS`, 4).

Sans Docker, Sklubot se rabat sur un simple navigateur par bot (`npm i playwright && npx playwright install chromium`),
et sinon sur la lecture de pages, la ligne de commande et les connecteurs.

### Développement

```bash
npm run dev -w server       # API sur le port 8787
npm run dev -w web          # interface sur http://localhost:5173
npm test                    # tests de bout en bout (modèle simulé, navigateur réel, connecteur réel)
npm run typecheck
npm run check:contrast -w web   # contraste des couleurs (clair et sombre)
npm run check:size          # les gros fichiers ne grossissent plus (check:size:update après un découpage)
```

Règles d'interface (principes, jetons, composants, écriture, accessibilité) : [docs/DESIGN.md](docs/DESIGN.md). Galerie des états, en développement seulement : `http://localhost:5173/?dev=gallery`.

### Mot de passe oublié

Avec les e-mails du serveur réglés (Réglages → Compte → E-mails du serveur, ou variables `SMTP_HOST`, `SMTP_PORT`,
`SMTP_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`), chacun — propriétaire compris — utilise « Mot de passe oublié ? »
sur la page de connexion : un lien valable 30 minutes, à usage unique, qui déconnecte tous les appareils. Le même
réglage sert à confirmer un changement d'adresse e-mail (Réglages → Compte).

Sans e-mails du serveur, ou si le propriétaire a perdu l'accès à sa boîte, il reste la commande sur le serveur
(avec Coolify : service `sklubot` → *Terminal*, puis `node server/dist/reset-password.js ton@email.fr`). Il n'y a
volontairement aucune autre porte de secours. Sur un VPS avec Docker Compose :

```bash
docker compose -f docker-compose.vps.yml exec sklubot node server/dist/reset-password.js ton@email.fr
```

### Génération d'images

Elle s'active dès qu'une clé `OPENAI_API_KEY` ou `XAI_API_KEY` est présente, ou avec `IMAGE_API_KEY` /
`IMAGE_BASE_URL` / `IMAGE_MODEL` pour tout service compatible. Les noms de modèles par défaut
(`gpt-image-1`, `grok-2-image`) n'ont pas pu être essayés ici : ajuste `IMAGE_MODEL` si ton fournisseur en attend un autre.

## Sécurité — à lire

- **Avec les ordinateurs Linux**, les commandes d'un bot s'exécutent dans son conteneur, pas sur ton serveur :
  il n'y voit ni tes clés ni tes fichiers, et n'a donc pas besoin de demander avant chaque commande.
  Le conteneur a accès à Internet. Il tourne avec peu de privilèges (pas de nœuds de périphérique, de sockets
  bruts ni d'élévation par programme setuid). En local, sans `DESKTOP_NETWORK`, il **peut joindre les services
  réseau de la machine hôte** (dont Sklubot lui-même, via `host.docker.internal`) : n'héberge rien de sensible
  sans mot de passe sur cette machine.
- **Sans Docker**, la ligne de commande s'exécuterait sur la machine hôte : elle n'est proposée que si tu mets
  `SHELL_ENABLED=1`, et chaque commande demande alors ton accord, quel que soit le niveau d'autonomie du bot.
- **Bibliothèque des bots** : un bot (root dans son ordinateur) peut y créer des liens ; le serveur ne suit
  jamais un lien ni un fichier spécial de la bibliothèque, ni pour servir, ni pour lire, ni pour écrire.
- **Contenu extérieur** : dès qu'un bot a lu une page, une recherche ou une application (ou qu'un tour démarre
  d'un webhook, d'un message d'un bot qui en avait lu, d'un abonnement Claude/ChatGPT), il demande avant de
  publier une page, créer ou modifier une routine, enregistrer une compétence ou un souvenir, écrire à un autre
  bot ou dans un groupe, chercher dans les conversations de tous les bots, ou ouvrir un site qu'il n'a pas
  encore lu pendant ce tour.
- **Réseau privé** : les lectures de pages (`web_fetch`), les pages surveillées, les applications connectées
  et leurs connexions OAuth ne joignent jamais une adresse locale ou privée (127.0.0.1, 10.x, 192.168.x,
  169.254.169.254…), redirections comprises. Pour tester avec des serveurs locaux : `ALLOW_PRIVATE_FETCH=1`.
- Trois niveaux d'autonomie par bot : **prudent** (demande avant les commandes et les écritures dans les
  applications), **équilibré** (demande seulement avant les écritures dans les applications), **confiance**
  (ne demande jamais).
- **Répondre à une demande d'un bot** : « Autoriser » (cette fois), « Toujours autoriser » (une règle, visible dans
  Réglages → Autorisations) ou **« Autoriser pour cette conversation »**. Cette troisième réponse vaut pour ce bot,
  cette action au même endroit (la même application, le même site…) et cette conversation seulement. Elle
  s'arrête toute seule : quand tu effaces la conversation, après 12 h sans message de ta part, ou quand tu la
  retires (Réglages → Autorisations → « Pour une conversation »). Elle ne sert jamais à une routine, à un autre
  bot ni à un autre compte, et seul ton clic la crée : un bot ne peut ni la demander ni la prolonger. Un
  paiement, un achat, une suppression, un envoi ou une publication te sont **toujours** demandés, même avec elle ;
  après du contenu extérieur, elle ne vaut que pour le destinataire que tu avais sous les yeux. Chaque action
  faite grâce à elle est notée dans le journal (« pour cette conversation », avec son numéro).
- Les jetons des connecteurs sont chiffrés dans la base et ne sont jamais renvoyés au navigateur ni au modèle.
- Les mots de passe sont hachés (scrypt) ; seules les empreintes des sessions sont stockées.
- Mets `PUBLIC_URL` en `https://…` si tu exposes le serveur, et place-le derrière un proxy TLS.
  `PUBLIC_URL` doit être **l'adresse réelle** que ton navigateur utilise : les connexions OAuth aux applications
  reviennent sur `PUBLIC_URL/api/connectors/oauth/callback` (adresse à enregistrer chez les applis qui demandent un
  identifiant client, comme HubSpot ; elle est affichée dans Sklubot). Les accès OAuth sont chiffrés comme les jetons.

## Organisation

```text
server/src/llm/        fournisseurs de modèles (Claude, compatible OpenAI/xAI)
server/src/agent/      boucle d'agent, outils, mémoire, équipe, prompt
server/src/            base, routes HTTP, ordinateur, connecteurs, planificateur, usage
docker/desktop/        image de l'ordinateur Linux des bots
android/               application Android
companion/             application Sklubot pour ordinateur (Electron) avec le Relais intégré
Dockerfile.production, docker-compose.coolify.yml   mise en ligne
server/test/           tests de bout en bout
web/src/               interface React (web/src/dev/ : galerie des états, jamais livrée)
docs/API.md            référence de l'API
docs/DESIGN.md         règles d'interface
docs/cleanroom/        cahiers des charges fonctionnels issus de l'étude
```

## Limites connues

- Le fournisseur Claude est écrit d'après la documentation officielle du SDK et compile, mais **n'a pas pu être
  essayé avec une vraie clé** dans l'environnement de construction ; les tests utilisent un modèle simulé.
- Voir aussi la section « Écarts » de [docs/CLEANROOM.md](docs/CLEANROOM.md).

## Licence

MIT.
