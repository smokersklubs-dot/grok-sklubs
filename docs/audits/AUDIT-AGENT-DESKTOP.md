# Audit : vercel-labs/agent-desktop face à l'ordinateur des bots et au Relais Sklubot

Type : **OUTIL** (CLI Rust + bibliothèque C + serveur MCP : piloter les applications de bureau macOS / Windows / Linux
par l'arbre d'accessibilité du système, sans captures). 6 skills.
Clone superficiel lu le 2026-11-22, jamais exécuté, supprimé après écriture.

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 12 | 20 | 24 | 5 | 5 |

(66 lignes + 6 skills.)

## Licence

`LICENSE` : **Apache License 2.0**. Usage, modification, redistribution et intégration (même commerciale) permis avec
la notice et la mention des changements. Les skills sont sous la même licence. Le skill `jev-desktop` exige une clé
`TYPESAFE_API_KEY` d'un service payant : non repris.

## Où Sklubot pilote un bureau aujourd'hui

1. **L'ordinateur Linux du bot** (`docker/desktop/Dockerfile`, Debian bookworm, Xvfb + openbox) : hors navigateur
   (terminal xterm, pcmanfm, mousepad), uniquement des **pixels** : `screen_view` / `screen_click` / `screen_type` /
   `screen_key` via xdotool (`server/src/linux.ts:676-735`). Les références d'éléments n'existent que pour la page web
   (`server/src/screen-elements.ts`).
2. **L'ordinateur de l'utilisateur** via le Relais Electron (`companion/src/main/capabilities/desktop.js`) : capture
   `desktopCapturer`, souris/clavier `@jitsi/robotjs`, liste de fenêtres (titres), mise au premier plan, ouverture
   d'appli/URL, shell sous double accord (`shell.js`), fichiers partagés (`files.js`). Outils `my_*`
   (`server/src/agent/mycomputer.ts:317-544`). **Pixels seulement sur ordinateur** ; sur téléphone Android, `my_windows`
   donne déjà « le texte et les contrôles à l'écran » (mycomputer.ts:494).

C'est surtout pour **le Relais (ordinateur de l'utilisateur)** que ce dépôt compte : il apporte ce qui manque le plus,
voir les contrôles d'une application de bureau par leur nom.

## Tableau complet

### Observer

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Observer | `snapshot --app X` : arbre d'accessibilité JSON, ref par élément actionnable | MANQUANT | Bureau : capture seulement (`desktop.js` `capture`) ; navigateur du bot : `element_snapshot` | Sur Mac/Windows de l'utilisateur, le bot clique à l'aveugle sur une image | L |
| Observer | Refs qualifiées par snapshot (`@s8f3k2p9:e8`), refus d'une ref nue | FAIT (même idée) | `xxxx.N` liée à son snapshot (`server/src/agent/elements.ts:39-48`) | — | — |
| Observer | `-i` interactifs, `--compact`, `--max-depth`, `--skeleton` puis `--root @ref` (exploration par zones) | PARTIEL | `limit` (tools.ts:212) | Exploration par zones pour les applis denses | M |
| Observer | Observation partielle (temps épuisé) signalée nœud par nœud | MANQUANT | — | Sklubot coupe à 400 éléments sans dire où | S |
| Observer | `find` (rôle, nom, texte) | MANQUANT | — | — | M |
| Observer | `get` / `is` (valeur, état) | PARTIEL | États dans le snapshot web | Bureau : rien | M |
| Observer | `screenshot` d'une fenêtre / d'un écran choisi, identité vérifiée avant et après la capture (« identity sandwich ») | PARTIEL | Capture de l'écran principal (desktop.js `grab`, écran principal seulement) ; bot : `import -window root` | Écran secondaire ; capture d'une fenêtre ; preuve que l'image est bien celle de la fenêtre visée | M |
| Observer | `list-surfaces` (menus, feuilles, alertes ouvertes) | MANQUANT | — | Le bot ne sait pas qu'une boîte « Enregistrer ? » attend | M |
| Observer | Rôles, états et noms normalisés sur les 3 systèmes ; « Connu / Absent / Inconnu » jamais confondus | MANQUANT | — | — | L |
| Observer | Indicateur « web wrapper » (ignore les conteneurs vides des applis Electron) | MANQUANT | — | — | M |

