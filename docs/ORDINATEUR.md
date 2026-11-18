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
| Lire une page | `page_read` (le texte), `screen_view` (une capture). |
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
   site le demande, sans jamais le lire. Pour un code à 6 chiffres (2FA), tu peux y enregistrer la clé du code : le bot
   ne l'utilise que sur son site.
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

## Pour l'administrateur

Les ajouts de l'image (environ **+130 Mo**) : Tesseract 5.3 + données fra/eng (Apache-2.0), PulseAudio 16.1 avec une
carte son virtuelle (`docker/desktop/sound.sh`, LGPL), xclip, les bibliothèques Python de Debian, yt-dlp 2026.10.26
(Unlicense, binaire officiel vérifié par SHA-256 ; `/etc/yt-dlp.conf` active Node pour YouTube). Il faut reconstruire
l'image (`npm run computer:build`) ; un ordinateur refait à partir de l'ancienne image répond « pas de carte son » à
`listen_screen` jusqu'à ce qu'il le soit. Code : `server/src/media.ts` ; tests : `server/test/media-tools.test.ts`.
