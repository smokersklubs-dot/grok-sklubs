# Protocole Sklubot Relais — version 1

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
| `session.start` | non | `{ reason?: string ≤ 300 }` | `{ sessionId, grant: "once" \| "always" \| "test", already? }` |
| `session.end` | non | `{}` | `{}` |
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
| `busy` | un autre bot a la session |
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
| `session.started` | `bot`, `grant`, `sessionId` | session ouverte |
| `session.ended` | `bot`, `reason`, `sessionId` | `reason` : `bot` (session.end), `user_stop`, `hotkey`, `idle`, `paused`, `disconnected`, `stopped` |
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
