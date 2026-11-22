# L'ordinateur de chaque bot

Chaque bot a **son propre ordinateur Linux** : un bureau graphique avec un navigateur (Chromium), un terminal, un
gestionnaire de fichiers et un éditeur, dans un conteneur à lui (`docker/desktop/Dockerfile`). Tu le regardes en direct
dans le panneau de détails (Ordinateur), et tu peux **prendre la main** à tout moment.

Ce document dit ce qu'il sait faire, comment lui ouvrir tes comptes sans lui donner tes mots de passe, et ce qui reste
protégé.

## Ce qu'il sait faire

| Besoin | Comment le bot s'y prend |
|---|---|
| Aller sur un site, cliquer, remplir | `browser_open`, puis les références d'éléments (`element_snapshot`, `element_click`, `element_type`) ou les clics à l'écran (`screen_click`…). |
| **Naviguer en mots** (moins cher) | Ouvrir une page ou cliquer renvoie **en texte** les titres de la page, ses boutons et champs (chacun avec une référence courte, l'adresse des liens, un indice pour un bouton sans nom : icône, ligne du tableau) et **ce qui a changé** (nouveau bouton, nouveau texte, adresse). Pas de capture, sauf si le bot la demande (`screenshot`) ou si la page n'a presque pas de texte (jeu, vidéo). Une référence reste la même tant que la page ne change pas. |
| **Remplir un formulaire d'un coup** | `element_fill` remplit plusieurs champs en un appel (texte, liste, cases) et **relit chaque champ** : « vérifiée », ou « NON vérifiée » si la page a coupé ou changé la saisie. Il ne clique jamais sur « Envoyer » ; une case dont les mots engagent (payer, s'abonner…) passe par `element_click`, qui te demande. |
| Attendre, survoler, joindre un fichier | `browser_wait` attend un texte, sa disparition, une adresse ou la fin du chargement (30 s au plus) au lieu de regarder sans cesse. `element_hover` survole un menu. `element_upload` met un fichier de sa bibliothèque dans un champ « fichier » : **ton accord est demandé à chaque fois**. Après chaque action, le bot attend que la page se calme. |
| « Envoyé mais pas confirmé » | Si la page ne confirme pas un clic ou une saisie, le bot le sait et **ne recommence pas à l'aveugle** : il regarde d'abord. Quand rien n'a été fait (bouton caché, page changée), il sait qu'il peut réessayer. |
| **Console et requêtes de la page** | `browser_console` (erreurs JavaScript de l'onglet, ses 3 dernières pages) et `browser_network` (requêtes, état, taille ; le détail d'une requête avec ses en-têtes). Lecture seule ; les valeurs qui peuvent contenir un secret (cookies, autorisation, jetons, clés) sont **masquées**. |
| **Contrôle automatique des pages publiées** | Après `page_publish` ou `page_edit`, la page est ouverte dans un onglet temporaire en **téléphone (390 px)** et **ordinateur (1280 px)** : le bot reçoit une image des deux, les erreurs de la console, les fichiers qui ne se chargent pas, et des règles (textes des images, contraste, débordement de côté, titre visible, viewport, focus clavier, mouvement réduit, `transition: all`, `100vw`, couleurs en dur, JSON-LD, caractères invisibles). Il doit te dire ce qui a été trouvé ; « rien trouvé » n'est jamais présenté comme « parfait ». Sans navigateur, seules les règles du code sont vérifiées, et c'est dit. |
| Lire une page | `page_read` (le texte), `screen_view` (une capture). |
| **Plusieurs onglets** | Le bot lit et agit toujours sur **l'onglet affiché devant**. Un lien qui ouvre un nouvel onglet : le bot le suit tout seul. `browser_tabs` liste ses onglets, `browser_tab` en met un devant ou le ferme, `browser_open` avec `new_tab` en ouvre un nouveau. Un deuxième `browser_open` réutilise le navigateur ouvert (plus jamais deux navigateurs à la fois). |
| **Fenêtre de la page** (« alerte », « Êtes-vous sûr ? », « Quitter la page ? ») | Le bot la voit tout de suite, avec son texte. `browser_dialog` : **« dismiss »** (Annuler / fermer) est toujours libre ; **« accept »** (OK) sur une question te demande d'abord ton accord, à chaque fois. |
| Bouton caché par un bandeau | Avant de cliquer, le bot vérifie ce qui est vraiment sous le clic. Si un bandeau cookies ou une fenêtre couvre le bouton, **rien n'est cliqué** et il sait ce qui gêne. |
| Cadres dans la page (iframes) | Les boutons d'un cadre du même site sont listés comme les autres (« in frame »). Un cadre d'un **autre site** (paiement, captcha) est signalé, mais ses boutons ne sont pas listés : le bot passe alors par l'image et les clics à l'écran. |
| **Regarder une vidéo** | Il la lance dans son navigateur, puis `video_frames` lui montre jusqu'à 12 images de l'écran pendant qu'elle passe (ou d'un fichier vidéo). Il décrit ce qu'il voit. |
| **Écouter une vidéo** (ou un appel) | `listen_screen` enregistre jusqu'à **10 minutes** de ce que joue l'ordinateur et le transforme en texte. Le son ne sort pas de l'ordinateur : personne ne l'entend. |
| Transcrire une vidéo par son adresse | `transcribe` : les sous-titres d'abord (gratuit), sinon le son. |
| **Télécharger une vidéo** | `video_download` (yt-dlp) la range dans sa bibliothèque (`~/files/videos`), 1080p au plus, 4 Go par défaut (20 Go au plus, dans la limite du disque de son ordinateur), donc même les vidéos très longues. Seulement quand tu le demandes, pour une vidéo que tu as le droit de garder. Les vidéos protégées (DRM) sont refusées. |
| **Lire le texte d'une image** (OCR) | `ocr` : son écran (ou une zone), une image, ou une page d'un PDF scanné, en français et en anglais (Tesseract). |
| Documents de bureau | `office_convert`, `office_recalculate`, `office_render` (LibreOffice). |
| Lire le web et les réseaux | `reach_search`, `reach_read` (Agent Reach, lecture seule). |
| Scripts et données | Un terminal root : Python avec pandas, requests, Beautiful Soup, lxml, Pillow, openpyxl, python-docx ; ffmpeg, ImageMagick, poppler, yt-dlp, Tesseract, xclip (presse-papiers), git, Node 22, Claude Code et Codex. |

