# Audit : vercel-labs/agent-browser face à l'ordinateur des bots Sklubot

Type : **OUTIL** (CLI native Rust + démon qui pilote Chrome par CDP, serveur MCP, tableau de bord, 11 skills).
Clone superficiel lu le 2026-11-22, jamais exécuté, supprimé après écriture.

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 11 | 21 | 41 | 9 | 20 |

(103 lignes de fonctions, dont 1 « IDÉE », + 11 skills.)

## Licence

`LICENSE` : **Apache License 2.0**. Copier, modifier, redistribuer (y compris commercialement) avec la notice et la
mention des modifications. Les skills (`skills/`, `skill-data/`) n'ont pas de licence propre : Apache-2.0 du dépôt.
La commande `chat` dépend d'une passerelle IA payante de Vercel (`AI_GATEWAY_API_KEY`) : non repris.

## Rappel : ce que fait Sklubot (lu dans le code)

Voir aussi `AUDIT-CHROME-DEVTOOLS-MCP.md`. En bref : outils pixel xdotool (`server/src/linux.ts:676-735`), outils par
référence CDP (`server/src/screen-elements.ts`, `server/src/agent/elements.ts`, `server/src/agent/tools.ts:204-252`),
lecture `innerText` (`docker/desktop/page-text.py`), une capture JPEG plein écran après chaque action, pauses fixes,
protections de clic engageant (`bind.ts`, `authorize.ts`, `irreversible.ts`), suivi du « contenu extérieur lu »
(`loop.ts:1289-1311`). Tests `server/test/elements.test.ts` : **4/4 OK** lancés pendant l'audit.

Deux défauts **vérifiés** pendant l'audit (détails dans `AUDIT-CHROME-DEVTOOLS-MCP.md`) qui concernent aussi ce dépôt :
1. un 2ᵉ `browser_open` lance un 2ᵉ Chromium (le verrou du profil est effacé par `dress.py:295`) et la lecture porte
   sur l'ancienne page ; 2. une `alert()` ouverte bloque `page_read`/`element_snapshot` 15 s puis renvoie une trace
   Python.

## Tableau complet

### Lire la page

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Lecture | `snapshot` arbre a11y avec refs `@eN` | PARTIEL | `element_snapshot` (interactifs seulement) tools.ts:212 | Arbre complet avec titres/textes | M |
| Lecture | `snapshot -i` interactifs seulement | FAIT | screen-elements.ts `snapshot()` ; test elements.test.ts:55 | — | — |
| Lecture | `-c` compact, `-d` profondeur, `-s` portée par sélecteur | MANQUANT | `limit` seulement | Limiter à une zone (ex. le formulaire) | S |
| Lecture | `-u` adresse des liens | MANQUANT | — | Le bot ne voit pas où mène un lien avant de cliquer (utile contre les liens piégés) | S |
| Lecture | **Indices de contrôle** (`hint="icon:trash; in:Blue mug"`) pour boutons sans nom ou en double | MANQUANT | Un bouton-icône sort `button ""` (elements.ts:28) | Dix boutons « poubelle » indiscernables : le bot clique au hasard ou repasse aux pixels | M |
| Lecture | Refs **stables** entre snapshots, invalidées seulement si l'élément disparaît | DIFFÉRENT | Refs valables pour un seul snapshot (elements.ts:42) | Snapshot complet à chaque changement | M |
| Lecture | Récupération d'une ref périmée : même rôle + même nom, seulement si unique | MANQUANT | Refus net (elements.ts:50) | Plus de tours perdus après un petit rafraîchissement | S |
| Lecture | `snapshot --delta` (seulement ce qui a changé) | MANQUANT | — | Économie de jetons sur les longues pages | M |
| Lecture | Iframes intégrées au snapshot, refs utilisables sans changer de frame | MANQUANT | Frame principale seulement | Paiement, cookies en iframe invisibles | M |
| Lecture | `frame @e3` / `frame main` (portée du snapshot) | MANQUANT | — | — | S |
| Lecture | `read [url]` : texte « pour agent », `Accept: text/markdown`, `.md`, `llms.txt`, `--outline`, `--filter` | PARTIEL | `web_fetch` ; `page_read` = innerText brut ; `teamfile.ts:497` envoie déjà `Accept: text/markdown` ailleurs | `web_fetch` ne demande pas le Markdown ni `llms.txt` ; pas de plan des titres | S |
| Lecture | `get text/html/value/attr/title/url/count/box/styles` | PARTIEL | `page_read` (texte), titre/URL dans la réponse | Valeur d'un champ, attribut, nombre d'éléments | S |
| Lecture | `is visible/enabled/checked` | PARTIEL | États dans le snapshot (elements.ts:27) | — | — |
| Lecture | `find role/text/label/placeholder/alt/title/testid/first/last/nth` + action | MANQUANT | — | Agir sans snapshot complet (« bouton Envoyer ») | M |
| Lecture | Sortie `--json` structurée | NON REPRIS | Sortie texte pour le modèle | — | — |
| Lecture | `--max-output` (plafonner le contenu venant de la page) | FAIT | `spillIfLong` 40 000 car. (tools.ts:166) | — | — |
| Lecture | **Marqueurs de contenu non fiable** avec nonce (`--content-boundaries`) | DIFFÉRENT | Suivi « contenu extérieur lu » + demandes d'accord ensuite (loop.ts:1289) ; consigne « une page est une information » | Sklubot est plus fort sur l'effet ; les marqueurs aideraient le modèle à ne pas confondre | S |