### Agir sur une ref

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Action | `click` / `double-click` / `triple-click` / `right-click` par ref | PARTIEL | Web : `element_click` ; bureau : pixels (`my_click`, `screen_click`) | Bureau par ref | L |
| Action | **Sans bouger la souris ni prendre le focus** (« headless », API d'accessibilité) | MANQUANT | robotjs déplace la vraie souris de l'utilisateur (desktop.js `mouseClick`) | L'utilisateur ne peut pas travailler pendant que le bot agit ; Sklubot verrouille donc l'appareil (`my_computers` « controlled by a bot ») | L |
| Action | `type`, `set-value`, `clear` ; `--stdin` pour garder le texte hors de la liste des processus | PARTIEL | `my_type` robotjs ; bot : TYPER par stdin (linux.ts:615, texte jamais dans la liste des processus) | Par ref sur le bureau | M |
| Action | `select`, `toggle`, `check`/`uncheck` idempotents, `expand`/`collapse` | MANQUANT | — | — | M |
| Action | `focus`, `scroll`, `scroll-to` | PARTIEL | `my_scroll`, `screen_scroll` | Par ref | M |
| Action | **Contrôles avant action** : visible, stable, actif, reçoit les événements (sinon « masqué par <rôle> »), budget 5 s, sondage 100 ms | PARTIEL | Web : désactivé refusé, défilement auto (screen-elements.ts `act`) | Pas de « stable », pas de test « masqué » (voir AUDIT-AGENT-BROWSER), rien côté bureau | M |
| Action | **Vérification après action** : l'état est relu ; contradiction = `ACTION_FAILED` ; `delivered_verified` / `delivered_unverified` | MANQUANT | Capture après action, le modèle juge | Le bot croit souvent qu'un clic a marché | M |
| Action | Champ secret masqué dans les résultats (`secure_field`) | FAIT (esprit) | `vault_type` : le bot ne voit jamais le mot de passe (tools.ts:660) | — | — |
| Action | `--wait-for` / `--wait-for-gone` après une action | MANQUANT | Pauses fixes | — | S |
| Action | `disposition.retry` = `safe`/`unsafe` dans chaque erreur | PARTIEL | Exécutions « incertaines » jamais rejouées seules, carte « est-ce passé ? » (`server/src/agent/executions.ts:15,75-83`) — pour les actions externes seulement | Les clics/frappes ordinaires n'ont pas cette info | S |
| Action | Observation après livraison incertaine (processus planté, figé, fermé) | MANQUANT | — | « L'appli a planté » au lieu d'un échec muet | M |
| Action | Codes d'erreur fermés avec remède (`STALE_REF`, `AMBIGUOUS_TARGET`…) | PARTIEL | Messages clairs pour refs web (elements.ts:41-54) | Bureau : erreurs brutes (« permission missing ») | S |
| Action | **Ambiguïté refusée** (deux éléments identiques : pas de devinette) | MANQUANT | — | Utile avec les « indices » (AUDIT-AGENT-BROWSER) | S |

### Clavier, souris

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Entrée | `press` combinaisons, rapporte `delivered_unverified` | FAIT | `my_key`, `screen_key` | Le résultat ne dit pas « non vérifié » | — |
| Entrée | **Raccourcis dangereux refusés** sauf `--force` (Linux : Alt+F4/Tab/F2, Super+L/D/Tab, Ctrl+Alt+T/Retour/Suppr/L, Ctrl+Alt+Fn terminaux virtuels, Super seul — `crates/linux/src/input/blocked_combo.rs`) | MANQUANT | Aucun filtre dans `my_key` ni `desktop.js` `keyPress` | Sur l'ordinateur de l'utilisateur, un bot peut fermer une appli (Alt+F4, Cmd+Q), verrouiller la session ou changer de terminal sans contrôle propre | S |
| Entrée | `hover`, `drag`, `mouse-move/click/wheel` (`--headed`) | FAIT | `my_point` (pointe sans cliquer), `my_drag`, `my_scroll`, `screen_*` | — | — |
| Entrée | `key-down`/`key-up`/`mouse-down`/`mouse-up` refusés tant qu'aucun démon ne peut relâcher | FAIT (esprit) | `mouseDrag` relâche toujours le bouton dans `finally` et s'arrête si la session change (desktop.js `mouseDrag`) | — | — |
| Entrée | Physique seulement avec `--headed` (politique) | DIFFÉRENT | Session de contrôle accordée par l'utilisateur, verrouillable | — | — |

### Applications, fenêtres, écrans

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Fenêtres | `launch`, `close-app` (processus système protégés) | PARTIEL | `my_open` (lancer) desktop.js `openApp` | Fermer une appli proprement | S |
| Fenêtres | `list-apps`, `list-windows` (ids opaques, identité corroborée par le processus) | PARTIEL | `my_windows` titres (desktop.js `listWindows`) | Ids sûrs : un titre peut viser la mauvaise fenêtre | M |
| Fenêtres | `focus-window` | FAIT | `my_window_focus` (AppActivate / `open -a` / wmctrl) | Sur Mac : l'appli, pas la fenêtre | — |
| Fenêtres | `move/resize/minimize/maximize/restore` avec vérification | MANQUANT | — | — | M |
| Écrans | `list-displays`, identité d'écran vérifiée | PARTIEL | `screenInfo` (nombre d'écrans) | Agir sur un 2ᵉ écran | M |
| Système | `open-system-surface` (zone de notification, centre d'action) | NON REPRIS | — | Faible valeur, fragile | — |

### Notifications, presse-papiers, attente

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Notifs | `list-notifications`, `dismiss…`, `notification-action` (GNOME seulement sous Linux) | MANQUANT | — | Lire un code 2FA reçu en notification sur le PC (avec accord) | M |
| Presse-papiers | `clipboard-get/set/clear` (texte, images, fichiers) | PARTIEL | xclip dans l'ordinateur du bot (docs/ORDINATEUR.md) | Rien sur l'ordinateur de l'utilisateur (volontaire ? le presse-papiers peut contenir des secrets) | M |
| Attente | `wait` ms / `--element` / `--window` / `--text` / `--menu` / `--event` / `--notification` | MANQUANT | — | Attendre qu'une fenêtre s'ouvre | M |
| Attente | Appli web (Electron) : attendre 3 lectures identiques avant de croire la fenêtre prête | MANQUANT | — | — | S |

### Sessions, traces, observation

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Session | `session` (espace de noms des snapshots, agent id) | DIFFÉRENT | Un bot = une session de contrôle par appareil | — | — |
| Trace | `trace` (journal des commandes) | FAIT | `companion/src/main/action-log.js` + étapes dans la conversation | — | — |
| Trace | Artefact visuel de débogage (snapshot + cadres étiquetés, avant/après) | MANQUANT | — | Montrer à l'utilisateur où le bot a cliqué | M |
| Curseur | `cursor-overlay` (curseur de l'agent visible) | FAIT | `companion/src/main/bot-pointer.js`, `my_point` | — | — |
| Batch | `batch` (plusieurs commandes ; texte visible dans les arguments) | MANQUANT | — | — | M |
| Bacs à sable | `sandbox create/start/stop/rm/exec` (bureau séparé géré par un fournisseur, `exec` limité à 300 s, sans shell) | DIFFÉRENT | Ordinateur Linux par bot en conteneur (linux.ts) | Sklubot a déjà mieux pour le bot ; rien pour « une VM Windows » | — |
| Statut | `status`, `permissions --guide` (accorder l'accessibilité sur macOS pas à pas) | PARTIEL | Erreur `permission_missing` claire (desktop.js `missing`) | Guide pas à pas dans le Relais | S |
| Skills | `skills get desktop/platform` livrés avec la version | DIFFÉRENT | Descriptions d'outils | — | — |
| MCP | `agent-desktop mcp` (chaque commande = un outil) | DIFFÉRENT | Protocole Relais propre | — | — |
| FFI | Bibliothèque C (`libagent_desktop_ffi`) appelable en processus | MANQUANT | — | C'est la voie la plus simple pour le Relais (Electron peut appeler un binaire ou une lib) | — |

### Fiabilité et sécurité internes

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Fiabilité | **Résolution stricte des refs** : identité stockée (rôle, nom stable, id natif, fenêtre+processus), refus si manquant/périmé/ambigu | PARTIEL | Web : même onglet, même document, même rôle+nom (screen-elements.ts `act`) | Rien sur le bureau | — |
| Fiabilité | Identité de fenêtre = handle + génération de processus (handles recyclés) | MANQUANT | Titres seulement | Viser la mauvaise fenêtre après fermeture/réouverture | M |
| Fiabilité | Valeurs modifiables (texte d'un champ) jamais utilisées comme identité | FAIT (esprit) | `value` affichée mais l'identité = rôle + nom (screen-elements.ts) | Le **nom** accessible d'un champ peut contenir sa valeur sur certains sites : non traité | S |
| Fiabilité | Fenêtre bloquée sur la fenêtre d'origine pour les attentes | MANQUANT | — | — | S |
| Fiabilité | Tests e2e sur vraies applis, appli « fixture » Windows, sondes par OS (`probes/*/FINDINGS.md`) | PARTIEL | Tests réels Linux pour le navigateur du bot (elements.test.ts) ; aucun test réel du Relais sur Mac/Windows | — | M |
| Fiabilité | `deny.toml` (audit des licences et dépendances Rust) | PARTIEL | — | Pas d'audit de licences automatique visible dans Sklubot | S |
| Sécurité | Avertissement : snapshots/presse-papiers/captures contiennent du privé, pas dans les journaux publics | FAIT | Masquage des secrets (`redactSecrets`, `pastedsecrets.ts`) ; dossiers secrets refusés (files.js `SECRET_NAMES`) | — | — |
| Sécurité | Texte secret par stdin seulement ; batch déconseillé pour les secrets | FAIT | TYPER stdin (linux.ts:610) | robotjs `typeString` côté Relais : texte en mémoire seulement, OK | — |
| Sécurité | Processus système protégés contre `close-app` | NON REPRIS | Pas de fermeture d'appli | — | — |
| Sécurité | Consentement local de l'utilisateur | FAIT | `companion/src/main/consent.js`, verrou d'appareil | — | — |

### Plateformes

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| macOS | AX API, accord Accessibilité | PARTIEL | robotjs + accord Accessibilité/Enregistrement d'écran | Arbre AX | L |
| Windows | UI Automation (+ Chromium/Electron, élévation) | PARTIEL | robotjs, PowerShell AppActivate | Arbre UIA | L |
| Linux | AT-SPI, X11 et Wayland (Ubuntu 24.04+) | PARTIEL | robotjs X11 seulement (pas Wayland natif, desktop.js en-tête) | Wayland | L |
| Linux | Chromium/Electron : drapeaux d'accessibilité nécessaires | NON REPRIS | — | — | — |
| Fournisseurs | `providers/` (bacs à sable) | NON REPRIS | — | — | — |
| Bench | `benchmarks/` | MANQUANT | — | — | M |
| Mobile | — (hors dépôt) | NON REPRIS | Android déjà par le Relais/app | — | — |

### Skills (6)

| Skill | Ce qu'il fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| `agent-desktop` | Boucle observer→agir→vérifier, règles de nouvelle tentative (`retry` seulement si `safe`) | Apache-2.0 | Descriptions des outils `my_*` | ADAPTER : règles « re-observer après action », « ne pas rejouer si incertain » dans la description de `my_click`/`my_type` |
| `agent-desktop-linux` | Particularités AT-SPI, X11/Wayland | Apache-2.0 | — | IDÉE (si on l'essaie dans l'image) |
| `agent-desktop-macos` | Particularités macOS, dépannage | Apache-2.0 | Message « permission missing » | IDÉE (guide d'autorisation dans le Relais) |
| `agent-desktop-windows` | UIA, élévation, Chromium/Electron | Apache-2.0 | — | IDÉE |
| `agent-desktop-ffi` | Lier la bibliothèque C (fils, propriété, erreurs) | Apache-2.0 | — | ADAPTER si le Relais l'embarque |
| `jev-desktop` | Pilote « un objectif en langage naturel » sans montrer l'arbre au modèle | Apache-2.0 (+ clé payante) | La boucle Sklubot elle-même | NON (service payant, doublon) — IDÉE : « une opération et sa cible choisies parmi les seuls éléments compatibles » |

## Peut-on l'installer ?

- **Dans l'image des bots** (`docker/desktop/Dockerfile`) : **pas recommandé maintenant**. Il demande Ubuntu 24.04+
  ou un pont AT-SPI corrigé (`at-spi2-core` commit dc0dc33, `skills/agent-desktop-linux/SKILL.md`), un bus
  d'accessibilité de session (absent de l'image : seul `dbus-x11` est installé), et des applis GTK qui exposent leur
  arbre (xterm n'en a pas ; Chromium demande `--force-renderer-accessibility`). L'image est Debian bookworm. Et le
  bureau du bot sert surtout au navigateur, déjà couvert par CDP. Gain faible, essai coûteux (M), aucun risque pour
  l'hôte (conteneur sans privilèges).
- **Dans le Relais** (ordinateur de l'utilisateur) : **oui, c'est là qu'il apporte le plus** : binaires officiels
  Apache-2.0 pour macOS/Windows/Linux (npm `agent-desktop`) à lancer depuis le processus principal Electron, ou la
  bibliothèque C. Il faudrait garder les règles du Relais (accord local, verrou, journal), appliquer la liste de
  raccourcis dangereux, et ne pas donner `--headed`/`--force` sans accord.

### Ce que renvoie Sklubot vs ce que renvoie l'outil (ordinateur de l'utilisateur)

| Action | Sklubot (Relais) | agent-desktop |
|---|---|---|
| Voir | Image JPEG de l'écran principal | JSON : fenêtre, rôles, noms, états, refs, `complete: true/false` |
| Cliquer | robotjs déplace la vraie souris ; nouvelle capture | Action d'accessibilité sans souris ; `post_state`, `delivered_verified`, surfaces ouvertes |
| Taper | `typeString` au focus | `set-value`/`type` sur la ref, valeur relue (masquée si secrète) |
| Raccourci | Tout passe | Raccourcis dangereux refusés sauf `--force` |
| Erreur | Message brut | Code fermé + remède + `retry: safe/unsafe` |

## Écarts de comportement

1. **Remplir un formulaire dans une appli de bureau de l'utilisateur.** agent-desktop : snapshot → `set-value @ref` →
   état relu → `delivered_verified`. Sklubot : `my_screen` (image) → `my_click` au pixel → `my_type` au focus → nouvelle
   image ; si le clic a raté le champ, le texte part ailleurs (dans une autre fenêtre, une barre de recherche…). Plus
   lent, plus cher, plus risqué. **Correction (L)** : intégrer agent-desktop au Relais : outils `my_elements`,
   `my_element_click`, `my_element_type` à côté des outils pixel.
2. **Raccourcis dangereux sur l'ordinateur de l'utilisateur.** agent-desktop refuse (blocked_combo.rs). Sklubot : aucun
   filtre ; `my_key` est groundable mais une fois la session de contrôle accordée, Alt+F4 / Cmd+Q / Ctrl+Alt+Suppr /
   verrouillage passent. **Correction (S)** : liste de refus dans `companion/src/main/capabilities/desktop.js`
   `keyPress` (décidée côté Relais, comme `files.js`), contournable seulement par un accord explicite sur l'appareil.
3. **Savoir si l'action a marché.** agent-desktop distingue « vérifié », « non vérifié », « incertain » et dit si on peut
   réessayer. Sklubot ne le fait que pour les actions externes réservées (executions.ts). **Correction (S)** : pour
   `element_type`/`element_select`, relire la valeur du champ après coup (CDP) et dire « valeur vérifiée » ou non.
4. **L'utilisateur continue de travailler pendant que le bot agit.** agent-desktop agit sans souris ni focus par
   défaut. Sklubot prend la vraie souris : l'utilisateur doit attendre. **Correction (L)** : avec l'arbre d'accessibilité,
   proposer un mode « en arrière-plan » pour les actions par ref.
5. **Boîte de dialogue ouverte.** agent-desktop renvoie `data.surfaces` (feuille, menu, alerte) après chaque action.
   Sklubot : le modèle doit le voir sur l'image. **Correction (M)** : avec l'arbre, signaler les boîtes ouvertes.

## À faire (classé)

1. Liste de raccourcis dangereux refusés dans le Relais (`desktop.js` `keyPress`), levée seulement par accord sur l'appareil (S).
2. Intégrer agent-desktop (binaire ou lib C, Apache-2.0) au Relais pour Mac/Windows : snapshot + actions par ref sur l'ordinateur de l'utilisateur (L).
3. Vérification après action (valeur relue) pour `element_type`/`element_select` et, plus tard, côté Relais (S).
4. Statut de livraison et « peut-on réessayer » dans les résultats d'action (S).
5. Identité de fenêtre plus sûre que le titre pour `my_window_focus` (M).
6. Guide pas à pas des autorisations macOS dans le Relais (S).
7. Capture d'un écran secondaire ou d'une fenêtre choisie (M).
8. Attente d'une fenêtre / d'un texte côté Relais (M).
9. Artefact visuel « où le bot a cliqué » pour l'utilisateur (M).
10. Essai d'AT-SPI dans l'image du bot (bus d'accessibilité, applis GTK) — seulement si des tâches hors navigateur deviennent fréquentes (M).

## Non vérifié

- Je n'ai pas exécuté agent-desktop ; tout vient de la documentation, de `CONCEPTS.md`, des skills et de
  `blocked_combo.rs`.
- Compatibilité réelle avec Debian bookworm (version d'`at-spi2-core` et correctif dc0dc33) non vérifiée.
- Taille des binaires et signature (Gatekeeper/SmartScreen) quand ils sont lancés depuis le Relais non vérifiées.
- Le Relais n'a pas de tests réels Mac/Windows visibles ; non vérifié s'il en existe ailleurs.
