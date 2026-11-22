# Audit : ChromeDevTools/chrome-devtools-mcp (v1.13.0) face à l'ordinateur des bots Sklubot

Type : **OUTIL** (serveur MCP qui pilote un Chrome par le protocole DevTools, + une CLI + 8 skills).
Clone superficiel lu le 2026-11-22, jamais exécuté, supprimé après écriture.

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 7 | 15 | 35 | 9 | 16 |

(82 lignes de fonctions + 8 skills. Les « MANQUANT » sont surtout des outils de débogage web — console, réseau, performance, mémoire — que Sklubot n'a pas du tout côté navigateur.)

## Licence

`LICENSE` : **Apache License 2.0** (Google LLC). Permet de copier, modifier, redistribuer, y compris en commercial,
à condition de garder la notice de licence et le fichier NOTICE, et de signaler les fichiers modifiés. Les skills
(`skills/*`) sont sous la même licence (aucun fichier de licence séparé). On peut donc **adapter du code** (avec
attribution) et **installer le paquet npm tel quel**.

Attention vie privée : par défaut, `--usageStatistics` est **activé** (statistiques d'usage envoyées à Google) et
`--performanceCrux` est **activé** (les adresses des traces de performance partent vers l'API CrUX de Google). Si on
l'installe chez les bots, il faut lancer avec `--no-usage-statistics --no-performance-crux` (ou la variable
`CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS`).

## Ce que fait Sklubot aujourd'hui (rappel lu dans le code)

- Ordinateur Linux par bot (`docker/desktop/Dockerfile`), Chromium lancé par `docker/desktop/open-browser.sh` avec le
  port de débogage 9222 ouvert.
- Outils pixel : `screen_view`, `browser_open`, `screen_click/type/key/scroll/drag` (`server/src/agent/tools.ts:145-201`,
  exécutés par xdotool dans `server/src/linux.ts:676-735`). Chaque action renvoie **toujours une capture JPEG** de tout
  l'écran (`linux.ts:597`, qualité 70) après une **pause fixe** (700 ms après un clic, 4 s après `browser_open`).
- Outils par référence : `element_snapshot/click/type/select` (`tools.ts:204-252`, `server/src/agent/elements.ts`,
  script Python CDP dans `server/src/screen-elements.ts`). Le snapshot ne liste **que les éléments interactifs** (rôles
  fixes, 400 au plus), une référence `xxxx.N` valable pour **ce snapshot seulement**.
- Lecture : `page_read` = `document.body.innerText` de l'onglet `pages[0]` (`docker/desktop/page-text.py`).
- Sécurité : clic engageant relu dans la page et lié à l'approbation (`server/src/agent/bind.ts`, `authorize.ts:132`),
  irréversibilité (`server/src/agent/irreversible.ts`), conduite par l'utilisateur prioritaire (`tools.ts:255-259`),
  conteneur sans privilèges (`linux.ts:390-419`).
- Tests : `server/test/elements.test.ts` (4 tests, **lancés pendant cet audit : 4/4 OK** sur un vrai conteneur, 11 s).

## Tableau complet des fonctionnalités

Taille : S = moins d'une demi-journée, M = 1 à 3 jours, L = plus.

### Entrée (clavier, souris)

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Entrée | `click` par uid d'élément (+ double-clic) | PARTIEL | `element_click` tools.ts:219 ; screen-elements.ts `act()` ; test elements.test.ts:67 | Pas de double-clic par référence ; pas d'attente de navigation/DOM stable après le clic (pause fixe 700 ms, linux.ts:732) | S |
| Entrée | `click_at(x,y)` (option vision) | FAIT | `screen_click` tools.ts:169, linux.ts:695 ; test wave7-linux.test.ts | — | — |
| Entrée | `drag` d'un élément sur un autre (uid → uid) | PARTIEL | `screen_drag` tools.ts:197 (pixels seulement, 3 points) | Glisser par référence ; drag HTML5 (dragstart/drop) souvent raté avec 3 mouvements xdotool | M |
| Entrée | `fill` (champ, `<select>`, case à cocher "true/false", radio) en un outil | PARTIEL | `element_type` + `element_select` tools.ts:233-251 | Cocher/décocher par valeur voulue (il faut cliquer et deviner l'état) | S |
| Entrée | `fill_form` : plusieurs champs en un appel | MANQUANT | — | Un formulaire de 6 champs = 6 tours de modèle + 6 captures chez Sklubot | M |
| Entrée | `hover` sur un élément | MANQUANT | — (xdotool `mousemove` existe mais aucun outil ne l'expose) | Menus qui s'ouvrent au survol inaccessibles | S |
| Entrée | `press_key` avec combinaisons (Control+Shift+R) | FAIT | `screen_key` tools.ts:187, table KEYSYMS linux.ts:603 | — | — |
| Entrée | `type_text` avec touche finale (Enter/Tab/Escape) | PARTIEL | `element_type` `submit` (Enter seulement) ; `screen_type` | Tab/Escape en fin de saisie | S |
| Entrée | Saisie fiable des caractères accentués | FAIT (mieux) | TYPER linux.ts:615 (remappe des touches libres) ; `Input.insertText` dans element_type | — | — |
| Entrée | `upload_file` (champ fichier ou sélecteur de fichier) | MANQUANT | — | Un bot ne peut pas joindre un fichier de `~/files` à un formulaire web (sauf en pilotant à la main la boîte GTK) | M |
| Entrée | `handle_dialog` (alert/confirm/prompt, beforeunload) | MANQUANT | — | **Vérifié** : avec une `alert()` ouverte, `page-text.py` reste bloqué 15 s puis renvoie une trace Python illisible (`could not read the page: Traceback…`) ; même chose pour `element_snapshot` (même méthode CDP) | S |
| Entrée | Détection d'un dialogue pendant une action (« Action interrompue par un dialogue ») | MANQUANT | — | Le modèle ne sait pas pourquoi la page « ne répond plus » | S |

### Navigation et onglets

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Navigation | `navigate_page` url | FAIT | `browser_open` tools.ts:150, linux.ts:684 ; test linux.test.ts:75 | — | — |
| Navigation | back / forward / reload | PARTIEL | Possible par `screen_key alt+Left`, `F5` | Pas d'outil explicite ; pas de `ignoreCache` | S |
| Navigation | Attente de chargement avec timeout réglable | MANQUANT | pause fixe 4 s linux.ts:689 | Page lente : capture d'une page blanche ; page rapide : 4 s perdues | S |
| Navigation | `initScript` avant tout script de la page | NON REPRIS | — | Risque (exécuter du JS arbitraire) sans besoin utilisateur | — |
| Navigation | `new_page` (nouvel onglet, au premier plan ou en arrière-plan) | DIFFÉRENT | `open-browser.sh` à chaque `browser_open` | **Bug vérifié** : un 2ᵉ `browser_open` alors que Chromium tourne lance un **2ᵉ processus Chromium** sur le même profil (fenêtres « Profile error occurred »), car `dress.py --profile` (appelé par open-browser.sh à chaque ouverture) **efface SingletonLock/Socket/Cookie** du profil vivant (dress.py:295). Le 2ᵉ navigateur n'est pas sur le port 9222 : `page_read`, `element_snapshot` et la relecture du clic engageant lisent **l'ancienne page** pendant que l'écran montre la nouvelle | M |
| Navigation | `list_pages` (onglets + service workers) | MANQUANT | `page-text.py` prend `pages[0]` sans le dire | Le bot ne voit pas ses onglets ; « onglet de devant » supposé = premier de la liste `/json` (non garanti par Chrome) | S |
| Navigation | `select_page` (choisir l'onglet de travail, le mettre devant) | MANQUANT | — | Impossible de revenir proprement sur un onglet ouvert par un lien `target=_blank` | S |
| Navigation | `close_page` (sauf le dernier) | PARTIEL | `ctrl+w` au clavier ; `tidy.sh` ferme tout | Fermer un onglet précis | S |
| Navigation | `wait_for` texte (visible ou non, plusieurs textes) | MANQUANT | — | Le bot boucle sur `screen_view` (coût en images) pour attendre un résultat | S |
| Navigation | Contextes isolés (`isolatedContext` : cookies séparés par onglet) | NON REPRIS | — | Utile au test de connexion ; pour un bot, un seul profil suffit | — |
| Navigation | Routage par `pageId` pour plusieurs agents sur un navigateur | DIFFÉRENT | Un navigateur par bot ; ordinateur partagé : un seul conducteur (linux.ts `SharedComputerInUseError`) | Rien de perdu | — |
| Navigation | `--backgroundNewPages` (ne pas voler le focus à l'humain) | MANQUANT | — | Quand l'utilisateur a la main, un nouvel onglet du bot n'est pas possible (actions refusées, tools.ts:255) : correct mais bloquant | S |
| Navigation | Navigations `file:`, `javascript:`, `data:` interdites sur option | PARTIEL | `browser_open` refuse tout sauf http/https (linux.ts:686) | Rien côté clic dans la page (un lien `javascript:` reste cliquable) | — |

### Lecture de page

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Lecture | `take_snapshot` arbre d'accessibilité complet (titres, textes, champs) | PARTIEL | `element_snapshot` (interactifs seulement) + `page_read` (texte brut) | Une seule vue structurée « titre > paragraphe > bouton » ; le modèle doit croiser deux sorties | M |
| Lecture | uid **stables** entre snapshots (`loaderId_backendNodeId`) | DIFFÉRENT | Référence valable pour un seul snapshot (elements.ts:42) | Après chaque petit changement le bot doit refaire un snapshot complet (tokens) ; plus sûr mais plus cher | M |
| Lecture | Contenu des **iframes** dans le snapshot (`includeIframes`) | MANQUANT | `Accessibility.getFullAXTree` sans `frameId` (screen-elements.ts `snapshot`) | Formulaires de paiement, cookies, captchas, embeds en iframe invisibles pour les références | M |
| Lecture | `verbose` (tout l'arbre) | MANQUANT | — | — | S |
| Lecture | Élément sélectionné dans DevTools signalé | NON REPRIS | — | Pas de DevTools humain chez le bot | — |
| Lecture | Snapshot ou capture **enregistrés dans un fichier** au lieu de la réponse | PARTIEL | `spillIfLong` pour `page_read` (tools.ts:166) | Pas pour les captures ni les snapshots | S |
| Lecture | `take_screenshot` d'un **élément** | MANQUANT | — | Capture d'un graphique ou d'un reçu seul | S |
| Lecture | `take_screenshot` **pleine page** | MANQUANT | — (capture de l'écran X entier) | Livrer une capture d'une page longue | S |
| Lecture | Format/qualité/taille max des captures (`--screenshotMaxWidth`) | PARTIEL | JPEG q70 fixe ; `frame()` réduit à 960 px pour les démos (linux.ts:762) | Réduire les captures envoyées au modèle (les jetons d'image suivent la taille) | S |
| Lecture | `includeSnapshot` facultatif après une action (texte au lieu d'image) | DIFFÉRENT | Toujours une capture après chaque action (tools.ts `shot(...)`) | Coût : une image par clic/frappe, même quand un texte court suffirait | M |
| Lecture | `get_css_styles` (cascade, styles calculés) | PARTIEL | `design_reference_layout` (tools.ts:154, mesures de mise en page) | Styles d'un élément précis | M |
| Lecture | `evaluate_script` (fonction JS avec uid en arguments) | NON REPRIS | Volontairement absent (page = information, jamais d'ordre) | Donnerait au modèle un levier hors des contrôles de clic engageant | — |
| Lecture | `--javascriptEvaluation=false` (couper toute évaluation) | DIFFÉRENT | Déjà : aucune évaluation libre exposée | — | — |

### Console, réseau, débogage

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Débogage | `list_console_messages` (+ filtre par type, pagination, 3 navigations gardées) | MANQUANT | — | Un bot qui construit une page (`page_publish`) ne voit pas les erreurs JS de sa propre page dans son navigateur | M |
| Débogage | `get_console_message` avec pile d'appels | MANQUANT | — | — | S |
| Débogage | `set_logpoints` (journaux sans pause, source maps) | MANQUANT | — | Débogage avancé de code JS | M |
| Débogage | Problèmes DevTools (« issues » : cookies SameSite, CSP…) | MANQUANT | — | — | M |
| Réseau | `list_network_requests` (filtre par type, pagination) | MANQUANT | — | Trouver l'API JSON derrière une page au lieu de lire l'écran | M |
| Réseau | `get_network_request` (en-têtes, corps, vers fichier) | MANQUANT | — | — | M |
| Réseau | `--redactNetworkHeaders` (masquer Cookie/Authorization) | MANQUANT | — | À exiger si on ajoute le réseau | S |
| Réseau | `mock_network` / `remove_network_mock` | NON REPRIS | — | Outil de développeur ; pas un besoin d'assistant | — |
| Réseau | `--blockedUrlPattern` / `--allowedUrlPattern` (liste de sites) | PARTIEL | Réseau du conteneur isolé du serveur (`BOT_LINK=socket`, linux.ts:395) ; `assertPublicUrl` pour web_fetch (computer.ts:9) | Pas de liste de sites interdits dans le navigateur du bot (ex. interdire la banque) | M |
| Réseau | Refus des motifs contournables (groupes regexp, jokers IPv4 partiels) | NON REPRIS | — | Détail d'implémentation de la liste ci-dessus | — |
| Débogage | `screencast_start/stop` (vidéo MP4 de la page) | PARTIEL | `frame()` pour enregistrer une démonstration (linux.ts:762) | Vidéo d'une page seule à la demande du bot | M |

### Performance, audit, mémoire

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Performance | `performance_start_trace` / `stop_trace` (rechargement, cache froid) | MANQUANT | — | Un bot « SEO / site » ne mesure pas LCP/INP/CLS | M |
| Performance | `performance_analyze_insight` (LCPBreakdown, DocumentLatency…) | MANQUANT | — | Résumés lisibles d'une trace | M |
| Performance | Données réelles CrUX | NON REPRIS | — | Envoie les adresses à Google par défaut | — |
| Audit | `lighthouse_audit` (accessibilité, SEO, bonnes pratiques, « agentic browsing ») | MANQUANT | — | Un audit SEO/accessibilité d'une page que le bot a publiée ; Sklubot a `seo-contenu.md` (server/templates) sans outil de mesure | M |
| Émulation | `emulate` (sombre/clair, CPU, réseau lent, géoloc, user-agent, viewport mobile, contraste, mouvement réduit, en-têtes) | MANQUANT | — | Vérifier une page en mobile ou en mode sombre | M |
| Émulation | `resize_page` | MANQUANT | Résolution fixe `SCREEN_RES` (linux.ts:408) | — | S |
| Mémoire | 14 outils d'instantané de tas (heap snapshot, comparer, dominateurs, chaînes dupliquées…) | NON REPRIS | — | Débogage de fuites JS : public développeur, pas utilisateurs de Sklubot | — |

### Extensions, PWA, WebMCP, WebAuthn, DevTools

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Extensions | `install/list/reload/uninstall_extension`, `trigger_extension_action` | MANQUANT | — | Installer un bloqueur de pubs/cookies dans le navigateur du bot | M |
| PWA | `install_pwa`, `launch_pwa`, `uninstall_pwa`, `get_os_app_state` | NON REPRIS | — | Hors besoin | — |
| WebMCP | `list_webmcp_tools`, `execute_webmcp_tool` (outils déclarés par un site) | MANQUANT | — | Futur standard : un site expose ses actions aux agents ; à surveiller, mais à faire passer par les approbations | M |
| WebAuthn | `configure_webauthn` (authentificateur virtuel, clés d'accès) | NON REPRIS | — | Créer de fausses clés d'accès sur des comptes réels serait risqué | — |
| DevTools | `open_devtools`, `get/resolve_devtools_comment`, `reveal_in_devtools` (commentaires de l'humain dans DevTools) | DIFFÉRENT | Prise de main de l'écran (« Se connecter à un site », `ask_takeover` tools.ts:1221) | L'humain ne peut pas « pointer » un élément pour le bot ; il prend toute la main | M |
| Tiers | `list/execute_3p_developer_tool` (outils de développeur exposés par la page) | NON REPRIS | — | Expérimental | — |

### Configuration, sécurité, fiabilité du serveur

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Config | Catégories d'outils activables (`--categoryNetwork`…) | DIFFÉRENT | Groupes d'outils par bot (`inGroup`, tools.ts:1391) | — | — |
| Config | Mode `--slim` (3 outils) | DIFFÉRENT | Le loop réduit les outils selon le contexte | — | — |
| Config | Fichier de config + rechargement à chaud + `tools/list_changed` | NON REPRIS | — | Sklubot se règle par l'interface | — |
| Config | Avertissement « verrouiller le fichier de config contre l'agent » | FAIT (esprit) | Clés et réglages hors de l'ordinateur du bot (docs/ORDINATEUR.md « Ce qui reste protégé ») | — | — |
| Connexion | `--browserUrl` / `--wsEndpoint` / `--wsHeaders` (se brancher sur un Chrome qui tourne) | DIFFÉRENT | Sklubot parle déjà au Chromium du bot sur 9222 par un script Python | Installable : `npx chrome-devtools-mcp --browser-url http://127.0.0.1:9222` dans l'ordinateur du bot | — |
| Connexion | `--autoConnect` au Chrome de l'utilisateur (Chrome 144+) | MANQUANT | Companion : écran/souris de l'utilisateur (`companion/src/main/capabilities/desktop.js`) sans DOM | Sur l'ordinateur de l'utilisateur, le bot ne voit que des pixels | L |
| Connexion | `--headless`, `--channel`, `--executablePath`, `--chromeArg`, `--proxyServer`, `--viewport`, `--acceptInsecureCerts` | NON REPRIS | Sklubot fixe ses propres options (open-browser.sh) | — | — |
| Sécurité | Chemins de fichiers limités au dossier temporaire sans « roots » MCP (`--filesystemRoot`) | FAIT (esprit) | Tout se passe dans l'ordinateur du bot ; fichiers de l'utilisateur via `resolveInWorkspace` (computer.ts:412) | — | — |
| Sécurité | Bandeau de confidentialité au démarrage | PARTIEL | docs/ORDINATEUR.md | Pas d'équivalent au moment d'installer un outil tiers | — |
| Fiabilité | Attente après action : navigation attendue 100 ms, puis chargement (3 s) puis DOM stable (100 ms calme, 3 s max) (`src/utils/WaitForHelper.ts`) | MANQUANT | Pauses fixes (linux.ts:684-735) | Pages lentes = capture trop tôt ; pages rapides = temps perdu | M |
| Fiabilité | Multiplicateurs de délai CPU/réseau | MANQUANT | — | — | S |
| Fiabilité | Délai borné du snapshot (10 s) et de l'observateur de DOM quand un dialogue fige la page | PARTIEL | timeout 15 s du websocket, 40 s docker (linux.ts:672) | Message d'erreur clair au lieu d'une trace Python | S |
| Fiabilité | Réponse qui rappelle les onglets ouverts et le dialogue en cours (`McpResponse.ts:1155-1207`) | MANQUANT | — | Le modèle se perd moins | S |
| Fiabilité | Erreurs « auto-réparatrices » avec la marche à suivre (design-principles.md) | FAIT | elements.ts:41-54 (référence périmée → « prends un nouveau snapshot ») | — | — |
| Fiabilité | Collecte console/réseau gardée sur N navigations (`--maxNavigationSaved`) | MANQUANT | — | — | S |
| Fiabilité | Vérification de mises à jour | NON REPRIS | — | Image figée, mise à jour par reconstruction | — |
| Télémétrie | Statistiques d'usage (activées par défaut) | NON REPRIS | — | Couper si installé | — |
| CLI | `chrome-devtools` CLI + démon (scripts shell) | MANQUANT | — | Un bot pourrait écrire des scripts de navigation dans son terminal | S (installation) |
| Débogage | Android (`docs/debugging-android.md`) | NON REPRIS | — | — | — |
| Tests | Suite de tests (snapshot, réponses, blocage réseau, racines) | — | Sklubot : elements.test.ts 4 tests réels | Sklubot ne teste pas : 2 onglets, iframe, dialogue, page lente | S |

### Skills fournis (8 dossiers, Apache-2.0)

| Skill | Ce qu'il fait | Équivalent Sklubot (catalog.json, templates, COMPETENCES.md) | Verdict |
|---|---|---|---|
| `chrome-devtools` | Mode d'emploi des outils (snapshot avant capture, uid, etc.) | Description des outils dans tools.ts + guides | IDÉE : reprendre la règle « snapshot plutôt que capture » dans la consigne système |
| `chrome-devtools-cli` | Écrire des scripts shell avec la CLI | — | ADAPTER si la CLI est installée dans l'image |
| `a11y-debugging` | Audit d'accessibilité (ARIA, focus, contraste, cibles tactiles) | Aucune (catalogue : 16 skills design/pages, pas d'audit) | ADAPTER (avec Lighthouse) pour les bots qui publient des pages |
| `cookie-debugging` | 401/403, Set-Cookie, SameSite, bannière de consentement | — | IDÉE (diagnostic de connexion perdue) |
| `debug-optimize-lcp` | Trouver et corriger un LCP lent | `seo-contenu.md` sans mesure | ADAPTER si traces de performance ajoutées |
| `inspect-in-devtools` | Commentaires DevTools humain ↔ agent | Prise de main | NON (pas de DevTools humain chez le bot) |
| `memory-leak-debugging` | Instantanés de tas | — | NON (public développeur) |
| `troubleshooting` | Que faire si la connexion au navigateur échoue | `ready()` relance le navigateur (linux.ts:788) | IDÉE (message clair) |

## Peut-on l'installer dans l'image des bots ?

**Oui, sans risque pour l'hôte**, à condition de le brancher sur le Chromium déjà ouvert :
`npx -y chrome-devtools-mcp@1.13.0 --browser-url=http://127.0.0.1:9222 --no-usage-statistics --no-performance-crux --no-javascript-evaluation --redact-network-headers`.
Node 22 est déjà dans l'image (Dockerfile ligne 4). Il ne sort pas du conteneur (sans privilèges, `--cap-drop ALL`).
Il peut déjà être proposé par un bot via `local_tool_server_add` (tools.ts:1300, carte d'accord).

**Mais un vrai trou de sécurité apparaîtrait** : ses outils `click`/`fill` sont des outils MCP « distants ». Sklubot les
juge par leur **nom** (`irreversible.ts` `byName`, `authorize.ts:49-53`) : un `click` sur « Payer » n'est **pas** relu
dans la page comme `element_click` (bind.ts:55 ne traite que `screen_click`, `element_click`, `card_fill`). Si
l'utilisateur répond « Toujours » à l'outil `click` de ce serveur, les clics engageants passent sans carte. Il ne faut
donc **pas** exposer ses outils d'entrée ; seulement ses outils de lecture (console, réseau, Lighthouse, performance),
ou bien reprendre ses idées dans les outils natifs.

### Ce que renvoie Sklubot vs ce que renvoie l'outil

| Action | Sklubot | chrome-devtools-mcp |
|---|---|---|
| Clic | Capture JPEG de tout l'écran après 700 ms | Texte court ; snapshot texte si `includeSnapshot` ; attend navigation + DOM stable ; signale un dialogue ; liste des onglets |
| Snapshot | Liste plate d'éléments interactifs `[ab12.3] button "Envoyer" (disabled)` | Arbre a11y indenté avec textes, titres, iframes, uid stables |
| Lire | `innerText` brut du 1ᵉʳ onglet | Snapshot, ou script JS (désactivable) |
| Ouvrir | Nouveau processus `open-browser.sh` + 4 s + capture | `navigate_page`/`new_page` avec attente de chargement |
| Erreur dialogue | Trace Python après 15 s (vérifié) | « Open dialog: alert: … » et `handle_dialog` |

## Écarts de comportement (flux du navigateur)

1. **Le bot ouvre un 2ᵉ lien.** Outil : `new_page` crée un onglet dans le même navigateur, l'attend, le sélectionne.
   Sklubot : `browser_open` relance `open-browser.sh`, qui efface le verrou du profil (dress.py:295) et démarre un 2ᵉ
   Chromium ; vérifié dans un conteneur de l'image `sklubot-desktop:latest` avec les mêmes options que
   `computerRunArgs` : 2 processus principaux, 6 fenêtres « Profile error occurred », `/json` ne liste que la 1ʳᵉ page,
   `page_read` renvoie « First » alors que l'écran montre « Second ». Conséquences : lecture fausse, références d'éléments
   sur la mauvaise page, relecture du clic engageant (`targetAt`, linux.ts:741) sur la mauvaise page, profil abîmé
   (connexions perdues possibles). **Correction** : dans `open-browser.sh`, si `alive` répond, ouvrir l'onglet par CDP
   (`PUT /json/new?<url>`, documenté dans le protocole DevTools HTTP) et sortir **avant** `dress.py --profile` ; ne jamais
   effacer les fichiers Singleton d'un navigateur vivant. Ajouter un test « deux browser_open de suite ».
2. **Dialogue JavaScript.** Outil : détecté pendant l'action, montré dans chaque réponse, `handle_dialog`. Sklubot : tout
   se fige, trace illisible. **Correction** : dans `page-text.py` et `ELEMENTS_PY`, activer `Page.enable`, écouter
   `Page.javascriptDialogOpening`, et répondre « Un dialogue est ouvert : … » ; ajouter `dialog_answer` (accepter/refuser,
   et passer par l'approbation si le texte engage, ex. « Confirmer le paiement ? »).
3. **Attendre la fin d'un chargement.** Outil : attente d'événements puis DOM stable. Sklubot : pauses fixes ; le modèle
   compense par des `screen_view` répétés (une image chacune). **Correction** : après clic/entrée, interroger
   `document.readyState` et un MutationObserver 100 ms de calme (max 3 s) via le script Python existant.
4. **Choisir l'onglet.** Outil : `list_pages`/`select_page`. Sklubot : `pages[0]` partout (page-text.py ligne 14,
   ELEMENTS_PY). Si un lien s'ouvre dans un nouvel onglet, l'ordre de `/json` décide de ce que lit le bot. **Correction** :
   outil `browser_tabs` (liste, activer par `/json/activate/<id>`, fermer), et lire l'onglet réellement actif.
5. **Formulaires.** Outil : `fill_form` en un appel. Sklubot : un appel et une capture par champ. **Correction** :
   `element_fill` qui prend une liste `[ref, valeur]` (texte, liste, case) et renvoie un seul résultat ; les clics
   engageants restent hors de cet outil.
6. **Iframes.** Outil : inclus dans le snapshot. Sklubot : ignorés (getFullAXTree sur la frame principale). Sur un
   bandeau cookies ou un paiement en iframe, le bot retombe sur les pixels. **Correction** : `Page.getFrameTree` puis
   `Accessibility.getFullAXTree({frameId})` par frame (les iframes d'une autre origine demandent `Target.setAutoAttach`).
7. **Coût en jetons.** Outil : texte par défaut, image à la demande, taille max réglable. Sklubot : image pleine écran
   après chaque action. **Correction** : après `element_*`, renvoyer une ligne de texte (+ le titre/URL) et laisser le
   modèle demander `screen_view` ; réduire les captures à 1280 px de large.
8. **Débogage d'une page publiée par le bot.** Outil : console + réseau + Lighthouse. Sklubot : rien ; le bot ne sait
   pas qu'une page qu'il a construite a une erreur JS. **Correction** : outil lecture seule `page_console` (messages et
   erreurs de l'onglet, 3 navigations) ; Lighthouse via la CLI installée dans l'image pour les bots « site/SEO ».

## À faire (classé)

1. Corriger `open-browser.sh` / `dress.py --profile` : ne jamais effacer le verrou d'un navigateur vivant, ouvrir l'onglet par CDP — bug vérifié qui fausse lecture, références et relecture des clics engageants (S).
2. Gérer les dialogues JavaScript dans `page-text.py` et `ELEMENTS_PY` + outil pour y répondre, sous approbation si engageant (S).
3. Test réel « deux browser_open de suite », « alert() ouverte », « lien target=_blank », « iframe » dans `elements.test.ts` / `linux.test.ts` (S).
4. Outil `browser_tabs` (lister, activer, fermer) et lecture de l'onglet vraiment actif (S).
5. Attente intelligente après action (chargement + DOM stable) à la place des pauses fixes (M).
6. Iframes dans `element_snapshot` (M).
7. `element_fill` multi-champs et cases à cocher par valeur voulue (M).
8. Résultat texte (sans capture) pour les actions par référence, captures réduites (M).
9. `element_hover`, double-clic et Tab/Escape en fin de saisie par référence (S).
10. `file_upload` dans un champ fichier depuis `~/files` (`DOM.setFileInputFiles`) (M).
11. `page_console` lecture seule (erreurs JS, 3 navigations) pour les bots qui construisent des pages (M).
12. Lecture des requêtes réseau (en-têtes masqués) pour trouver l'API d'un site (M).
13. Capture d'un élément / pleine page à livrer à l'utilisateur (S).
14. Audit Lighthouse (accessibilité/SEO) + skill a11y adapté (M).
15. Émulation mobile/sombre pour vérifier une page publiée (M).
16. Liste de sites interdits dans le navigateur du bot, réglable par l'utilisateur (M).
17. Si `chrome-devtools-mcp` est proposé via `local_tool_server_add` : marquer ses outils d'entrée comme engageants ou les retirer, couper la télémétrie (S).
18. `wait_for` texte (S).

## Non vérifié

- Le bug des deux navigateurs a été reproduit dans un conteneur lancé à la main avec l'image et les options de
  `computerRunArgs`, pas à travers le serveur Sklubot complet ; le serveur appelle bien `open-browser.sh` à chaque
  `browser_open` (linux.ts:688), donc le même chemin.
- L'ordre de la liste `/json` de Chrome (onglet actif en premier ?) n'est pas documenté ; non testé avec deux vrais
  onglets à cause du bug ci-dessus.
- Les 14 outils mémoire, PWA, WebMCP et extensions n'ont été lus que dans la documentation, pas dans le code.
- Je n'ai pas lancé `chrome-devtools-mcp` (règle : ne pas exécuter le code cloné).