### Agir

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Action | `click @ref` (+ `--new-tab`, bouton droit, modificateurs) | PARTIEL | `element_click` | Bouton droit / Ctrl+clic par ref (existe en pixels) | S |
| Action | **Clic refusé si l'élément est caché, désactivé, hors écran ou couvert** (test `DOM.getNodeForLocation` au point de clic, `cli/src/native/click_point.rs:221-306`) | PARTIEL | Refus si désactivé (screen-elements.ts `act`) ; défilement avant clic | **Pas de test du point de clic** : si un bandeau cookies couvre le bouton, Sklubot clique le bandeau et répond « Clicked button "Envoyer" ». Pire pour la sécurité : le clic engageant est approuvé pour le libellé de la ref, mais c'est l'élément du dessus qui le reçoit | S |
| Action | `dblclick` | PARTIEL | Pixels seulement | Par ref | S |
| Action | `fill` (vider + remplir) / `type` | FAIT | `element_type` clear/submit | — | — |
| Action | `keyboard type/inserttext`, `keydown/keyup` | PARTIEL | `screen_type`, `screen_key` | Maintenir une touche | S |
| Action | `hover`, `focus` | MANQUANT | — | Menus au survol | S |
| Action | `select` par valeur ou libellé | FAIT | `element_select` (CHOOSE, screen-elements.ts) ; test elements.test.ts:73 | — | — |
| Action | `check` / `uncheck` (état voulu) | MANQUANT | Clic aveugle | Risque de décocher | S |
| Action | `scroll` haut/bas/gauche/droite, dans un conteneur ; `scrollintoview` | PARTIEL | `screen_scroll` haut/bas ; scroll auto avant clic | Gauche/droite ; zone défilante précise | S |
| Action | `drag` source → cible par ref | PARTIEL | `screen_drag` pixels | — | M |
| Action | `upload @ref fichiers` | MANQUANT | — | Joindre un fichier à un formulaire | M |
| Action | `download @ref` + `wait --download` | PARTIEL | Téléchargements Chromium dans `~/Downloads` | Le bot ne sait pas quand un téléchargement est fini ni où | S |
| Action | `mouse move/down/up/wheel` (+ mouvement « humain ») | PARTIEL | xdotool (linux.ts:695-727) | Mouvement « humain » : NON REPRIS (contournement anti-robot) | — |
| Action | `clipboard read/write/copy/paste` | PARTIEL | xclip dans l'image (docs/ORDINATEUR.md) via le terminal | Pas d'outil | S |
| Action | `pushstate` (navigation SPA) | NON REPRIS | — | Développeur | — |
| Action | `eval` JavaScript | NON REPRIS | Absent volontairement | — | — |
| Action | `batch` (plusieurs commandes en un appel) | MANQUANT | `PARALLEL_SAFE` pour lectures seulement (loop.ts:1537) | Remplir un formulaire en un tour | M |
| Action | Chaînage de commandes | NON REPRIS | — | — | — |

