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
| **Mesurer une page** (L115) | `page_audit` passe une page publiée par le bot (`name`) ou une adresse (`url` : ton site, une page de son serveur de test) dans **Lighthouse** (notes sur 100 : accessibilité, rapidité, bonnes pratiques, référencement) et **axe** (règles d'accessibilité), en taille téléphone, sur son ordinateur. Le bot reçoit un **court résumé** (les notes, au plus 8 problèmes par outil, où ils sont) ; les **rapports complets** vont dans sa bibliothèque (`audits/<nom>-<date>/` : `lighthouse.report.html` à ouvrir dans un navigateur, `lighthouse.report.json`, `axe.json`), jamais collés dans la discussion. Environ 30 secondes. Rien n'est modifié ni envoyé ailleurs. Un audit automatique ne trouve qu'une partie des problèmes : le bot fait aussi les vérifications à la main (compétence « Accessibilité mesurée »). |
| **Les autres applis, par leurs commandes** (L164) | `app_windows` liste les applis ouvertes et leurs fenêtres ; `app_tree` lit les boutons, menus, champs et listes de l'appli devant (une boîte de dialogue ouverte d'abord), chacun avec une référence comme `x3f9a.12` ; `app_act` clique, met le focus ou remplace le texte d'un champ (relu ensuite) **par sa référence**, sans viser au pixel. Si l'appli a changé depuis la lecture, rien n'est fait. Un champ mot de passe n'est jamais lu ni rempli ; un clic sur « Envoyer », « Payer », « Supprimer »… te demande ton accord à chaque fois ; rien ne se fait pendant que tu as la main. Ça marche avec les applis GTK (éditeur de texte, gestionnaire de fichiers, boîtes « Enregistrer sous ») ; pour les pages du navigateur, `element_snapshot` reste plus précis. Une appli ouverte avant le démarrage du lecteur doit être rouverte. |
| **Plusieurs onglets** | Le bot lit et agit toujours sur **l'onglet affiché devant**. Un lien qui ouvre un nouvel onglet : le bot le suit tout seul. `browser_tabs` liste ses onglets, `browser_tab` en met un devant ou le ferme, `browser_open` avec `new_tab` en ouvre un nouveau. Un deuxième `browser_open` réutilise le navigateur ouvert (plus jamais deux navigateurs à la fois). |
| **Fenêtre de la page** (« alerte », « Êtes-vous sûr ? », « Quitter la page ? ») | Le bot la voit tout de suite, avec son texte. `browser_dialog` : **« dismiss »** (Annuler / fermer) est toujours libre ; **« accept »** (OK) sur une question te demande d'abord ton accord, à chaque fois. |
| Bouton caché par un bandeau | Avant de cliquer, le bot vérifie ce qui est vraiment sous le clic. Si un bandeau cookies ou une fenêtre couvre le bouton, **rien n'est cliqué** et il sait ce qui gêne. |
| Cadres dans la page (iframes) | Les boutons d'un cadre du même site sont listés comme les autres (« in frame »). Ceux d'un cadre d'un **autre site** (boîte de paiement, bandeau cookies d'une autre société) sont **lus aussi** (« another site: click or hover only ») : le bot peut **cliquer ou survoler** ; un clic qui engage (payer…) te demande comme partout, et ce qui est sous le clic est vérifié dans la page puis dans le cadre. Taper dedans est refusé (carte : `card_fill` ; sinon clic puis `screen_type`). Un **CAPTCHA** n'est jamais lu ni touché : le bot te demande la main (L14). |
| **Revenir en arrière** | `browser_back` revient à la page d'avant dans l'onglet (`forward` : celle d'après), puis la relit en mots (L75). |
| **Capture avec numéros** | `element_snapshot` avec `picture` : une capture de la page où chaque bouton ou champ visible porte en rose le numéro de sa référence (utile pour une icône sans nom ou une page chargée). Les numéros sont posés par-dessus la page le temps de la capture, puis retirés (L75). |
| **Lire une page sans navigateur** | `web_fetch` demande la page **en Markdown** (un site qui en sert le renvoie tel quel), sinon transforme le HTML en Markdown léger (titres, liens avec leur adresse, listes, code). `llms: true` lit d'abord le `llms.txt` du site (son sommaire pour les IA) ; `markdown_copy: true` essaie la copie `.md` de la page (sites de documentation) (L75). |
| **Bots sur abonnement (Claude Code) et liens** | Quand le navigateur du bot est prêt, son outil `WebFetch` est retiré pour le tour : chaque lien s'ouvre dans son vrai navigateur, sous tes yeux. Si le navigateur ne répond pas, `WebFetch` reste (le bot n'est jamais privé de lecture). Et quand le bot que tu regardes se met à utiliser son navigateur, son écran s'ouvre tout seul : panneau « Activité » sur grand écran, message « Voir l'écran » sur téléphone (L64). |
| **Regarder une vidéo** | Il la lance dans son navigateur, puis `video_frames` lui montre jusqu'à 12 images de l'écran pendant qu'elle passe (ou d'un fichier vidéo). Il décrit ce qu'il voit. |
| **Écouter une vidéo** (ou un appel) | `listen_screen` enregistre jusqu'à **10 minutes** de ce que joue l'ordinateur et le transforme en texte. Le son ne sort pas de l'ordinateur : personne ne l'entend. |
| Transcrire une vidéo par son adresse | `transcribe` : les sous-titres d'abord (gratuit), sinon le son. |
| **Télécharger une vidéo** | `video_download` (yt-dlp) la range dans sa bibliothèque (`~/files/videos`), 1080p au plus, 4 Go par défaut (20 Go au plus, dans la limite du disque de son ordinateur), donc même les vidéos très longues. Seulement quand tu le demandes, pour une vidéo que tu as le droit de garder. Les vidéos protégées (DRM) sont refusées. |
| **Lire le texte d'une image** (OCR) | `ocr` : son écran (ou une zone), une image, ou une page d'un PDF scanné, en français et en anglais (Tesseract). |
| Documents de bureau | `office_convert`, `office_recalculate`, `office_render` (LibreOffice). |
| Lire le web et les réseaux | `reach_search`, `reach_read` (Agent Reach, lecture seule). |
| Scripts et données | Un terminal root : Python avec pandas, requests, Beautiful Soup, lxml, Pillow, openpyxl, python-docx ; ffmpeg, ImageMagick, poppler, yt-dlp, Tesseract, xclip (presse-papiers), git, Node 22, Claude Code et Codex ; pour les pages et les schémas : `lighthouse`, `sklubot-axe`, `mmdc` (mermaid-cli) et `chrome-devtools-mcp` (voir plus bas). |

