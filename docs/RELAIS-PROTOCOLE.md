# Protocole Sklubot Relais — version 1 (révision 1.2)

> **Révision 1.9 (compatible, 25/11/2026)** : `android.*` — un **téléphone Android branché en USB** sur cet ordinateur, piloté avec `adb` (§20). Annoncé dans `capabilities` ; un serveur plus ancien ne l'envoie jamais, un Relais plus ancien répond `unknown_op`. `hello.protocol` vaut `"1.9"`.

> **Révision 1.8 (compatible, 25/11/2026)** : `net.fetch` — une demande web d'un bot du propriétaire part de la connexion de cet ordinateur (« sortir par la maison », §19). Annoncée dans `capabilities` ; un serveur plus ancien ne l'envoie jamais, un Relais plus ancien répond `unknown_op` (Sklubot dit alors « mets Sklubot à jour »). `hello.v` reste `1`, `hello.protocol` vaut `"1.8"`.

> **Révision 1.2 (compatible)** : un **téléphone** peut être un Relais (l'appli Sklubot pour Android, §13). Son `hello` porte `"device": { …, "kind": "phone", "platform": "android" }` et `"protocol": "1.2"`, et il annonce ses propres opérations. Un serveur 1.1 le voit comme un ordinateur sans souris ; un serveur 1.2 lui envoie les opérations du §13.

> **Révision 1.1 (compatible)** : ajoute les opérations de fichiers `fs.*` (§12). `hello.v` reste `1` ; le Relais envoie en plus `"protocol": "1.1"` et liste les nouvelles opérations dans `capabilities`. Un serveur 1.0 les ignore ; un serveur 1.1 ne les utilise que si elles sont annoncées.

Ce document décrit comment le **Relais** (le petit programme installé sur l'ordinateur de l'utilisateur, dossier `companion/`) parle au **serveur Sklubot**. Le client est déjà écrit ; le serveur doit implémenter la partie décrite ici. Un faux serveur de référence existe : `companion/test/fake-server.js`.

## 1. Principes

- **Connexion sortante uniquement.** Le Relais ouvre une WebSocket vers le serveur ; il n'écoute aucun port.
- **URL :** `${SERVER}/api/relay/connect`, où `${SERVER}` est l'adresse saisie par l'utilisateur (`https://…` → `wss://…`). `ws://` en clair n'est accepté que pour `localhost`, `127.0.0.1` et `::1` (développement, tests).
- **Messages :** texte JSON UTF‑8, un objet par message, champ `type` obligatoire. Aucun message binaire en v1 (un message binaire ferme la connexion, code 4400).
- **Version :** `hello.v` et `welcome.v` valent `1`. Les types inconnus sont ignorés (et journalisés) par les deux côtés : on peut ajouter des types et des champs sans changer de version. Un changement incompatible passe en `v: 2`.
- **Le consentement est décidé sur l'ordinateur.** Le serveur demande ; le Relais affiche la question, applique les réglages locaux et répond. Aucun message ne permet au serveur d'accorder, de forcer ou de contourner une autorisation (voir §9).

## 2. Limites

| Limite | Valeur |
|---|---|
| Message serveur → Relais | 256 Kio max (au‑delà : fermeture 1009 par le Relais) |
| Message Relais → serveur | 4 Mio max (images de capture comprises) ; prévoir `maxPayload` ≥ 4 Mio côté serveur |
| `id` de requête, `bot.id` | 64 caractères max, `bot.id` ∈ `[A-Za-z0-9_.:-]` |
| `bot.name` affiché | 60 caractères (caractères de contrôle et d'inversion bidi retirés) |
| Débit de requêtes | 30/s en moyenne, pointe 60 (au‑delà : erreur `rate_limited`) ; > 200 messages en 1 s : fermeture 4008 |
| `keyboard.type` | 2 000 caractères |
| `shell.run` | commande 8 Kio ; délai 100 ms – 10 min (défaut 30 s) ; sortie 256 o – 1 Mio (défaut 64 Kio) |
| Capture | largeur 64 – 2 560 px ; vue en direct 1 – 5 images/s, largeur ≤ 1 600 px |

## 3. Connexion et poignée de main

Dès l'ouverture de la socket, le Relais envoie **`hello`**. C'est le **seul** message qui transporte le jeton d'appareil.

Appareil déjà relié :

```json
{
  "type": "hello",
  "v": 1,
  "auth": { "deviceId": "dev_3f9a1c22b0e4", "token": "q8V…(43 car. base64url)" },
  "app": { "name": "sklubot-relais", "version": "0.1.0" },
  "device": { "name": "portable-lea", "platform": "darwin", "arch": "arm64", "osRelease": "24.1.0", "locale": "fr-FR" },
  "capabilities": ["session.start", "session.end", "screen.info", "screen.capture", "view.start", "view.stop",
                   "mouse.move", "mouse.click", "mouse.drag", "mouse.scroll", "keyboard.type", "keyboard.press",
                   "app.open", "url.open", "window.list", "window.focus", "shell.run"],
  "screen": { "width": 1512, "height": 982, "scaleFactor": 2 },
  "limits": { "maxInboundBytes": 262144, "maxViewFps": 5 },
  "state": { "locked": false }
}
```

Premier lancement : identique avec `"auth": null` → le serveur démarre l'appairage (§4).

Réponse du serveur si le jeton est valide :

```json
{ "type": "welcome", "v": 1, "deviceId": "dev_3f9a1c22b0e4", "serverName": "Sklubot de Léa" }
```

Si le jeton est invalide : fermer avec le code **4001** (le Relais affiche « Ce serveur ne reconnaît plus cet ordinateur » et ne se reconnecte pas tout seul). Si `v` n'est pas supporté : **4009**.

Juste après `welcome`, le Relais envoie un état :

```json
{ "type": "event", "name": "relay.state", "ts": "2026-11-14T10:00:00.000Z", "locked": false, "session": null }
```

Avant `welcome`, le Relais ignore toute requête `req`.

## 4. Appairage

1. Le Relais envoie `hello` avec `auth: null`.
2. Le serveur crée un appairage en attente, lié à **cette** connexion, et envoie :
   ```json
   { "type": "pair.code", "code": "K7QM-2XPA", "expiresAt": "2026-11-14T10:10:00.000Z" }
   ```
   Format accepté par le client : `^[A-Z0-9-]{4,16}$`. Recommandé : 8 caractères tirés au hasard (CSPRNG) dans un alphabet sans caractères ambigus (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`), affichés `XXXX-XXXX`, valables 10 min, à usage unique.
3. Le Relais affiche le code. L'utilisateur, **connecté à l'application web**, le **tape** (il ne le choisit pas dans une liste : c'est ce qui prouve qu'il a l'ordinateur sous les yeux). Côté serveur : limiter les essais (ex. 5 par utilisateur et par 10 min), comparer en temps constant.
4. Une fois le code confirmé, le serveur crée l'appareil (rattaché à l'utilisateur qui a tapé le code), génère un jeton et l'envoie sur la connexion en attente :
   ```json
   { "type": "paired", "deviceId": "dev_3f9a1c22b0e4", "token": "q8V…", "serverName": "Sklubot de Léa" }
   ```
   `deviceId` : `^[A-Za-z0-9_.:-]{1,64}$`. `token` : `^[A-Za-z0-9._~-]{16,512}$` (recommandé : 32 octets aléatoires en base64url).
5. Le Relais enregistre le jeton puis répond `{ "type": "token.ack", "deviceId": "dev_3f9a1c22b0e4" }`.
6. Le serveur envoie `welcome` ; la connexion est authentifiée.

Code expiré : renvoyer un nouveau `pair.code` sur la même connexion, ou fermer avec **4004** (le Relais se reconnecte et redemande un code).

## 5. Jeton d'appareil

- Stocké côté Relais dans le dossier de configuration de l'utilisateur (`relais.json`, droits 0600 sur macOS/Linux), chiffré avec le trousseau du système quand il est disponible (Electron `safeStorage` : Trousseau macOS, DPAPI Windows, libsecret/kwallet Linux).
- Stocké côté serveur **haché** (SHA‑256 suffit, le jeton étant aléatoire), jamais en clair, jamais dans les journaux.
- Envoyé **une seule fois par connexion**, dans `hello`.
- **Rotation** à l'initiative du serveur (recommandé : à chaque connexion ou toutes les 24 h) :
  ```json
  { "type": "token.rotate", "token": "nouveau-jeton…" }
  ```
  Le Relais enregistre le nouveau jeton puis répond `{ "type": "token.ack", "deviceId": "…" }`. Le serveur n'invalide l'ancien jeton **qu'à réception de l'ack** (sinon une coupure au mauvais moment bloquerait l'appareil).
- **Révocation** (l'utilisateur retire l'appareil dans l'application web) : envoyer `{ "type": "revoke" }` puis fermer, ou fermer directement avec **4003**. Le Relais efface son jeton et propose « Relier à nouveau ».
- « Oublier ce serveur » côté Relais efface localement le jeton, l'adresse et toutes les autorisations des bots. Le serveur verra simplement l'appareil ne plus se connecter.

## 6. Requêtes et réponses

Le serveur (au nom d'un bot) envoie :

```json
{ "type": "req", "id": "r42", "bot": { "id": "bot_alice", "name": "Alice" }, "op": "mouse.click", "args": { "x": 640, "y": 360 } }
```

Le Relais répond toujours avec le même `id` :

```json
{ "type": "res", "id": "r42", "ok": true, "result": {} }
```

```json
{ "type": "res", "id": "r43", "ok": false, "error": { "code": "consent_cooldown", "message": "a consent dialog cannot be shown right now", "retryAfterMs": 41250 } }
```

`bot.name` est affiché à l'utilisateur dans les fenêtres de consentement : envoyer le vrai nom du bot. Les requêtes peuvent être concurrentes ; une réponse peut arriver longtemps après (une question de consentement attend jusqu'à 60 s, une commande jusqu'à son délai).

### Coordonnées

Coordonnées logiques de l'**écran principal** (points/DIP), origine en haut à gauche, comme `screen.info.width/height`. Une capture renvoie aussi `screenWidth/screenHeight` : pour cliquer sur un point vu dans l'image, `x = xImage × screenWidth / width`. Le multi‑écran n'est pas géré en v1 (écran principal seulement).

### Opérations

| `op` | Session requise | `args` | `result` |
|---|---|---|---|
| `session.start` | non | `{ reason?: string ≤ 300 }` | `{ sessionId, grant: "once" \| "always" \| "account" \| "test", already?, from? }` (`account`, `from` : révision 1.7, §18) |
| `session.end` | non | `{ reason?: "handover" }` (1.7, ignoré avant) | `{}` |
| `screen.info` | non | `{}` | `{ width, height, scaleFactor, displayId, displays, platform, session }` (`session` : `x11`/`wayland` sous Linux) |
| `screen.capture` | oui | `{ format?: "jpeg"\|"png" (jpeg), maxWidth?: 64–2560 (1280), quality?: 10–95 (70) }` | `{ format, width, height, screenWidth, screenHeight, data: base64 }` |
| `view.start` | oui | `{ maxFps?: 1–5 (3), maxWidth?: 64–1600 (1280), quality?: 10–90 (60) }` | `{ viewId, maxFps }` |
| `view.stop` | non | `{ viewId? }` | `{}` |
| `mouse.move` | oui | `{ x, y }` | `{}` |
| `mouse.click` | oui | `{ x?, y?, button?: "left"\|"right"\|"middle", double?: bool }` | `{}` |
| `mouse.drag` | oui | `{ fromX, fromY, toX, toY, button? }` | `{}` |
| `mouse.scroll` | oui | `{ x?, y?, dx?: -100–100, dy?: -100–100 }` (crans ; `dy > 0` = vers le bas, `dx > 0` = vers la droite) | `{}` |
| `keyboard.type` | oui | `{ text }` | `{ typed }` |
| `keyboard.press` | oui | `{ key, modifiers? }` — `key` : un caractère, ou `enter`, `tab`, `escape`, `backspace`, `delete`, `up`/`down`/`left`/`right`, `home`, `end`, `pageup`, `pagedown`, `space`, `f1`…`f12`… ; combinaison possible `"ctrl+shift+t"` ; modificateurs `control`, `shift`, `alt`, `command` (alias `ctrl`, `cmd`, `meta`, `win`, `option`) | `{}` |
| `url.open` | oui | `{ url }` (`http`, `https`, `mailto` uniquement) | `{}` |
| `app.open` | oui | `{ name }` (nom simple : lettres, chiffres, espace, `._+-`) | `{ launched }` |
| `window.list` | oui | `{}` | `{ windows: [{ id, title }] }` |
| `window.focus` | oui | `{ title }` | `{ focused, note? }` — Windows : par titre ; macOS : amène l'**application** de ce nom au premier plan ; Linux : seulement si `wmctrl` est installé (sinon absent de `capabilities`) |
| `shell.run` | oui | `{ command, timeoutMs?, maxOutputBytes?, cwd? }` | `{ exitCode, signal, stdout, stderr, truncated, timedOut, cancelled, durationMs }` |

`shell.run` utilise le shell par défaut du système (`/bin/sh` sur macOS/Linux, `cmd.exe` sous Windows), dans le dossier personnel si `cwd` est absent ou invalide. Au délai ou à l'annulation, tout l'arbre de processus est tué.

### Annulation

```json
{ "type": "cancel", "id": "r57" }
```

Seul `shell.run` est annulable ; le Relais répond alors normalement à `r57` avec `cancelled: true`.

### Codes d'erreur

| Code | Sens |
|---|---|
| `invalid_args` | arguments invalides (type, plage, URL non autorisée…) |
| `too_large` | texte ou commande trop longs |
| `unknown_op` | opération inconnue |
| `unsupported` | impossible sur cet ordinateur (ex. capture indisponible, `wmctrl` absent, application introuvable) |
| `permission_missing` | autorisation système manquante (macOS : Enregistrement de l'écran / Accessibilité) |
| `no_session` | pas de session de contrôle ouverte pour ce bot |
| `busy` | un autre bot a la session (1.7 : `holder: { id, name }` et `retryAfterMs` en plus) |
| `locked` | l'utilisateur a appuyé sur Stop : tout est refusé jusqu'à ce qu'il réautorise sur l'ordinateur |
| `consent_refused` | l'utilisateur a refusé la session |
| `consent_expired` | personne n'a répondu dans les 60 s (compte comme un refus) |
| `consent_pending` | une fenêtre de consentement est ouverte : souris/clavier/commandes en attente, ou une autre question est déjà affichée |
| `consent_cooldown` | ce bot a été refusé récemment ; `retryAfterMs` indique quand redemander |
| `command_refused` | l'utilisateur a refusé la commande |
| `rate_limited` | trop de requêtes, ou trop de questions de consentement |
| `internal` | erreur inattendue (message en anglais, destiné aux journaux) |

## 7. Session de contrôle et consentement (imposés par le Relais)

Toute action autre que `session.start`, `session.end`, `screen.info` et `view.stop` exige une **session de contrôle** ouverte **par ce bot**. Une seule session à la fois.

`session.start` :
- si l'utilisateur a coché « Toujours autoriser ce bot » sur cet ordinateur → session ouverte sans question (`grant: "always"`) ;
- sinon une fenêtre s'ouvre sur l'ordinateur : **Autoriser cette fois** / **Toujours autoriser ce bot** / **Refuser**. Sans réponse en 60 s : refus.

`shell.run` : même dans une session, **chaque commande** affiche une fenêtre avec le texte exact de la commande (**Exécuter** / **Refuser**), sauf si l'utilisateur a activé localement « Commandes sans confirmation » pour ce bot (désactivé par défaut).

Protections côté Relais, non configurables par le serveur :
- une seule question affichée à la fois ; pendant qu'elle est affichée, souris, clavier et commandes du bot sont refusés (`consent_pending`), pour qu'un bot ne puisse pas cliquer lui‑même sur « Autoriser » ;
- après un refus (ou une absence de réponse), le même bot ne peut pas redemander pendant **1 min** ; après 3 refus en 10 min, pendant **10 min** (`consent_cooldown`) ;
- au plus **6 questions par 10 min**, tous bots confondus (`rate_limited`) ;
- les boutons ne répondent qu'après ~1 s d'affichage ;
- pendant une session, impossible d'élargir les autorisations dans la fenêtre du Relais (il faut d'abord arrêter la session) ;
- session fermée après **15 min** sans requête ;
- un **bandeau rouge toujours visible** (« Sklubot contrôle ton ordinateur — Stop ») et l'icône de la barre des tâches/des menus changent pendant la session ;
- **Stop** (bandeau, menu de l'icône, fenêtre) ou le raccourci global **Ctrl+Alt+Maj+S** (⌘⌥⇧S sur Mac) termine la session immédiatement, annule les commandes en cours et **verrouille** le Relais : tout est refusé (`locked`) jusqu'à ce que l'utilisateur clique « Réautoriser le contrôle » sur l'ordinateur. Le verrou survit à un redémarrage ;
- chaque action est écrite dans un journal local (`<config>/logs/actions.log`, sans images ni jeton).

### Événements envoyés par le Relais

Tous ont la forme `{ "type": "event", "name": "…", "ts": "ISO‑8601", … }`.

| `name` | Champs | Quand |
|---|---|---|
| `relay.state` | `locked`, `session` | après `welcome` |
| `consent.requested` | `bot`, `kind: "session"\|"command"` | une fenêtre vient de s'ouvrir sur l'ordinateur |
| `consent.decided` | `bot`, `kind`, `decision: "once"\|"always"\|"refuse"\|"expired"\|"run"` | réponse (ou expiration) |
| `session.started` | `bot`, `grant`, `sessionId`, `from?` | session ouverte (`from` : le bot qui a laissé la main, 1.7) |
| `session.ended` | `bot`, `reason`, `sessionId`, `to?` | `reason` : `bot` (session.end), `user_stop`, `hotkey`, `idle`, `paused`, `disconnected`, `stopped`, `handover` (1.7, avec `to`) |
| `relay.locked` | `source: "user"\|"hotkey"\|"tray"` | l'utilisateur a appuyé sur Stop |
| `relay.unlocked` | — | l'utilisateur a réautorisé le contrôle |
| `view.stopped` | `viewId`, `reason` | `requested`, `replaced`, `session_ended`, `no_ack`, `capture_error` |

Exemple :

```json
{ "type": "event", "name": "session.ended", "ts": "2026-11-14T10:21:07.120Z", "bot": { "id": "bot_alice", "name": "Alice" }, "reason": "hotkey", "sessionId": "s1lq3k2a1" }
```

Le serveur devrait afficher ces événements dans l'application web (et dans la conversation du bot) : « Léa a arrêté le contrôle », etc.

## 8. Vue en direct

```json
{ "type": "req", "id": "r60", "bot": { "id": "bot_alice", "name": "Alice" }, "op": "view.start", "args": { "maxFps": 4, "maxWidth": 1280, "quality": 60 } }
```

Le Relais envoie ensuite des images JPEG :

```json
{ "type": "frame", "viewId": "v3", "seq": 17, "format": "jpeg", "width": 1280, "height": 800, "data": "/9j/4AAQ…" }
```

Le serveur **doit** accuser réception de chaque image : `{ "type": "view.ack", "viewId": "v3", "seq": 17 }`.

- Contrôle de flux par crédits : au plus 2 images non acquittées en vol ; si le serveur (ou le navigateur derrière lui) ralentit, la cadence baisse toute seule.
- Cadence ≤ `maxFps`, réduite si la capture est lente. Une image identique à la précédente n'est pas renvoyée (sauf une toutes les 5 s).
- Sans ack pendant 15 s, la vue s'arrête (`view.stopped`, `no_ack`). Recommandé côté serveur : `view.start` quand quelqu'un regarde, `view.stop` quand plus personne ne regarde.
- Une seule vue à la fois ; elle s'arrête avec la session.

## 9. Pause, Stop, fermeture

- **Pause** (bouton de la fenêtre ou menu de l'icône) : le Relais termine la session (`session.ended`, `paused`), envoie `{ "type": "bye", "reason": "paused" }` puis **ferme la socket** et ne se reconnecte pas tant que l'utilisateur n'a pas cliqué « Reprendre ». Pendant la pause, rien n'est envoyé.
- **Battement :** le Relais envoie un ping WebSocket toutes les 25 s ; sans pong avant le suivant, il coupe et se reconnecte. Le serveur doit répondre aux pings (c'est automatique avec la plupart des bibliothèques, dont `ws`).
- **Reconnexion :** délai exponentiel 1 s, 2 s, 4 s… plafonné à 60 s, ±30 % d'aléa ; remis à zéro après 30 s de connexion stable. Pas de reconnexion automatique après 4001, 4003, 4009, 4010.
- Une connexion perdue termine la session de contrôle (`disconnected`) : il faut un nouveau `session.start` après reconnexion.

### Codes de fermeture

| Code | Envoyé par | Sens |
|---|---|---|
| 1000 | les deux | fermeture normale |
| 1009 | Relais | message serveur trop gros |
| 4001 | serveur | jeton invalide → le Relais propose de relier à nouveau |
| 4003 | serveur | appareil révoqué → le Relais efface son jeton |
| 4004 | serveur | code d'appairage expiré |
| 4008 | Relais | trop de messages |
| 4009 | les deux | version non supportée → « mets le Relais à jour » |
| 4010 | serveur | une autre connexion a pris la place de celle‑ci (même appareil) |
| 4400 | les deux | message invalide (JSON, type manquant, binaire…) |

Les messages `{ "type": "error", "code": "…", "message": "…" }` du serveur sont seulement journalisés par le Relais.

## 10. Ce que le serveur ne peut pas faire

- ouvrir une session, lancer une commande ou voir l'écran sans accord donné **sur l'ordinateur** ;
- modifier les réglages du Relais (« toujours autoriser », « commandes sans confirmation », démarrage automatique, verrou) : aucune opération n'existe pour cela ;
- déverrouiller après un Stop ;
- faire apparaître des questions en boucle (voir les limites §7) ;
- recevoir quoi que ce soit pendant une pause ;
- activer le mode d'auto‑confirmation des tests : il dépend d'une variable d'environnement du processus local (`SKLUBOT_RELAIS_TEST_AUTOCONFIRM=1`) et n'est **jamais** lu par une version empaquetée.

Limite à connaître : accepter une session de contrôle revient à prêter son clavier et sa souris. Un bot en session peut ouvrir un terminal et y taper des commandes ; la confirmation de `shell.run` protège contre l'exécution silencieuse en arrière‑plan, pas contre ce que l'utilisateur voit faire à l'écran. Le bandeau, le raccourci Stop et le journal sont là pour ça.

## 11. À implémenter côté serveur (résumé)

1. **WebSocket** `GET /api/relay/connect` (upgrade) : `maxPayload` ≥ 4 Mio, réponse aux pings, une connexion active par appareil (fermer l'ancienne en 4010).
2. **Messages entrants à traiter :** `hello`, `token.ack`, `res`, `frame`, `event`, `bye`.
3. **Messages à envoyer :** `pair.code`, `paired`, `welcome`, `token.rotate`, `revoke`, `req`, `cancel`, `view.ack`, `error`.
4. **Application web** (routes au choix du serveur, par exemple) : saisir un code d'appairage (`POST /api/relay/pairings { code }`), lister les ordinateurs reliés et leur état (en ligne, session, verrouillé), retirer un ordinateur (envoie `revoke`), regarder la vue en direct (relais des `frame` vers le navigateur, envoi des `view.ack`).
5. **Outil pour les bots** : transformer un appel d'outil en `req` (avec `bot.id`/`bot.name` réels), attendre `res`, gérer `no_session` → `session.start`, et ne pas réessayer en boucle sur `consent_*`, `locked`, `rate_limited` (respecter `retryAfterMs`).
6. **Stockage :** appareils (`deviceId`, propriétaire, nom, plateforme, hachage du jeton courant et du jeton en rotation, dates), appairages en attente (code, expiration, essais).

Le faux serveur `companion/test/fake-server.js` implémente tout cela en ~200 lignes et peut servir de modèle.


## 12. Fichiers (révision 1.1)

Le Relais peut donner accès à des **dossiers que l'utilisateur a choisis lui-même** dans sa fenêtre (« Dossiers partagés », boîte de dialogue du système). Le serveur ne peut ni ajouter un dossier, ni cocher « Écriture » : aucune opération n'existe pour cela.

| `op` | Session requise | `args` | `result` |
|---|---|---|---|
| `fs.roots` | non | `{}` | `{ roots: [{ id, name, path, write }] }` (`path` affiché avec `~`) |
| `fs.list` | non | `{ root, path? }` | `{ entries: [{ name, dir, size, modifiedAt }], truncated }` (500 entrées max) |
| `fs.read` | non | `{ root, path, maxBytes?: 1–262144 (65536) }` | `{ text, size, truncated }` |
| `fs.write` | non | `{ root, path, text (≤ 200 Kio), mode?: "create" \| "replace" ("create") }` | `{ written, previous: "trashed" \| null }` |
| `fs.trash` | non | `{ root, path }` | `{ trashed: true }` |

`root` : l'`id` ou le nom d'un dossier partagé. `path` : chemin relatif avec `/`.

Règles imposées par le Relais :
- dossiers partagés seulement **dans le dossier personnel** (pas le dossier personnel lui-même) ou sur un **disque externe** ; jamais un dossier caché, système, de données d'applications (`Library`, `AppData`…) ou de sauvegarde ;
- chemins sans `..`, sans segment caché (`.xxx`) ; les liens sont résolus et doivent rester dans le dossier ;
- fichiers à secrets refusés partout (`.env*`, clés `id_rsa`…, `*.pem`, `*.key`, `*.p12`, `*.kdbx`, trousseaux, `credentials`, `.netrc`…) et absents des listes ;
- lecture : texte seulement (un octet nul dans les 8 premiers Kio → `binary`) ;
- écriture : seulement si le dossier est coché « Écriture » (`read_only` sinon) ; pas de programmes ni de raccourcis (`.exe`, `.sh`, `.lnk`, `.desktop`, `.ps1`…) ; un fichier existant n'est remplacé qu'en mode `replace`, **après** avoir mis l'ancienne version à la corbeille du système ; écriture atomique (fichier temporaire puis renommage) ;
- `fs.trash` : corbeille du système uniquement (Electron `shell.trashItem`), jamais de suppression définitive ; pas le dossier partagé lui-même ;
- Stop verrouille aussi les fichiers (`locked`) ; le journal local garde le chemin et la taille d'une écriture, jamais son contenu.

Nouveaux codes d'erreur : `forbidden` (hors des dossiers partagés, caché, système, à secrets, programme), `read_only`, `not_found`, `exists`, `binary` (et `too_large`, `invalid_args` comme avant).

Côté serveur Sklubot : outils `my_files`, `my_file_read`, `my_file_write`, `my_file_trash` ; l'écriture et la corbeille demandent l'accord de l'utilisateur à chaque fois ; aucune opération de fichiers depuis une routine, un coup de coude, une tâche de fond ou un message d'un autre bot.


## 13. Téléphones (révision 1.2)

L'appli Sklubot pour Android (`android/app/src/main/java/app/sklubot/android/relay/`) parle ce protocole tel quel (§1 à §9 : `hello`, appairage par code affiché sur le téléphone, jeton, rotation, révocation, reconnexion, codes de fermeture). Elle annonce :

```json
{ "type": "hello", "v": 1, "protocol": "1.2", "auth": null,
  "app": { "name": "sklubot-android", "version": "1.1.0" },
  "device": { "name": "Pixel de Léa", "platform": "android", "kind": "phone", "arch": "arm64-v8a", "osRelease": "15 (API 35)", "model": "Google Pixel 8", "locale": "fr-FR" },
  "capabilities": ["session.start", "session.end", "screen.info", "screen.capture", "screen.read", "touch.tap", "touch.swipe", "keyboard.type", "global.action", "app.open", "url.open"],
  "screen": { "width": 1080, "height": 2400, "scaleFactor": 2.625 },
  "limits": { "maxInboundBytes": 262144, "maxViewFps": 0 },
  "state": { "locked": false, "accessibility": true } }
```

Le serveur enregistre le genre (`kind`) à l'appairage et ne le change plus ensuite. Coordonnées : **pixels réels** de l'écran (comme `screen.width/height`) ; une capture renvoie `screenWidth/screenHeight`.

| `op` | Session requise | `args` | `result` |
|---|---|---|---|
| `screen.capture` | oui | comme §6 (Android 11+ ; sinon absent de `capabilities`) | comme §6 |
| `screen.read` | oui | `{ maxNodes?: 1–400 (200) }` | `{ app: { package, label }, nodes: [{ text?, desc?, id?, class?, bounds: [x, y, w, h], click?, edit?, focused?, checked? }], truncated, screenWidth, screenHeight }` — champs mot de passe masqués (`••••`) |
| `touch.tap` | oui | `{ x, y, long?: bool, double?: bool }` (pas les deux) | `{}` |
| `touch.swipe` | oui | `{ fromX, fromY, toX, toY, durationMs?: 50–3000 (300), hold?: bool }` — `hold` : appui maintenu puis déplacement (faire glisser un élément) | `{}` |
| `keyboard.type` | oui | `{ text ≤ 2000 }` — dans le champ qui a le focus | `{ typed, method: "set_text" \| "paste" }` |
| `global.action` | oui | `{ action: "back" \| "home" \| "recents" \| "notifications" \| "quick_settings" \| "enter" }` | `{}` |
| `app.open` | oui | `{ name }` — nom affiché ou nom de paquet | `{ launched, package }` |
| `url.open` | oui | `{ url }` (`http`, `https`, `mailto`) | `{}` |

Pas de `shell.run` (réponse `unknown_op`), pas de `fs.*`, pas de vue en direct (`view.start` absent ; `view.stop` accepté sans effet), pas de `mouse.*`, `keyboard.press`, `window.*`.

Règles imposées par le téléphone (en plus de celles du §7, reprises à l'identique : question Autoriser cette fois / Toujours / Refuser, 60 s, 1 min puis 10 min d'attente, 6 questions par 10 min, 30 req/s, 15 min d'inactivité, Stop + verrou, journal local) :
- rien ne se passe tant que l'utilisateur n'a pas **allumé le relais** dans l'appli et **activé le service d'accessibilité** dans les réglages d'Android (sinon `permission_missing`) ;
- **applis bloquées** (liste choisie par l'utilisateur, interrupteur « Bloquer les applis de paiement et banque que je choisis », activé par défaut) : si l'une est à l'écran (même en écran partagé), `screen.capture`, `screen.read`, `touch.*`, `keyboard.type` et `global.action enter` répondent `blocked_app` ; `app.open` d'une appli bloquée aussi ;
- jamais d'appui ni de saisie dans **Sklubot lui-même** (`blocked_app`) : l'appli affiche les cartes d'accord du serveur ;
- **écran de verrouillage** : `screen_locked` ;
- Stop : bandeau rouge en haut de l'écran (fenêtre d'accessibilité), bouton de la notification permanente, vignette des réglages rapides « Stop Sklubot ».

Nouveaux codes d'erreur : `blocked_app`, `screen_locked`.


## 14. Règles de sécurité (révision 1.3)

Backlog L19 / L32. Le serveur refuse d'abord (`server/src/relayguard.ts`) ; le Relais vérifie encore les mêmes règles
(`companion/src/main/guard.js`, `relay-core.js`). Les deux listes sont identiques (test `server/test/relay-guard.test.ts`).
Un Relais 1.3 annonce `window.active`, `script.peek` et `guard.set` dans `capabilities`. Pour un ordinateur sans
`window.active`, le serveur n'envoie plus aucun clic, défilement, saisie ni touche (« mets l'appli à jour »).

| `op` | Session requise | `args` | `result` |
|---|---|---|---|
| `window.active` | oui | `{}` | `{ active: { app, bundle?, pid?, windowId?, title, passwordField: true \| false \| null } \| null }` |
| `script.peek` | oui | `{ path ≤ 1024, cwd? }` — lit, n'exécute jamais | `{ sha256, size, lines: [≤ 40 lignes de ≤ 200 car.], more, binary }` |
| `guard.set` | non | `{ keepApps: [≤ 50], keepFolders: [≤ 50], terminal: bool }` — envoyé par le serveur à chaque connexion et à chaque changement (bot `sklubot`) ; n'ajoute que des refus | `{ keepApps, keepFolders, terminal }` (nombres) |

Nouveaux arguments : `expect: { app, pid?, windowId? }` sur `mouse.move/click/drag/scroll` et `keyboard.type/press`
(la fenêtre vue par le serveur ; le Relais refuse si une autre est devant) ; `force: bool` sur `keyboard.press`
(raccourci protégé accepté sur une carte ; le Relais redemande sur l'ordinateur) ; `scripts: [{ path, sha256 }]` (≤ 3)
sur `shell.run` (les scripts montrés sur la carte du serveur).

Le Relais, avant chaque `mouse.click/drag/scroll` et `keyboard.type/press`, relit la fenêtre au premier plan (macOS :
System Events, sous-rôle `AXSecureTextField` ; Windows : `GetForegroundWindow` + UI Automation `IsPassword` ; Linux X11 :
`xprop`, champ mot de passe inconnu) et refuse :

| Code | Quand |
|---|---|
| `foreground_unknown` | la fenêtre au premier plan ne peut pas être lue (refus par défaut) |
| `window_changed` | ce n'est pas la fenêtre `expect` |
| `blocked_app` | appli toujours refusée (fenêtres de terminal, outils de scripts, réglages et outils du système, mots de passe et portefeuilles, Sklubot ; un titre contenant « Sklubot ») ; aussi pour `app.open` et `window.focus` par nom. Depuis 1.4, une fenêtre de terminal est toujours refusée : les commandes passent par `shell.run` |
| `keep_out` | appli ou dossier de la liste « garder à l'écart » (nom de l'appli ou mot du titre ; dossier dans le titre) ; `script.peek` dans un tel dossier |
| `password_field` | saisie ou touche (hors Tab, Échap, flèches, Origine, Fin, Page) alors qu'un champ mot de passe a le focus, ou focus inconnu dans une fenêtre dont le titre ressemble à une connexion |
| `blocked_shortcut` | raccourci protégé (liste `DANGEROUS_SHORTCUTS`, par système) sans `force`, ou refusé sur l'ordinateur. Alt+F4 / Cmd+Q / Ctrl+Q (Linux) permis sur une appli ouverte par le bot dans la session |
| `script_unreadable` | chemin de script que seul le shell résoudrait (`$VAR`, jokers…), plus de 3 scripts, script hors du dossier de la commande et du dossier personnel, fichier à secrets, plus de 1 Mio |
| `script_changed` | le script n'a pas l'empreinte de `scripts`, ou a changé entre la question et le clic |

Une commande qui lance un script est **toujours** demandée sur l'ordinateur, avec les 40 premières lignes et
l'empreinte. Fin de session, Stop, déconnexion : toutes
les touches de modification et tous les boutons de souris sont relâchés (`releaseAll`), et `keyboard.press` relâche ses
touches de modification même en cas d'erreur.

## 15. Terminal sous contrôle et coffre (révision 1.4)

Décision du propriétaire : les commandes sont **activées par défaut** sur son ordinateur (interrupteur pour les couper).

- `guard.set` ajoute `projectFolders: [≤ 50]` ; `terminal` vaut `true` sauf `false` explicite (un serveur ancien qui
  n'envoie rien laisse les commandes actives).
- `shell.run` : refus `terminal_off` si le propriétaire a coupé les commandes ; dossier par défaut = premier dossier de
  projet ; dossier ou commande qui touche un dossier « garder à l'écart » → `keep_out`. Question sur l'ordinateur : la
  première commande ordinaire d'une session (le oui vaut pour la session), puis **à chaque fois** pour une commande du
  plancher (`commandFloor` : liste `DESTRUCTIVE_COMMAND` de `server/src/agent/irreversible.ts` reprise telle quelle +
  `FLOOR_EXTRA` : git réécrit, administrateur, installations globales, disques, droits récursifs hors projet,
  `curl | sh`, écoute réseau/tunnels, fichiers de démarrage, écriture hors du dossier ; dossier hors des dossiers de
  projet) et pour une commande qui lance un script. La question indique `floor` (le motif).
- `streamRef` (≤ 64) sur `shell.run` / `shell.start` : la sortie est envoyée au fil de l'eau en événements
  `{ type: "event", name: "shell.output", ref, stream: "stdout" | "stderr", text }`, groupés toutes les 400 ms, 64 Kio par
  commande au plus. Le serveur l'affiche dans la discussion (repliée, 8 Kio, secrets masqués).
- `shell.start` (mêmes arguments que `shell.run`) → `{ jobId, cwd }` aussitôt ; `shell.read { jobId }` →
  `{ running, exitCode, stdout, stderr, truncated, durationMs }` (256 Kio gardés par flux, la fin) ; `shell.stop
  { jobId }`. 5 commandes de fond au plus ; toutes arrêtées à la fin de la session. Délai maximal : 60 min.
- `vault.type { text ≤ 2000, field: "username" | "password" | "code", site, expect }` : le Relais relit la fenêtre au
  premier plan (et, pour un navigateur, l'adresse de la page : `url` dans `window.active`), puis refuse si
  `window_changed`, `keep_out`, `blocked_app`, `host_unknown` (adresse illisible), `host_mismatch` (pas le site ni un
  sous-domaine), `app_mismatch` (appli hors navigateur différente de l'élément), `not_password_field` (mot de passe
  ailleurs que dans un champ mot de passe), `password_field` (identifiant ou code dans un champ mot de passe). Le texte
  n'est jamais écrit dans le journal local (seulement le champ, le site, la longueur) et la variable est vidée après la
  frappe. Le serveur vérifie les mêmes règles avant d'envoyer (`vaultVerdict`, identique des deux côtés).

## 16. Arbre d'accessibilité (révision 1.5, L164)

Sur **macOS et Windows seulement** (le Relais ne liste pas ces opérations sous Linux), le bot lit les commandes d'une
appli (boutons, champs, cases, listes…) et agit **par référence** au lieu de viser un pixel. Code :
`companion/src/main/capabilities/accessibility.js` (tables de rôles reprises de vercel-labs/agent-desktop, Apache-2.0),
règles dans `relay-core.js` ; côté serveur, outils `my_ui_tree` / `my_ui_act` (`server/src/agent/myui.ts`).

- `ax.tree { app? }` (session de contrôle) : lit l'appli nommée, ou celle au premier plan. Réponse :
  `{ snapshotId, app, complete, dialogs: [{ role, name }], elements: [{ ref, role, name, value?, secure?, enabled, depth, inDialog? }], text }`.
  Une référence ressemble à `@s1a2b3:e8` ; elle n'est valable que pour cette lecture (les 3 dernières sont gardées, toutes
  oubliées à la fin de la session). Les boîtes ouvertes (dialogue, feuille, alerte) sont listées en premier.
- `ax.act { ref, action, text?, background?, expect? }` : `press`, `set_value`, `focus`, `toggle`, `select`, `expand`.
  `background: true` : l'action passe par l'API d'accessibilité sans bouger le pointeur ni amener l'appli devant.
- Refus décidés **sur l'ordinateur**, quoi que demande le serveur : appli toujours refusée ou « garder à l'écart » (même pas
  lue) → `blocked_app` / `keep_out` ; champ mot de passe (AXSecureTextField, IsPassword) jamais rempli ni lu →
  `password_field` (seul `focus` passe : l'utilisateur tape lui-même) ; sans `background`, l'appli doit encore être au
  premier plan, relue juste avant → `window_changed` / `foreground_unknown` ; action qui ne va pas au rôle →
  `invalid_args` ; référence nue, ancienne ou commande qui a changé (rôle et nom revérifiés par le script juste avant)
  → `stale_ref`.
- Côté serveur, en plus : la carte de prise de contrôle habituelle ; appuyer sur une commande dont les mots engagent
  (envoyer, payer, supprimer, publier, confirmer… `committingKind`) demande une carte à usage unique, sans « Toujours ».
- Lecture : macOS par `osascript -l JavaScript` (System Events, permission « Accessibilité » déjà demandée pour la
  souris) ; Windows par PowerShell (System.Windows.Automation), le texte d'un `set_value` passe par l'entrée standard.

**Non vérifié sur une vraie machine** : les deux scripts (JXA et PowerShell) n'ont pas pu tourner ici (pas de Mac ni de
PC Windows) ; le découpage, les références et toutes les règles sont testés (`companion/test/unit/accessibility.test.js`,
`server/test/relay-guard.test.ts`).

## 17. Wan2GP sur la carte graphique du propriétaire (révision 1.6)

Le Relais peut joindre **Wan2GP** (vidéos et images gratuites) que le propriétaire a installé et démarré sur **ce même
ordinateur**, avec son serveur MCP (`python wgp.py --mcp --mcp-api-version 1 --mcp-transport streamable-http --mcp-host
127.0.0.1 --mcp-port 7866`). Une seule opération :

| `op` | Session requise | `args` | `result` |
|---|---|---|---|
| `gpu.http` | non | `{ port, method: "GET"\|"POST"\|"PUT", path, headers?, body? }` ou `{ port, read: { token, offset } }` | `{ status, headers, size, offset, data, token }` |

Règles imposées par le Relais (`companion/src/main/capabilities/gpu.js`, `relay-core.js`) :

- l'hôte est toujours `127.0.0.1` ; le serveur ne donne qu'un port (1024–65535) et un **chemin** (jamais une adresse
  complète, jamais `//`) ; en-têtes gardés : `content-type`, `accept`, `mcp-protocol-version`, `mcp-session-id` (ni cookie
  ni `Authorization`) ; réponse : `content-type` et `mcp-session-id` seulement ;
- corps envoyé : 180 Kio au plus (le serveur réduit l'image de départ pour tenir) ; réponse en morceaux de 2 Mio (`data`
  en base64 ; `token` tant qu'il en reste, relu avec `read`), gardée 5 minutes au plus, 300 Mio au plus ;
- la **première** demande d'un bot pour un port ouvre une question sur l'ordinateur (« {bot} veut utiliser Wan2GP sur ta
  carte graphique », Autoriser / Refuser) ; l'accord vaut jusqu'à Stop ou la fermeture du Relais ; Stop verrouille comme
  le reste (`locked`) ;
- pas de souris, pas de clavier : pas de session de contrôle.

Côté serveur : `server/src/wan2gptarget.ts` (`relayFetch`), `server/src/mediajobs.ts` (un travail en cours est repris
quand l'ordinateur se reconnecte). Tests : `companion/test/unit/gpu.test.js`, `server/test/media-open-gen.test.ts`.
**Non vérifié** avec un vrai Wan2GP ni une vraie carte graphique (faux serveur MCP dans les tests).

## `screen.capture` : autre écran (23/11/2026)

Argument facultatif `display` (entier 0 à 15) : 0 = écran principal, puis les autres de gauche à droite. La réponse ajoute `displayIndex` et `displays` (nombre d'écrans). Un écran autre que le principal sert seulement à regarder : les clics et touches restent sur l'écran principal, et le serveur ne garde pas cette capture comme référence des clics. Un Relais plus ancien ignore `display` et renvoie l'écran principal (sans `displayIndex`).

## 18. Un ordinateur pour tous les bots du compte (révision 1.7, 25/11/2026)

Un ordinateur relié appartient au **compte** (tous ses bots), mais la session de contrôle reste à **un bot à la fois**.
Ajouts compatibles (un serveur plus ancien ignore les champs nouveaux ; un Relais plus ancien continue de demander bot
par bot) :

- **Question de session** : un quatrième bouton « **Autoriser tous mes bots de ce compte** » (`decision: "all"`). Gardé
  dans `relais.json` (`allBots`), retirable dans la liste « Bots » du Relais ; effacé si l'ordinateur change de
  serveur, est appairé de nouveau ou si l'on « oublie ce serveur ». Tant qu'il tient, tout bot du compte obtient la
  session sans question (`grant: "account"`). Les **commandes** gardent leurs propres règles (première commande de la
  session, commandes sensibles et scripts demandés à chaque fois).
- **Passage de main** : un bot B demande `session.start` pendant que A a la session.
  - A a fait une requête il y a moins de **20 s** (`HANDOVER_IDLE_MS`), ou une commande de A tourne (au premier plan ou
    en fond), ou une question est ouverte → `busy` avec `holder` (A) et `retryAfterMs` (le temps qui reste avant que A
    compte comme inactif).
  - A est inactif depuis 20 s : si B est couvert (« Toujours autoriser ce bot » ou « tous mes bots »), le Relais termine
    la session de A (`session.ended`, `reason: "handover"`, `to: B`) puis ouvre celle de B sans question
    (`session.started` avec `from: A`). Sinon la question s'ouvre pour B, en disant que A laissera la main ; un oui
    fait le passage, un refus laisse A en place. Un bot qui a pris l'ordinateur pendant la question n'est jamais remplacé.
  - Jamais deux sessions ; Stop termine tout et verrouille comme avant (`locked` l'emporte sur tout).
- **Capacité** `session.handover` dans `hello.capabilities` : ce Relais fait le passage de main lui‑même.

Côté serveur (`server/src/agent/computerqueue.ts`, `server/src/relay.ts`) : un bot qui a besoin d'un ordinateur occupé
**attend son tour** (file par ordinateur, premier arrivé premier servi) et l'écrit dans son chat après 2 s
(« En attente de l'ordinateur …, utilisé par A ») ; il continue tout seul quand c'est son tour, abandonne après 10 min
en le disant. Avec un Relais **sans** `session.handover`, Sklubot envoie lui‑même `session.end` (comme A, avec
`reason: "handover"`) quand A est inactif depuis 20 s, puis `session.start` pour B ; ce Relais pose alors sa question
habituelle pour B. Stop dans Sklubot ou sur l'ordinateur arrête aussi l'attente des bots en file.

Côté Sklubot, deux réglages vont avec (`server/src/computershare.ts`) : la carte « prendre le contrôle » offre
« **Pour tous mes bots** » (règle du compte, retirable dans Réglages → Ordinateurs ; jamais après un contenu extérieur,
jamais pour un bot bloqué), et « **Ordinateur de ce bot** » (réglages du bot, affiché à partir de 2 appareils reliés) :
« Celui qui est connecté » (défaut) ou un appareil précis ; s'il n'est pas connecté, le bot le dit au lieu d'en prendre
un autre.

Tests : `companion/test/unit/handover.test.js`, `companion/test/unit/store.test.js`, `server/test/computer-share.test.ts`.
**Non vérifié** sur un vrai Mac ou PC (fenêtre de question à quatre boutons, liste « Bots » du Relais) : la logique est
testée en Node, l'interface du Relais n'a pas été ouverte ici.

## 19. Sortir par la maison : `net.fetch` (révision 1.8, 25/11/2026, A-FAIRE L169)

Le propriétaire peut faire sortir les lectures de pages d'un bot par **sa propre connexion** (les sites voient l'adresse
de sa maison, pas celle du serveur) : Réglages du bot → Sécurité → « Sortie Internet » → « Maison · Relais ». Sklubot
envoie alors chaque demande web du bot (lire une page, télécharger un fichier, « Tester ») au Relais de l'ordinateur
choisi. Le serveur n'envoie `net.fetch` qu'à un appareil **du même compte que le bot** (`devices.owned`).

| Opération | Session ? | Arguments | Résultat |
|---|---|---|---|
| `net.fetch` | non | `{ url, method?: "GET"\|"HEAD"\|"POST", headers?: {…}, body?: base64 ≤ 180 Kio }` | `{ status, headers, data: base64, truncated }` |

- `url` : `http://` ou `https://`, 4 096 caractères au plus, sans nom ni mot de passe dedans.
- `headers` : seuls `accept`, `accept-language`, `content-type`, `user-agent` et les trois en-têtes Web Bot Auth
  (`signature`, `signature-input`, `signature-agent`) passent ; jamais de cookie ni d'`authorization`.
- Réponse : 2,5 Mio au plus (le reste est coupé, `truncated: true`), 30 s au plus ; en-têtes rendus : `content-type`,
  `content-length`, `content-language`, `location`, `last-modified`, `etag`, `retry-after`, `cache-control`.
- **Redirections non suivies** par le Relais : il rend le 3xx et `location` ; Sklubot suit lui-même et vérifie la
  politique réseau du bot à chaque étape.

Règles imposées **par le Relais** (`companion/src/main/capabilities/netexit.js`, `relay-core.js`), quoi que demande le
serveur :

1. **Accord sur l'ordinateur** : la première demande de chaque bot ouvre une question (« {bot} veut sortir sur Internet
   par ta connexion », `kind: "net"`) ; le oui vaut pour ce bot jusqu'à **Stop** ou la fermeture du Relais. Refus :
   `consent_refused`. Stop verrouille tout (`locked`), comme pour le reste.
2. **Jamais le réseau de la maison** : chaque adresse que le nom résout est vérifiée au moment de la connexion ; box,
   imprimante, NAS, cet ordinateur lui-même et toutes les plages privées ou réservées (la même liste que le serveur,
   `server/src/net.ts`) sont refusés → `blocked_address` (nouveau code d'erreur).
3. **Visible** : chaque demande est écrite dans le journal du Relais (méthode, site, chemin — jamais la requête ni le corps).
4. **Débit à part** : 20 demandes d'un coup, puis 2 par seconde (`rate_limited` au-delà), en plus de la limite générale (§2).
5. L'ordinateur doit **rester allumé** avec Sklubot ouvert : sinon `offline`, et Sklubot dit au propriétaire de l'ouvrir.

Pas couvert par ce chemin : le **navigateur** du bot (il ouvre des tunnels chiffrés que ce protocole ne transporte pas) ;
il reste en direct, et l'écran le dit. Pour que le navigateur sorte aussi par la maison, utiliser Tailscale
(docs/ORDINATEUR.md, « Sortir par la maison »).

Signature Web Bot Auth : jamais ajoutée à une demande qui part de la maison, sauf si le propriétaire a coché « Signer
aussi quand il sort par la maison » (sinon un site pourrait relier l'adresse de sa maison à ce serveur).

Tests : `companion/test/unit/netexit.test.js` (accord, refus, Stop, débit, réseau de la maison, redirections, réponses
coupées) ; `server/test/l169-egress.test.ts` (un faux Relais qui répond avec le code du Relais).
**Non vérifié** sur un vrai Mac ou PC : la fenêtre de question « net » n'a pas été ouverte ici.



## 20. Un téléphone Android branché en USB (révision 1.9, 25/11/2026, A-FAIRE L177)

Le propriétaire branche son téléphone Android sur l'ordinateur où tourne le Relais ; ses bots l'utilisent à travers le
Relais, avec **`adb`**, l'outil officiel de Google (« Android SDK Platform-Tools »), que **le propriétaire installe
lui-même** : le Relais ne télécharge jamais rien. S'il ne trouve pas `adb` (dans le `PATH`, `ANDROID_HOME` /
`ANDROID_SDK_ROOT`, ou les dossiers habituels `platform-tools`), `android.devices` répond `adb.found: false` et la
fenêtre du Relais comme Réglages → Ordinateurs affichent le guide d'installation
(https://developer.android.com/tools/releases/platform-tools, Options pour les développeurs, Débogage USB, « Autoriser »).

Le téléphone lui-même doit d'abord avoir accepté l'ordinateur (sa fenêtre « Autoriser le débogage USB ? », clé RSA,
https://developer.android.com/tools/adb) : avant, `adb devices -l` le montre `unauthorized`, sans modèle, et rien ne lui
est envoyé (`phone_unauthorized`).

Commandes `adb` utilisées (toutes documentées, aucune inventée ; liste des sources dans
`companion/src/main/capabilities/adb.js`) : `adb version`, `adb devices -l`, `adb -s <série> shell getprop …`,
`adb -s <série> exec-out screencap -p`, `input tap | swipe | text | keyevent`, `monkey -p <paquet> -c
android.intent.category.LAUNCHER 1`, `uiautomator dump`, `dumpsys window`. Arguments passés en liste (jamais par un
shell local) ; ce qui part dans le shell du téléphone est un nombre, un nom de paquet vérifié, ou un texte entre
apostrophes.

| `op` | Session de l'ordinateur ? | `args` | `result` |
|---|---|---|---|
| `android.devices` | non | `{}` | `{ adb: { found, version? }, devices: [{ serial, state: "device" \| "unauthorized" \| "offline"…, usb, model?, android?, sdk?, inUse }] }` — modèle et version **seulement** pour un téléphone qui a autorisé l'ordinateur |
| `android.screenshot` | non | `{ serial, maxWidth?: 64–2560 (1080) }` | `{ format: "jpeg" \| "png", width, height, screenWidth, screenHeight, data: base64 }` |
| `android.ui` | non | `{ serial, maxNodes?: 1–400 (200) }` | `{ app: { package }, nodes: [{ text?, desc?, id?, class?, bounds: [x, y, w, h], click?, edit?, password?, focused?, checked? }], truncated }` — texte d'un champ mot de passe remplacé par `••••` |
| `android.tap` | non | `{ serial, x, y, long?: bool }` (pixels réels de l'écran) | `{}` |
| `android.swipe` | non | `{ serial, fromX, fromY, toX, toY, durationMs?: 50–3000 (300) }` | `{}` |
| `android.type` | non | `{ serial, text ≤ 500 (ASCII imprimable), force?: bool }` | `{ typed }` |
| `android.key` | non | `{ serial, key: "back" \| "home" \| "recents" \| "enter" \| "delete" \| "tab" \| "escape" }` | `{}` |
| `android.open` | non | `{ serial, package }` | `{ launched, package }` |
| `android.release` | non | `{ serial? }` | `{ released }` — un bot rend le téléphone ; envoyé par Sklubot (bot `sklubot`), le Relais oublie aussi tous les accords pour ce téléphone |

**Aucune opération d'installation** : rien n'est installé par ce chemin.

Règles imposées **par le Relais** (`companion/src/main/phone-usb.js`), quoi que demande le serveur :

1. **Accord sur l'ordinateur** : la première demande de chaque bot pour chaque téléphone ouvre une question (« {bot} veut
   utiliser ton téléphone Android branché en USB », `kind: "phone"`, avec modèle, version et numéro de série) ; le oui
   vaut pour ce bot et ce téléphone jusqu'à Stop ou la fermeture du Relais. Lister les téléphones ne demande rien.
2. **Un bot à la fois par téléphone** : un autre bot reçoit `busy` (avec `holder`, `retryAfterMs`) tant que le premier a
   agi il y a moins de 20 s. « {téléphone} utilisé par {bot} » est affiché sur l'ordinateur (bandeau rouge, fenêtre,
   icône) et envoyé à Sklubot : événements `phone.started { bot, serial, model }` et `phone.ended { bot, serial, model,
   reason }` (`reason` : `bot`, `stopped`, `idle` après 2 min, `unplugged`, `handover`, `user_stop`, `hotkey`,
   `disconnected`, `paused`).
3. **Stop gagne** : il termine toutes les utilisations, coupe les commandes `adb` en cours, oublie tous les accords et
   verrouille le Relais (`locked`, comme pour l'ordinateur).
4. **Jamais** dans Sklubot lui-même, l'installateur d'applis (`packageinstaller`, `permissioncontroller`) ni les
   réglages (`com.android.settings`) → `blocked_app` ; ni dans une appli de la liste « garder à l'écart » (`guard.set
   keepApps`, comparée au nom du paquet) → `keep_out`. L'appli au premier plan est relue juste avant chaque capture,
   lecture, appui, glissement, saisie ou Entrée ; illisible → `foreground_unknown`.
5. **Mot de passe** : avant `android.type`, le champ qui a le focus est relu ; un champ mot de passe est refusé
   (`password_field`) sauf `force: true` (seulement depuis le coffre, `phone_vault_fill`, après une carte Sklubot) **et** un
   nouveau oui sur l'ordinateur (`kind: "phone_password"`). Le journal local ne garde que la longueur du texte.

Nouveaux codes d'erreur : `adb_missing`, `phone_unauthorized`, `phone_offline`.

Côté serveur : outils `phone_devices`, `phone_screen`, `phone_ui_tree`, `phone_tap`, `phone_swipe`, `phone_type`,
`phone_key`, `phone_open`, `phone_vault_fill` (`server/src/agent/phoneusb.ts`) ; carte « Utiliser le téléphone » la première fois (stricte
après un contenu extérieur) ; carte à usage unique pour un appui sur une commande qui engage (envoyer, payer, supprimer,
publier, confirmer, **installer / désinstaller / mettre à jour**), lue dans le dernier `android.ui` et relue avant l'appui ;
jamais de mot de passe écrit par le bot : `phone_type` est refusé dans un champ mot de passe ; `phone_vault_fill`
(identifiant, mot de passe ou code enregistré au coffre, règles du coffre) montre une carte à usage unique (élément,
champ, appli, « •••• (N caractères) ») puis envoie `force` ; le secret n'est jamais dans les arguments d'un outil, donc
jamais dans la carte, la discussion, les étapes ou le journal. Réglages → Ordinateurs : `GET /api/relay/devices/:id/android`, `POST /api/relay/devices/:id/android/stop`
(`server/src/androidusbroutes.ts`, « Arrêter » tient le bot à l'écart 10 min, jusqu'à ce que le propriétaire lui
écrive). Tests : `companion/test/unit/android-usb.test.js` (faux `adb`), `server/test/android-usb.test.ts` (faux Relais
qui répond avec le code du Relais et le faux `adb`).
**Non vérifié** avec un vrai téléphone ni un vrai `adb` : les formats de sortie (`adb devices -l`, `uiautomator dump`,
`dumpsys window`) viennent de la documentation et sont joués par un faux programme.