### Attendre

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Attente | `wait <sélecteur>` (+ `--state hidden`) | MANQUANT | — | Attendre qu'un spinner disparaisse | S |
| Attente | `wait --text` | MANQUANT | — | — | S |
| Attente | `wait --url "**/dash"` | MANQUANT | — | Savoir que la connexion a abouti | S |
| Attente | `wait --load domcontentloaded/load/networkidle` | MANQUANT | Pause fixe 4 s (linux.ts:689) | — | S |
| Attente | `wait --fn` condition JS | NON REPRIS | — | JS libre | — |
| Attente | Consigne « ne jamais prendre de capture pour savoir si la page a fini » (skill core) | DIFFÉRENT | Capture après chaque action | Coût image | M |

### Onglets, dialogues

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Onglets | `tab` liste, `tab new [--label]`, changer, fermer ; ids stables | MANQUANT | `pages[0]` partout | Voir bug vérifié du 2ᵉ navigateur | S |
| Onglets | Refs liées à leur onglet | MANQUANT | Snapshot lié à l'id d'onglet (elements.ts `target`) : refus si l'onglet a changé | — | — |
| Onglets | Réveil d'un onglet « jeté » par Chrome | MANQUANT | — | — | S |
| Onglets | `tab keep live/frozen` (onglet de fond à pleine vitesse) | NON REPRIS | — | Rare | — |
| Onglets | `window new` | NON REPRIS | — | — | — |
| Dialogues | `alert`/`beforeunload` acceptés automatiquement ; `confirm`/`prompt` à traiter ; **avertissement dans chaque réponse** | MANQUANT | — | Vérifié : tout se fige 15 s | S |

### Captures, vidéo, PDF, comparaison

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Capture | `screenshot` (fichier, format, qualité) | PARTIEL | `screen_view` JPEG q70 plein écran | Choix de format/qualité | S |
| Capture | `--full` pleine page | MANQUANT | — | — | S |
| Capture | **`--annotate`** : numéros dessinés sur les éléments, liés aux refs | MANQUANT | — | Le meilleur des deux : image + refs ; idéal pour les icônes sans nom et les canvas | M |
| Capture | **`--if-changed` / `--threshold`** : pas d'image si rien n'a changé | MANQUANT | — | Économie directe de jetons d'image (Sklubot renvoie une image même identique) | S |
| Capture | `pdf` de la page | PARTIEL | LibreOffice pour documents (`office_*`) ; pas de PDF d'une page web | Imprimer une page en PDF pour l'utilisateur | S |
| Vidéo | `record start/stop` WebM/MP4 avec curseur, planche-contact | PARTIEL | `frame()` 960 px pour démonstration (linux.ts:762) ; ffmpeg dans l'image | Vidéo d'une tâche à livrer | M |
| Comparaison | `diff snapshot` (structure), `diff screenshot` (pixels), `diff url` | MANQUANT | — | « Qu'est-ce qui a changé sur cette page depuis hier ? » (veille) | M |