### Outils pour les pages et les schémas (L115, décision n° 10)

Tous utilisent **le Chromium déjà présent** sur l'ordinateur (par `/opt/sklubot/headless-chromium`, sans fenêtre, sous
l'utilisateur « browser » avec la protection de Chromium, comme le navigateur du bot) : aucun deuxième Chrome n'est
téléchargé. Versions figées (fichier `docker/desktop/web-tools/package-lock.json`), **télémétrie coupée**.

| Outil | Version, licence | Commande sur l'ordinateur | Télémétrie |
|---|---|---|---|
| Lighthouse | 13.6.0, Apache-2.0 | `lighthouse <adresse> --only-categories=accessibility --output=json --output-path=/root/files/audits/a11y.json --chrome-flags="--headless=new" --quiet --no-enable-error-reporting` (le bot passe d'abord par `page_audit`) | rapports d'erreurs coupés (`--no-enable-error-reporting`, et jamais proposés hors d'un terminal interactif) ; le module d'envoi (Sentry) est **retiré** de l'image : impossible de l'allumer |
| axe-core (par `sklubot-axe`) | 4.14.1, MPL-2.0 (non modifié) | `sklubot-axe <adresse> --json /root/files/audits/axe.json` : une ligne par règle en échec | aucune (axe-core n'envoie rien) |
| mermaid-cli (`mmdc`) | 12.2.0, MIT | `mmdc -i schema.mmd -o schema.svg` (ou `-o schema.png -s 2`) | aucune |
| chrome-devtools-mcp | 1.14.0, Apache-2.0 | comme **outil local** (Applis → outils locaux) : la commande `chrome-devtools-mcp`, sans version (celle de l'image) ; Sklubot ajoute `--no-usage-statistics --no-performance-crux` et, s'il ne rejoint pas un navigateur, `--executablePath=/opt/sklubot/headless-chromium --headless` | statistiques d'usage et recherche de mises à jour coupées (`CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS`, `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS`) ; ses outils qui agissent (clic, saisie, navigation, script…) te demandent à chaque fois |

**Place sur le disque** (mesurée le 25/11/2026 sur l'image du bot) : **+588 Mo** décompressés (+121 Mo à télécharger),
dont mermaid-cli pour l'essentiel (~420 Mo : mermaid, ses polices et icônes, l'extension ZenUML), Lighthouse ~80 Mo,
Puppeteer (partagé par Lighthouse, mmdc et `sklubot-axe`) ~40 Mo, chrome-devtools-mcp 12 Mo, axe-core 3 Mo ; les
modules d'envoi d'erreurs de Lighthouse et deux bibliothèques inutiles ici (−92 Mo) sont retirés.

**`sloplint` n'est pas installé** : aucun paquet publié de ce nom n'existe avec une licence (le nom npm a été dépublié
le 02/06/2026 ; le `sloplint` de PyPI est un autre outil, pour la prose Markdown). Le `sloplint.mjs` de Hallmark n'est
qu'un script dans son dépôt ; ses règles utiles sont déjà reprises dans le contrôle automatique des pages
(`server/src/pagecheck.ts`).

### Ce que ça coûte

- `listen_screen` passe par **ta** reconnaissance vocale (Réglages → Voix) : **gratuite** avec ton propre Whisper ;
  avec OpenAI ou Fish Audio elle est **payante**, et le bot te demande d'abord ton accord (une fois par bot), avec le
  prix quand il est connu (Fish Audio : au tarif à la minute). Un enregistrement **silencieux** n'est jamais envoyé.
- Le bot attend pendant l'écoute : 1 minute d'écoute = 1 minute de travail, plus quelques secondes de transcription.
- `video_frames` envoie des images au modèle : comme `screen_view`, chaque image compte dans les jetons du modèle.
- `ocr`, `video_download` : gratuits (ils tournent sur l'ordinateur du bot), seul l'espace disque compte.

## Regarder et prendre la main (vue de l'écran)

- **Reconnexion toute seule** : si l'image en direct se coupe après avoir marché, la vue réessaie après 1, 2, 4, 8 puis
  15 secondes (« Connexion perdue. Nouvel essai (2/5) dans 2 s… », avec « Reconnecter maintenant »). Après 5 essais
  elle dit que l'écran est injoignable et propose **« Reconnecter »**. Dans le petit panneau comme dans la grande vue
  (avant, la grande vue restait sur « connexion… » sans fin : corrigé).
- **Coller** (quand tu as la main) : le texte de ton presse-papiers devient celui de l'ordinateur du bot, puis Ctrl+V le
  colle où est le curseur. Pratique pour une adresse ou un long texte sur téléphone. Ton navigateur peut te demander la
  permission de lire le presse-papiers.
- **Ctrl+Alt+Suppr** (quand tu as la main) et **Capture** (toujours) : la capture est enregistrée en PNG dans tes
  téléchargements (« ecran-<bot>-<date>.png »).
- **« Léa utilise son écran en ce moment »** s'affiche en haut de l'image quand le bot agit sur son ordinateur et que tu
  regardes seulement.
- **Bail numéroté** : quand tu prends la main, le serveur te donne un numéro ; chaque rappel (toutes les 30 s) le cite,
  et « Rendre la main » libère ce numéro. Un rappel en retard sur le réseau ne reprend jamais la main après que tu l'as
  rendue ; un « Rendre la main » perdu est renvoyé (3 essais) et le bail expire de toute façon après 75 s.

- **« Où le bot a cliqué »** (L149) : chaque clic du bot sur son écran (clic à l'écran, glisser, clic par référence, y
  compris dans le cadre d'un autre site) laisse un petit cercle qui s'efface en 2,4 s sur l'image en direct. Rien n'est
  gardé.

Code : `web/src/lib/reconnect.ts` (délais, coller, capture — repris de hermes-bot-kit, MIT), `web/src/lib/liveReconnect.ts`,
`web/src/lib/controlLease.ts`, `server/src/takeover.ts` (`controlRequest`). Tests : `web/scripts/screen-viewer.test.mjs`,
`server/test/control-lease.test.ts`. Captures : `docs/screenshots/ecran/`.

### Diffusion de l'écran : pourquoi noVNC reste (L182, mesuré le 23/11/2026)

On a cherché plus léger que x11vnc + noVNC parmi ce que contient l'image du bureau (`sklubot-desktop`). Mesure : un
écran 1280×800 (Xvfb + Openbox + un terminal), un client qui demande des images sans arrêt pendant 20 s, temps de
processeur du diffuseur lu dans `/proc` :

| Diffuseur | Écran immobile | Écran qui change sans arrêt |
|---|---|---|
| x11vnc, réglage actuel (`-noxdamage`) | 0,35 s (1,8 % d'un cœur) | 1,48 s (7,4 %) |
| x11vnc avec XDAMAGE | 0,23 s (1,2 %) | 1,55 s (7,8 %) |
| ffmpeg x11grab → MJPEG, 10 images/s | 1,76 s (8,8 %) | 1,89 s (9,5 %) |
| ffmpeg x11grab → VP8 temps réel, 10 images/s | 4,05 s (20 %) | 17,6 s (88 %) |

Conclusion : x11vnc n'envoie que ce qui change et ne travaille presque pas sur un écran immobile ; un flux vidéo encode
tout, tout le temps, et demanderait un autre lecteur dans le navigateur et un autre chemin (jetons, proxy). Le
diffuseur de Superbot n'est pas dans l'image et sa licence n'a pas été vérifiée : pas repris. On ne passe pas non plus
à XDAMAGE (gain de 0,6 % seulement, et des images manquées possibles avec Chromium sur Xvfb : à vérifier à l'œil avant).
**noVNC reste.** Pour refaire la mesure : un conteneur `sklubot-desktop` sans réseau, Xvfb `:1`, x11vnc sur un port
local, un petit client RFB qui envoie `FramebufferUpdateRequest` en boucle, et `ps`/`/proc/<pid>/stat` avant et après.

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
4. **Un code reçu par SMS (case masquée, L91)** : le bot nomme le champ du code (`code_request`) ; tu reçois une carte
   avec une **case masquée**. Ce que tu y tapes va **tout droit dans ce champ** de la page (même onglet, même site) :
   le bot ne le voit jamais (ni dans sa réponse, ni dans les relectures de la page : « code caché »), et il n'est gardé
   nulle part. « Je ne l'ai pas » le prévient. Il attend 10 minutes au plus. Limite : une capture d'écran prise ensuite
   peut montrer les chiffres si la page les affiche (un code à usage unique expire vite). Un champ dans le cadre d'un
   autre site : le bot te demande la main à la place.
5. **Changer un mot de passe : « à faire par toi » (L91)** : le bot ne change jamais un mot de passe lui-même. Il te
   passe l'étape (carte « À faire par toi », bouton **« Je l'ai fait moi-même »**) ; tu le fais sur son écran ou sur ton
   appareil, et il reprend.

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

### Un ordinateur pour tous tes bots

Ton ordinateur relié sert à **tous** tes bots, un seul à la fois :

- sur la question du Relais, « **Autoriser tous mes bots de ce compte** » : ensuite, n'importe lequel de tes bots
  prend la main sans nouvelle question (tu le retires dans la liste « Bots » du Relais). Dans Sklubot, la carte
  « prendre le contrôle » propose aussi « **Pour tous mes bots** » (retirable dans Réglages → Ordinateurs) ;
- si un bot utilise déjà l'ordinateur, le suivant attend son tour et l'écrit dans son chat : « En attente de
  l'ordinateur …, utilisé par Léa ». Quand le premier ne fait plus rien depuis 20 secondes, il laisse la main tout seul ;
- les commandes sont toujours demandées comme avant, et **Stop** arrête tout, y compris les bots qui attendent ;
- avec plusieurs ordinateurs reliés, chaque bot a « **Ordinateur de ce bot** » dans ses réglages : « Celui qui est
  connecté » (par défaut) ou un ordinateur précis.

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

## Sortie Internet : proxy, maison, signature (L169)

Réglages du bot → Sécurité → « **Sortie Internet** ». Tu choisis par où le bot sort pour aller sur les sites. Son
« Accès à Internet » (partout / liste / nulle part, sites interdits) s'applique **toujours par-dessus**, à chaque
redirection aussi.

| Choix | Ce qui se passe | Son navigateur |
|---|---|---|
| **Direct** (par défaut) | Le bot sort depuis le serveur. | en direct |
| **Proxy** | Tu donnes l'adresse d'un proxy HTTP(S) ou SOCKS5 (`socks5://proxy.exemple.com:1080`) et, s'il en faut, un nom et un mot de passe. Ils sont scellés comme le coffre, **jamais réaffichés**, jamais posés dans l'ordinateur du bot. | passe aussi par le proxy* |
| **Maison · Relais** | Ses lectures de pages et téléchargements partent de **ta** connexion, par l'appli Sklubot de ton ordinateur. La première fois, ton ordinateur te demande ton accord ; **Stop** l'arrête ; ton réseau à la maison (box, imprimante…) est toujours refusé. | reste en direct |
| **Maison · Tailscale** | Le bot sort par ton nœud de sortie Tailscale (voir plus bas). Seulement sur un serveur à toi. | passe aussi par là* |

\* quand les ordinateurs des bots sont reliés au serveur par leur socket (le réglage par défaut avec un volume de
données, `BOT_LINK=socket`) et pour l'ordinateur du bot lui-même (pas un ordinateur partagé). Chromium reçoit une règle
gérée `ProxySettings` qui l'envoie vers le port du socket dans l'ordinateur ; le serveur ouvre alors le tunnel par le
proxy, après avoir vérifié la politique réseau du bot. Les pages en `http://` simple sont passées en `https://`
(`HttpsOnlyMode`). Pris en compte au prochain démarrage du navigateur.

**Le bouton « Tester »** fait une demande par la sortie choisie et dit l'adresse que les sites voient (page de test :
`https://www.cloudflare.com/cdn-cgi/trace`, changeable avec `EGRESS_TEST_URL`). Les erreurs sont dites simplement :
mot de passe refusé, proxy injoignable, pas un proxy de ce type, Relais pas connecté, accord refusé…

**Pour sortir par la maison, ton ordinateur doit rester allumé** (et, pour le Relais, Sklubot ouvert dessus). S'il
s'éteint, le bot ne peut plus lire de pages tant que tu ne remets pas « Direct ».

### Pourquoi deux façons de sortir par la maison

- **Relais** : rien à installer de plus si tu as déjà l'appli Sklubot sur ton ordinateur. Le plus simple, mais
  seulement pour les lectures de pages et les téléchargements (l'appli relaie des demandes entières, pas les tunnels
  chiffrés d'un navigateur). Détails : docs/RELAIS-PROTOCOLE.md §19.
- **Tailscale** : tout passe (navigateur compris), mais il faut un compte Tailscale et l'installer à deux endroits.

### Installer la sortie Tailscale (serveur à toi)

Uniquement avec les options officielles de Tailscale :

1. Sur l'ordinateur de la maison : installer Tailscale, puis `sudo tailscale set --advertise-exit-node` et
   `sudo tailscale up` ; dans la console d'administration Tailscale, menu de l'appareil → **Edit route settings** →
   **Use as exit node** (https://tailscale.com/kb/1103/exit-nodes). Sous Linux, il faut aussi activer le transfert IP
   (même page).
2. Sur le serveur : ajouter le conteneur officiel `tailscale/tailscale` à côté de Sklubot, en réseau « userspace »
   avec son serveur SOCKS5 (https://tailscale.com/kb/1282/docker, paramètres https://tailscale.com/docs/features/containers/docker/docker-params,
   et https://tailscale.com/kb/1112/userspace-networking) :
   ```yaml
   tailscale:
     image: tailscale/tailscale:stable
     hostname: sklubot-sortie
     environment:
       - TS_AUTHKEY=${TS_AUTHKEY}          # clé d'authentification Tailscale
       - TS_STATE_DIR=/var/lib/tailscale   # garder l'état, sinon un nouvel appareil à chaque redémarrage
       - TS_USERSPACE=true
       - TS_SOCKS5_SERVER=:1055
       - TS_EXTRA_ARGS=--exit-node=100.x.y.z   # l'adresse Tailscale de l'ordinateur de la maison
     volumes:
       - tailscale-state:/var/lib/tailscale
   ```
   La **clé d'authentification** se met dans les variables d'environnement du serveur (dans Coolify : l'onglet
   « Environment Variables » de l'application), **jamais dans une discussion** avec un bot ou avec quelqu'un. Sklubot
   lui-même ne la voit jamais.
3. Dans les variables de Sklubot : `TAILSCALE_PROXY=socks5://tailscale:1055`, puis redémarrer. Le choix
   « Maison · Tailscale » apparaît dans les réglages des bots. Ce proxy est le seul qui peut être sur le réseau interne
   du serveur (c'est l'administrateur qui le règle, pas une adresse tapée dans l'écran).

**Pas essayé ici avec un vrai compte Tailscale** : la doc de Tailscale ne dit pas en toutes lettres que le serveur
SOCKS5 du mode « userspace » suit `--exit-node` ; vérifie avec « Tester » (l'adresse affichée doit être celle de ta
maison).

### Signer ses visites (Web Bot Auth)

Case « **Signer ses visites (Web Bot Auth)** », éteinte par défaut. Allumée, chaque lecture de page du bot porte une
signature (normes IETF : HTTP Message Signatures, RFC 9421, et draft-ietf-webbotauth-httpsig-protocol-01) qui dit au
site « je suis le Sklubot de ce serveur ». Les sites qui acceptent les bots identifiés (par exemple derrière Cloudflare)
peuvent alors le laisser passer au lieu de le bloquer.

- Une seule paire de clés par installation, faite la première fois ; la clé privée est scellée comme le coffre.
- La clé publique est publiée à `https://<ton serveur>/.well-known/http-message-signatures-directory` (format JWKS,
  réponse signée elle aussi). Il faut donc un serveur en **https** (`PUBLIC_URL`) ; sinon la case est grisée.
- Chaque signature vaut 5 minutes et ne couvre que le nom du site : elle dit qui demande, pas ce qui est demandé.
- **Jamais par la maison** sans la seconde case « Signer aussi quand il sort par la maison » : sinon un site pourrait
  relier l'adresse de ta maison à ton serveur.
- Pas signé : le navigateur du bot (ses connexions sont chiffrées de bout en bout jusqu'au site), les appels d'API avec
  tes clés.

Code : `server/src/botroute.ts`, `proxyconnect.ts`, `webbotauth.ts`, `botforward.ts`, `botrouteroutes.ts` ;
`companion/src/main/capabilities/netexit.js`. Tests : `server/test/l169-egress.test.ts`,
`companion/test/unit/netexit.test.js`.

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