### Ce que ça coûte

- `listen_screen` passe par **ta** reconnaissance vocale (Réglages → Voix) : **gratuite** avec ton propre Whisper ;
  avec OpenAI ou Fish Audio elle est **payante**, et le bot te demande d'abord ton accord (une fois par bot), avec le
  prix quand il est connu (Fish Audio : au tarif à la minute). Un enregistrement **silencieux** n'est jamais envoyé.
- Le bot attend pendant l'écoute : 1 minute d'écoute = 1 minute de travail, plus quelques secondes de transcription.
- `video_frames` envoie des images au modèle : comme `screen_view`, chaque image compte dans les jetons du modèle.
- `ocr`, `video_download` : gratuits (ils tournent sur l'ordinateur du bot), seul l'espace disque compte.

## Lui ouvrir tes comptes, sans lui donner tes mots de passe

Le bot ne voit **jamais** un mot de passe, et ne doit jamais t'en demander un dans la discussion. Trois façons :

1. **Te connecter toi-même, une fois** — le plus simple. Dans le panneau de détails, sous l'ordinateur du bot :
   **« Se connecter à un site »**. Tape l'adresse (ex. `linkedin.com/login`) : le site s'ouvre sur l'écran du bot et tu
   en prends la main. Connecte-toi (code par SMS, appli d'authentification… tout se fait de ton côté), puis
   **« Rendre la main »**. La session reste dans le navigateur du bot : il est connecté les fois suivantes, tant que le
   site ne le déconnecte pas.
2. **Enregistrer l'identifiant dans le Coffre** (Réglages → Coffre) : le bot le tape lui-même (`vault_type`) quand le
   site le demande, sans jamais le lire. Juste avant de taper, Sklubot vérifie **l'onglet devant, et le champ choisi** :
   la page (et chaque cadre jusqu'au champ) doit être sur le site enregistré, et un mot de passe ne va que dans un champ
   « mot de passe ». Sinon, rien n'est tapé. Une fausse page ouverte dans un autre onglet ne reçoit donc rien. Pour un
   code à 6 chiffres (2FA), tu peux y enregistrer la clé du code : le bot ne l'utilise que sur son site.
3. **Quand seul un humain peut passer** (CAPTCHA, code reçu sur ton téléphone, confirmation de paiement) : le bot te
   demande la main (`ask_takeover`), attend, puis reprend quand tu as fini.

Conseils : pour un site sensible, préfère un **compte secondaire** ; déconnecte un site depuis l'écran du bot (prends la
main, « Se déconnecter » sur le site), ou « Effacer » l'ordinateur (Réglages → Ordinateur) pour tout remettre à zéro.

## Tous les droits… dans son ordinateur

Dans **son** ordinateur, le bot fait ce qu'il veut, sans te demander : installer des logiciels, écrire des scripts,
lancer des programmes, garder des fichiers.

- **Ce qui reste** : tout son dossier personnel (`/root`, un volume à lui) — fichiers, réglages, connexions du
  navigateur, et ce qu'il installe dedans : `pip install --user --break-system-packages …`, `uv tool install …`,
  `npm install -g --prefix ~/.local …`, des programmes dans `~/.local/bin`.
- **Les paquets Debian** (`apt-get`) vivent hors du dossier personnel et seraient perdus quand l'ordinateur est refait à
  partir d'une nouvelle image : le bot les installe avec **`sklubot-install <paquet>`**, qui les note et les remet
  tout seul au démarrage suivant (journal : `~/.sklubot/apt-restore.log`).

## Ce qui reste protégé

« Tous les droits » veut dire **dans son ordinateur**, pas au-delà :

- **Pas d'accès au serveur** : aucun accès à la machine qui héberge Sklubot, ni à Docker, ni aux autres bots (chacun a
  son conteneur, sans privilèges, sans périphériques, mémoire et processus limités).
- **Réseau isolé** (mode `BOT_LINK=socket`, celui des installations Docker) : l'ordinateur sort sur Internet, mais ne voit ni les ports du serveur ni les ordinateurs des autres bots.
- **Tes accords restent les mêmes** : envoyer, payer, supprimer, publier — tout ce qui part vers l'extérieur ou ne se
  défait pas passe toujours par ta validation (ou tes règles), exactement comme avant.
- **Tes clés d'API** ne rentrent pas dans l'ordinateur : les programmes les utilisent à travers le relais
  (`sklubot-api`), qui les ajoute de son côté.
- **Ce qu'il lit est une information, jamais un ordre** : une page, une vidéo ou un texte lu à l'écran qui lui
  demanderait d'agir n'est pas suivi.
- **Son navigateur est dans un bac à sable** : Chromium tourne avec l'utilisateur `browser` (pas root) et avec son
  propre bac à sable, comme sur un ordinateur normal. Une page piégée reste enfermée dans son onglet. Le terminal du
  bot reste root ; ses téléchargements arrivent toujours dans `~/Downloads`, ses connexions sont gardées.

## Ton propre ordinateur (Relais) : les règles de sécurité

Quand tu relies **ton** ordinateur avec le Relais (l'appli Sklubot pour ordinateur), un bot peut le piloter avec ton
accord. Sklubot vérifie d'abord, sur le serveur, avant d'envoyer quoi que ce soit ; puis l'ordinateur vérifie encore de
son côté (au cas où l'appli serait ancienne ou modifiée). Tout se règle dans **Réglages → Ordinateurs → Règles de
sécurité**.

### Le terminal, sous contrôle (pour coder)

- **Les commandes sont activées par défaut** sur ton ordinateur : le bot peut lancer `npm test`, `git status`,
  `python manage.py runserver`… Tu peux les désactiver avec l'interrupteur « Commandes du terminal ».
- **Chaque commande t'est montrée sur une carte** avec la commande exacte, le dossier et le nom de l'ordinateur. Tu
  réponds : une fois, pour cette conversation, ou toujours. « Toujours » et « pour cette conversation » ne couvrent que
  **le début de la commande dans ce dossier** (par exemple `npm test` dans `~/projets/site`), jamais plus.
- **L'ordinateur demande aussi**, une fois par session de contrôle, pour les commandes ordinaires.
- **Toujours demandé, quoi que tu aies autorisé avant** (ici et sur l'ordinateur) : supprimer ou écraser (`rm -r`,
  `del /s`, `find -delete`, `git reset --hard`, `git push --force`, `git branch -D`…), les droits administrateur
  (`sudo`, `su`, `runas`, `doas`), installer pour tout l'ordinateur (`apt`, `brew`, `winget`, `npm -g`…), les disques
  et partitions, changer les droits de fichiers hors du projet, lancer un script téléchargé (`curl … | sh`), ouvrir ton
  ordinateur au réseau (`ssh -R`, `ngrok`, `nc -l`…), toucher aux fichiers de démarrage (`.bashrc`, `.zshrc`, profil
  PowerShell, `crontab`…), écrire hors du dossier de travail, ou travailler hors de tes dossiers de projet.
- **Dossiers de projet** : tu en choisis un ou plusieurs ; les commandes s'y lancent par défaut. Un dossier « gardé à
  l'écart » reste refusé.
- **Un script se montre avant de se lancer** : si une commande lance un script (`bash run.sh`, `./deploy.sh`…), la
  carte affiche ses 40 premières lignes et son empreinte ; s'il change avant ton clic, rien ne se lance. Le bot ne voit
  jamais le contenu du script.
- **La sortie** de chaque commande s'affiche dans la discussion (repliée, « Voir la sortie »), pendant qu'elle tourne ;
  les secrets y sont masqués (les mots de passe de ton coffre aussi). Elle est limitée en taille.
- **Arrêter** : le bouton **Stop** (section « Mon ordinateur » ou visionneuse) arrête la commande et tout ce qu'elle a
  lancé. Une commande s'arrête seule après la durée maximale que tu choisis (2 minutes par défaut). Le bot peut aussi
  lancer une commande longue en arrière-plan (un serveur de développement), lire sa sortie et l'arrêter ; tout s'arrête
  à la fin de la session.
- **Les fenêtres de terminal restent interdites aux clics et à la frappe** : le bot passe par les commandes, pour que
  chacune soit montrée sur une carte.

### Se connecter à tes comptes (coffre)

- Le bot peut remplir **un identifiant, un mot de passe ou un code à usage unique** de ton coffre dans le champ actif,
  sur ton ordinateur. **Le secret va seulement à ton ordinateur** : jamais au bot, jamais dans la discussion ni dans le
  journal.
- **La première fois** sur un site (ou une appli), une carte te le demande : le site, l'appli, le nom de l'élément —
  jamais le secret. Tu peux l'autoriser « toujours » pour ce site.
- **Refusé** si la page n'est pas le site enregistré (ou l'appli n'est pas la bonne), si la fenêtre a changé depuis la
  dernière capture du bot, si un mot de passe irait ailleurs que dans un champ mot de passe, ou si le navigateur ne dit
  pas son adresse (Firefox sur Mac, et tous les navigateurs sous Linux : tu tapes toi-même).
- En dehors du coffre, **le bot ne tape jamais dans un champ mot de passe**.

### Ce qui reste toujours interdit

- **Applis toujours refusées** (clics et frappe) : fenêtres de terminal, outils de scripts, réglages et outils du
  système, gestionnaires de mots de passe et portefeuilles (1Password, Bitwarden, KeePassXC, Trousseau…), et Sklubot
  lui-même (un bot ne peut pas cliquer sur ses propres cartes d'accord).
- **Ta liste « garder à l'écart »** : des applis (par leur nom, ou un mot du titre de la fenêtre) et des dossiers. Le bot
  ne peut ni cliquer ni taper dedans, ni lire ces dossiers, ni y lancer de commande ; leurs fenêtres ne lui sont pas
  nommées. 50 lignes au plus par liste.
- **La fenêtre est revérifiée** juste avant chaque clic, défilement, saisie ou touche : si une autre fenêtre est passée
  devant depuis la dernière capture du bot, rien n'est fait.
- **Raccourcis protégés** : fermer une appli (Alt+F4, Cmd+Q), verrouiller ou déconnecter la session (Win+L,
  Ctrl+Cmd+Q…), Ctrl+Alt+Suppr, le gestionnaire des tâches, les lanceurs (Win+R, Cmd+Espace, Alt+F2, Ctrl+Alt+T),
  changer d'appli ou de bureau (Alt+Tab, Cmd+Tab), supprimer définitivement… La liste exacte, par système, est dans les
  règles de sécurité. Le bot peut fermer une appli qu'il a ouverte lui-même ; pour le reste, il te faut accepter une
  carte, puis confirmer sur l'ordinateur.
- **Les touches ne restent jamais enfoncées** : à la fin d'une session, sur Stop ou si la connexion tombe, l'ordinateur
  relâche toutes les touches et tous les boutons de souris.

Limites : la capture d'écran montre tout l'écran (une fenêtre « gardée à l'écart » reste visible sur l'image, mais le
bot ne peut pas agir dedans) ; sous Linux, il faut une session X11 avec `xprop`, et le système ne dit pas si un champ
est un mot de passe (le bot ne tape alors rien dans une fenêtre qui ressemble à une connexion).

## Pour l'administrateur

Les ajouts de l'image (environ **+130 Mo**) : Tesseract 5.3 + données fra/eng (Apache-2.0), PulseAudio 16.1 avec une
carte son virtuelle (`docker/desktop/sound.sh`, LGPL), xclip, les bibliothèques Python de Debian, yt-dlp 2026.10.26
(Unlicense, binaire officiel vérifié par SHA-256 ; `/etc/yt-dlp.conf` active Node pour YouTube). Il faut reconstruire
l'image (`npm run computer:build`) ; un ordinateur refait à partir de l'ancienne image répond « pas de carte son » à
`listen_screen` jusqu'à ce qu'il le soit. Code : `server/src/media.ts` ; tests : `server/test/media-tools.test.ts`.

**Bac à sable du navigateur (L48).** L'image crée l'utilisateur `browser` et porte l'étiquette
`sklubot.browser-sandbox=1` ; Sklubot crée alors chaque ordinateur avec le profil seccomp
`docker/desktop/seccomp-chromium.json` (détails : docs/SECURITE.md, « Navigateur des bots »). Après la mise à jour,
**reconstruis l'image** (`npm run computer:build`, ou `docker compose -f docker-compose.vps.yml build desktop-image`) :
rien d'autre à faire, chaque ordinateur fait avec l'ancienne image est **refait tout seul** quand il ne sert pas
(dossier personnel gardé : fichiers, connexions, navigateur ; paquets remis par `sklubot-install`). En attendant, il
marche comme avant (navigateur root, sans bac à sable) et Réglages → Autorisations → Sécurité le signale. L'état du
navigateur d'un ordinateur est dans `/tmp/sklubot-browser-sandbox` (`on`, ou `off` et la raison) ; ses premiers
messages dans `/tmp/sklubot-browser.log`. Code : `docker/desktop/open-browser.sh`, `server/src/browsersandbox.ts`.