### Réseau, état, réglages

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Réseau | `network requests` (filtres URL/type/méthode/statut), `network request <id>` | MANQUANT | — | Trouver l'API derrière une page | M |
| Réseau | `network har start/stop` | MANQUANT | — | Base du skill `derive-client` | M |
| Réseau | `network route` (bloquer/simuler) | NON REPRIS | — | Développeur (bloquer les pubs : IDÉE) | — |
| État | `cookies` lire/poser/effacer | PARTIEL | « Effacer » l'ordinateur (docs/ORDINATEUR.md) | Déconnecter un seul site sans tout effacer | S |
| État | `storage local/session` | NON REPRIS | — | — | — |
| État | `state save/load` (exporter la session de connexion) | DIFFÉRENT | Le profil du navigateur vit dans le volume du bot (linux.ts:409) | Rien de perdu | — |
| État | `--restore` persistance de session, arrêt après 1 h d'inactivité | DIFFÉRENT | Mise en veille/réveil des ordinateurs (linux.ts:313-370) | — | — |
| État | `profiles` (réutiliser un profil Chrome existant) | NON REPRIS | — | — | — |
| Réglages | `set viewport/device` (ex. « iPhone 14 ») | MANQUANT | Résolution fixe | Vérifier une page en mobile | M |
| Réglages | `set geo`, `set offline`, `set headers`, `set credentials` (HTTP basic) | MANQUANT | — | HTTP basic : utile pour sites protégés | S |
| Réglages | `set media dark/light` | MANQUANT | — | — | S |
| Réglages | Scripts d'init (`initScripts`) | NON REPRIS | — | — | — |
| Réglages | Proxy et certificats AC (`proxy.mdx`) | NON REPRIS | — | — | — |

### Débogage, performance

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Débogage | `console`, `errors` (erreurs de page) | MANQUANT | — | Erreurs JS des pages que le bot construit | M |
| Débogage | `highlight` (surligner un élément pour l'humain) | MANQUANT | — | L'utilisateur qui regarde l'écran du bot verrait où il va cliquer | S |
| Débogage | `inspect` (ouvrir DevTools) | NON REPRIS | — | — | — |
| Performance | `trace`, `profiler start/stop` | MANQUANT | — | — | M |
| Performance | `vitals` (LCP, CLS, INP) | MANQUANT | — | Bot SEO | S |
| Performance | `react tree/inspect` | NON REPRIS | — | Développeur | — |
| Audit | `a11y` (audit d'accessibilité) | MANQUANT | — | — | M |

### Sécurité

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Sécurité | **Coffre d'identifiants** : le modèle ne voit jamais le mot de passe | FAIT | `vault_type` tools.ts:660 (« You never see the password ») | — | — |
| Sécurité | `auth login` : remplit en filtrant les champs visibles/actifs, échoue si le champ est remplacé ou vole le focus | PARTIEL | `vault_type` tools.ts:660-690 : vérifie que l'hôte de l'onglet (lu par `screen.read` → `page-text.py`, onglet `pages[0]`) correspond au site enregistré, puis tape avec xdotool dans **la fenêtre qui a le focus** | (1) le contrôle porte sur l'onglet de la liste CDP, pas sur le champ focalisé : une iframe d'une autre origine ou une autre fenêtre peut recevoir la frappe ; (2) **combiné au bug du 2ᵉ navigateur**, `page-text.py` rapporte l'URL de l'ancienne page (vérifié) : si la 1ʳᵉ page était le vrai site et la 2ᵉ une imitation, le contrôle passe et le mot de passe est tapé dans l'imitation | S |
| Sécurité | `--no-navigate` : vérifie schéma+hôte+port de la page **avant chaque champ** | MANQUANT | — | Même trou que ci-dessus | S |
| Sécurité | Chiffrement AES-256-GCM des profils + droits 600 | FAIT (esprit) | Coffre côté serveur, jamais dans l'ordinateur du bot (docs/ORDINATEUR.md) | — | — |
| Sécurité | Plugins de coffre externes (`credential.read`) | NON REPRIS | Coffre Sklubot | — | — |
| Sécurité | **Liste de domaines autorisés** (navigations, sous-ressources, WebSocket, EventSource, sendBeacon, WebRTC coupé) | PARTIEL | Après contenu extérieur, un **nouvel hôte** via `browser_open`/`web_fetch` demande l'accord (loop.ts:1296-1306) | Un **clic sur un lien** vers un autre site (`element_click`/`screen_click`) n'est pas soumis à cette règle ; pas de liste réglable par l'utilisateur | M |
| Sécurité | **Politique d'actions** (`--action-policy`, catégories) | DIFFÉRENT | Approbations par outil, règles, irréversibilité (authorize.ts) | Sklubot plus riche | — |
| Sécurité | **Confirmation** (`--confirm-actions`, `confirm`/`deny`, refus auto après 60 s, refus si pas de terminal) | DIFFÉRENT | Cartes d'accord dans l'interface, attente longue | — | — |
| Sécurité | Politique et liste **conservées après plantage du démon** (fichier `.settings` 600, refus de démarrer s'il est corrompu) | FAIT (esprit) | Règles en base de données | — | — |
| Sécurité | Config du projet : seules quelques clés inoffensives acceptées | FAIT (esprit) | Le bot ne peut pas changer ses réglages de sécurité (`self_update` sous accord) | — | — |
| Sécurité | Avertissement de version de Chrome vulnérable (CVE) | MANQUANT | Chromium de Debian figé dans l'image | Savoir quand reconstruire l'image (Chromium plein de failles connues = risque réel pour un navigateur qui visite tout) | S |
| Sécurité | Vérification de capacité des plugins | NON REPRIS | — | — | — |

### Intégrations, observation, installation

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Intégration | `skills get core` : consigne livrée avec la version de la CLI | IDÉE / PARTIEL | Descriptions d'outils + guides (`guide_read`) | — | — |
| Intégration | `mcp` serveur MCP (profils d'outils) | DIFFÉRENT | Outils natifs | — | — |
| Intégration | `webmcp list/invoke` | MANQUANT | — | Voir chrome-devtools-mcp | M |
| Intégration | `flow` : tâche enregistrée une fois, rejouée en HTTP direct d'abord, la page en secours (expérimental) | MANQUANT | Routines (`routine_create`) qui refont tout au modèle | Routines quotidiennes moins chères et plus fiables | L |
| Intégration | `chat` (langage naturel via passerelle Vercel) | NON REPRIS | — | Payant, doublon de Sklubot | — |
| Intégration | `plugin` (fournisseur de navigateur, captcha, furtivité) | NON REPRIS | — | Résolution de captcha / furtivité : contourne des protections | — |
| Intégration | Électron (piloter VS Code, Slack, Discord par CDP) | MANQUANT | Companion : pixels seulement sur l'ordinateur de l'utilisateur | Piloter une appli Electron par références | L |
| Moteurs | Lightpanda, Obscura, Safari iOS, WebDriver | NON REPRIS | — | — | — |
| Fournisseurs | Browserbase, Browserless, Browser Use, Kernel, AgentCore | NON REPRIS | Un ordinateur par bot chez soi | Payants | — |
| Observation | `stream` (WebSocket image + entrées, « navigation à deux ») | FAIT | VNC regarder/contrôler (`docker/desktop/screen-relay.sh`), prise de main | — | — |
| Observation | `dashboard` (vue en direct + fil des commandes) | FAIT | Panneau Ordinateur + étapes de la conversation | — | — |
| Installation | `install`, `--with-deps`, `upgrade`, `doctor` | PARTIEL | `linuxReady`, `ready()` relance le navigateur (linux.ts:788) | Un « doctor » : port 9222, profil, son, disque | S |
| Sessions | `--session` isolées, `session id --scope worktree` | DIFFÉRENT | Un ordinateur par bot | — | — |
| Fiabilité | Démon qui garde le navigateur entre commandes | FAIT | Chromium persistant dans l'ordinateur | — | — |
| Fiabilité | Tests e2e réels + tests de parité | PARTIEL | elements.test.ts, linux.test.ts | Pas de test 2 onglets / dialogue / iframe / bouton couvert | S |
| Bench | `benchmarks/`, `evals/` | MANQUANT | — | Mesurer la réussite des tâches web des bots | M |

### Skills (11)

| Skill | Ce qu'il fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| `skills/agent-browser` | Talon qui renvoie vers `skills get core` | Apache-2.0 | — | NON (spécifique CLI) |
| `core` | Boucle snapshot→ref→action→re-snapshot, attente, auth, sessions ; « préférer le snapshot, capture seulement si demandé » | Apache-2.0 | Descriptions tools.ts ; `methode-de-travail` (catalog.json) | ADAPTER : intégrer les règles « pas de capture pour vérifier », « re-snapshot après navigation » dans la consigne des outils écran |
| `dogfood` | Exploration/QA d'une appli web avec rapport de bugs | Apache-2.0 | Aucun | ADAPTER : modèle « Testeur de site » pour les pages que le bot publie |
| `derive-client` | Enregistrer le trafic (HAR) puis générer un client d'API sans navigateur | Apache-2.0 | Aucun | IDÉE (respecter les conditions des sites) |
| `electron` | Piloter des applis Electron par CDP | Apache-2.0 | Companion pixels | IDÉE |
| `slack` | Tâches Slack via le navigateur | Apache-2.0 | Connecteurs Slack officiels | NON (API officielle préférable) |
| `modern-web-guidance` | Bonnes pratiques web + vérification dans le navigateur | Apache-2.0 | `frontend-design`, `pages-soignees` | IDÉE (étape de vérification) |
| `webmcp-gen` | Créer des outils WebMCP pour une page | Apache-2.0 | — | NON pour l'instant |
| `vercel`, `vercel-sandbox`, `agentcore` | Hébergeurs spécifiques | Apache-2.0 | — | NON (plateformes payantes) |

## Peut-on l'installer dans l'image des bots ?

Techniquement oui : binaire Rust (npm `agent-browser`), branché sur le Chromium existant avec `--cdp 9222` (pas besoin
de télécharger Chrome for Testing). Il resterait dans le conteneur sans privilèges.

**Mais à ne pas faire tel quel.** Le bot l'utiliserait par `shell_run` : `agent-browser --cdp 9222 click @e5`. Les
clics passeraient alors **hors** des protections de Sklubot (lien du clic engageant à l'accord, irréversibilité,
« l'utilisateur conduit » de tools.ts:255). Ce contournement existe déjà en théorie (le bot a un terminal root et le
port 9222 est ouvert dans son ordinateur ; `shell_run` est `sensitive`, tools.ts:303, mais beaucoup d'utilisateurs le
mettent en « Toujours ») ; installer cette CLI le rendrait trivial. Mieux : reprendre ses idées dans les outils natifs.
Si on l'installe quand même, n'exposer que la lecture (`read`, `snapshot`, `console`, `network requests`, `vitals`).

### Ce que renvoie Sklubot vs ce que renvoie l'outil

| Action | Sklubot | agent-browser |
|---|---|---|
| Snapshot | `[ab12.3] button ""` pour une icône | `- button [ref=e3] hint="icon:fa-heart; in:Blue mug"` |
| Clic sur bouton couvert | « Clicked button "Envoyer" » + capture (le bandeau a reçu le clic) | Refus : « Cannot confirm which element would receive a click… » |
| Après un clic | Capture plein écran systématique | Texte court ; capture seulement si demandée, `--if-changed` |
| Dialogue ouvert | Blocage 15 s puis trace Python | `warning` dans chaque réponse ; alertes acceptées seules |
| Lecture d'article | innerText brut | Markdown du serveur si dispo, `llms.txt`, plan des titres |

## Écarts de comportement

1. **Bouton couvert (bandeau cookies, fenêtre modale).** agent-browser : test du point de clic avec
   `DOM.getNodeForLocation`, puis vérification dans un monde isolé que le nœud touché est la ref, un enfant ou son
   `<label>` (`click_point.rs:221-306`) ; sinon refus clair. Sklubot : `Input.dispatchMouseEvent` au centre de la boîte
   (screen-elements.ts `act`, branche `click`) sans test. **Correction (S)** : avant le clic, `DOM.getNodeForLocation(x,y)`
   et `DOM.describeNode` ; si le nœud n'est ni la ref ni un descendant, ne rien faire et répondre « couvert par … ».
   Indispensable pour que l'accord donné à un clic engageant corresponde à l'élément vraiment cliqué.
2. **Boutons sans nom.** agent-browser ajoute un indice lu dans le DOM (icône, image, `name`, `id`, texte de la ligne).
   Sklubot : `button ""`. **Correction (M)** : dans `snapshot()`, pour un nom vide ou en double, lire `data-testid`,
   `name`, `id`, `aria-*`, le nom de l'icône SVG et le texte de la ligne `tr/li/article` parente.
3. **Rafraîchissement d'une partie de page.** agent-browser garde les refs des éléments qui survivent et retrouve un
   élément remplacé par rôle+nom s'il est unique. Sklubot jette tout au moindre nouveau snapshot et refuse si le
   document change. **Correction (S)** : refs = `backendNodeId` tant que le `loaderId` ne change pas ; repli rôle+nom
   unique pour les éléments remplacés (jamais pour un clic engageant).
4. **Coût des images.** agent-browser : « ne jamais capturer pour vérifier », `--if-changed`. Sklubot : une image après
   chaque action. **Correction (M)** : les actions par référence renvoient du texte ; `screen_view` saute l'image si
   l'écran est identique à la dernière envoyée (hachage), en le disant.
5. **Connexion avec le coffre.** agent-browser vérifie l'origine de la page avant **chaque** champ et échoue si le champ
   change. Sklubot : `vault_type` compare l'hôte de l'onglet `pages[0]` au site enregistré (bien), puis tape au clavier X
   dans la fenêtre focalisée (tools.ts:676-688). Avec le bug du 2ᵉ navigateur, l'hôte lu est celui de l'**ancienne**
   page. **Correction (S)** : taper par CDP (`Input.insertText`) dans l'onglet vérifié, après avoir lu
   `document.activeElement` (type `password`/`email`/`text`, visible, dans la frame principale de la même origine) ; et
   corriger le 2ᵉ navigateur.
6. **Lien vers un autre site après contenu extérieur.** agent-browser : liste de domaines appliquée au réseau. Sklubot :
   la demande d'accord « nouvel hôte » ne vaut que pour `browser_open`/`web_fetch` (loop.ts:1296). **Correction (M)** :
   après un clic, comparer l'hôte de l'onglet avant/après ; si c'est un nouvel hôte dans un tour « teinté », le signaler
   ou demander avant de continuer.
7. **Tâche répétée chaque jour.** agent-browser `flow` : enregistrée une fois, rejouée en HTTP, la page en secours.
   Sklubot : la routine refait tout au modèle. **Correction (L)** : enregistrer la suite d'actions par références d'une
   routine réussie et la rejouer, le modèle n'intervenant qu'en cas d'écart.

## À faire (classé)

1. Test du point de clic (élément couvert) avant `element_click`, et pour un clic engageant refuser si le receveur diffère (S). — **FAIT (2026-11-22)** : test du point de clic (`document.elementFromPoint` — `DOM.getNodeForLocation` prend des coordonnées de document une fois la page défilée) avant chaque `element_click`, refus en nommant ce qui couvre ; clic engageant revérifié (libellé + site) sur le même onglet juste avant (`screen-elements.ts`, test `browser-tabs.test.ts`)
2. Corriger le 2ᵉ navigateur (`open-browser.sh`/`dress.py`) et gérer les dialogues (voir AUDIT-CHROME-DEVTOOLS-MCP) (S). — **FAIT (2026-11-22)** : `open-browser.sh` ouvre un onglet par CDP si le navigateur répond, `dress.py` ne touche plus le verrou d'un navigateur vivant ; dialogues : veilleur + `browser_dialog` (`browser-cdp.ts`)
3. `vault_type` : taper par CDP dans l'onglet vérifié, après contrôle du champ focalisé (le contrôle d'hôte actuel peut être trompé par le bug du 2ᵉ navigateur) (S). — **FAIT (2026-11-22)** : `Input.insertText` dans l'onglet actif après contrôle du site de la page et de chaque cadre jusqu'au champ, mot de passe seulement dans un champ mot de passe (`tools-browser.ts` `typeSecret`)
4. Indices pour boutons sans nom ou en double dans `element_snapshot` (M). — **FAIT (2026-11-22)** : `HINT_FUNCTION` d'agent-browser repris tel quel (`screen-elements.ts`), `hint="icon:…; in:…"` (L74)
5. Refs stables + récupération rôle+nom unique (S). — **FAIT (2026-11-22)** : même numéro pour le même élément tant que le document ne change pas, élément redessiné retrouvé par rôle + nom unique, jamais pour un clic engageant (`agent/elements.ts`, `screen-elements.ts` `check_node`)
6. Iframes dans le snapshot, refs utilisables directement (M). — **FAIT (2026-11-22)** : PARTIEL : cadres du même site listés et utilisables (« in frame ») ; cadres d'un autre site signalés, non listés
7. Actions par référence sans capture ; `screen_view` qui saute une image identique (M). — **FAIT EN PARTIE (2026-11-22)** : `browser_open` et actions par référence en texte avec « ce qui a changé » (L65) ; `screen_view` envoie toujours l'image
8. Outil d'attente (`wait` texte / URL / disparition / chargement) (S). — **FAIT (2026-11-22)** : `browser_wait` (L75)
9. Outil onglets (lister, ouvrir, activer, fermer) (S). — **FAIT (2026-11-22)** : `browser_tabs`, `browser_tab` (activer, fermer), `browser_open` `new_tab` ; nouvel onglet suivi seul
10. Nouvel hôte atteint par un clic dans un tour teinté : signaler/demander (M).
11. `check`/`uncheck`, `hover`, `upload`, fin de téléchargement (S à M). — **FAIT EN PARTIE (2026-11-22)** : cases via `element_fill`, `element_hover`, `element_upload` (accord à chaque fois) ; fin de téléchargement non faite
12. Capture annotée (numéros = refs) pour icônes et canvas (M).
13. `web_fetch` : `Accept: text/markdown`, essai `.md`, `llms.txt` (S).
14. `-u` adresses des liens et `-s` portée dans le snapshot (S). — **FAIT EN PARTIE (2026-11-22)** : adresses des liens (`→ /chemin`) ; pas de portée `-s`
15. Comparaison de page (structure/pixels) pour la veille (M).
16. Avertissement « Chromium de l'image en retard de N failles » côté admin (S).
17. Rejeu de routines enregistrées (« flows ») (L).
18. Skill « Testeur de site » adapté de `dogfood` (M).

## Non vérifié

- Le comportement réel d'`element_click` sur un bouton couvert n'a pas été testé dans un conteneur (déduit du code :
  aucun test de point de clic dans `ELEMENTS_PY`).
- La chaîne « 2ᵉ navigateur + `vault_type` » est déduite de deux faits vérifiés séparément (URL de l'ancienne page
  rapportée par `page-text.py` ; frappe xdotool dans la fenêtre focalisée), pas rejouée de bout en bout.
- Le code Rust n'a été lu que pour `click_point.rs` ; le reste vient de la documentation du dépôt.
- `flow` est marqué expérimental ; sa robustesse n'est pas connue.
