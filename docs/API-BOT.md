# Accès API d'un bot (clés API, API REST, serveur MCP)

Tu peux laisser tes propres programmes — un script, une automatisation, un client IA comme Claude Code, Claude Desktop
ou Cursor — parler à un de tes bots avec une **clé API**. Chaque clé ne vaut que pour **un** bot de **ton** compte.

Code : `server/src/botapi.ts` (clés et API REST), `server/src/botmcp.ts` (serveur MCP), `web/src/components/BotApi.tsx`
(l'onglet), migration 11 (`bot_api_keys`). Tests : `server/test/bot-api.test.ts`, et `server/test/isolation.test.ts`.

## Créer une clé

Pour piloter tous tes bots depuis le **Claude Code installé sur ton ordinateur**, ouvre plutôt **Réglages → Modèles → Piloter mes bots depuis Claude Code**. Choisis les permissions et crée ton accès d’équipe. Copie la commande adaptée à ton terminal, puis colle le jeton Sklubot à l’invite masquée. Dans une nouvelle session Claude Code, ouvre `/mcp` et demande « Liste mes bots Sklubot ». [Connexion HTTP de Claude Code](https://code.claude.com/docs/en/mcp)

Ce client se connecte à `/api/v1/team/mcp`. Il découvre automatiquement tes nouveaux bots. Chaque lecture, message ou tâche vise le `bot_id` choisi. Les chats Sklubot continuent d’utiliser leur modèle et leur bureau configurés. L’écran Modèles indique la dernière utilisation et permet de révoquer l’accès. Si tu dois remplacer la configuration locale existante, retire son ancienne entrée avec `claude mcp remove --scope user sklubot-team`, puis utilise la nouvelle commande.

Réglages du bot → **Accès API** → *Nouvelle clé* : un nom (le programme qui va s'en servir) et des permissions.

| Permission | Ce qu'elle permet |
|---|---|
| `read` (Lire) | le nom et l'état du bot ; ses messages et réponses (jamais le détail des outils, ni les cartes ni ce qu'elles contiennent) ; attendre une réponse |
| `write` (Écrire) | lui envoyer un message, en tant que programme extérieur |
| `tasks` (Tâches) | lui donner un objectif (mode objectif) et en suivre l'état |

- La clé (`sk_bot_` suivi de 32 octets aléatoires) n'est **affichée qu'une fois**. Le serveur n'en garde que l'empreinte
  SHA-256 et le début (`sk_bot_xxxxxx…`) pour que tu les distingues.
- La liste montre la date de création et la **dernière utilisation** de chaque clé. **Révoquer** la coupe aussitôt ; elle
  reste dans la liste, marquée révoquée.
- **10 clés actives au plus** par bot. Supprimer le bot (ou le compte) supprime ses clés.
- Créer et révoquer une clé laisse une ligne dans le journal d'activité (Réglages → Activité, « Canaux »).
- Seul le propriétaire du bot gère ses clés ; un membre d'un espace de travail où le bot est partagé ne voit pas l'onglet.

**Aucune clé ne peut** : répondre à une demande d'accord, supprimer quoi que ce soit, changer un réglage, ouvrir le coffre
ou les secrets, toucher aux connecteurs, ni joindre un autre bot ou le compte. Aucune route de l'API ne mène là ; une
clé n'est pas une session (toutes les autres routes de `/api` lui répondent 401).

## Ce qu'un programme peut — et ne peut pas — faire faire au bot

Un programme n'est **jamais toi** :

- Son message apparaît dans la discussion avec l'étiquette « API · *nom de la clé* » (origine `api`).
- Le bot est prévenu que ce n'est pas son propriétaire qui écrit ; le tour démarre **prudent**, comme après avoir lu
  du contenu extérieur (une page web, un e-mail).
- Ses mots ne comptent **jamais** comme les tiens : le bot ne peut pas les citer pour justifier une action (la
  vérification de citation ne lit que les messages que tu as tapés ou dits toi-même).
- **Toute action irréversible** (envoyer un message ou un e-mail, payer, supprimer, publier, confirmer un formulaire,
  réserver, commande destructrice) lancée dans un travail venu de l'API **attend ton oui** sur une carte — même si le bot
  est réglé sur « confiance », même si une règle « toujours autoriser » existe, même si le bot cite une de tes phrases
  plus anciennes. Ces cartes ne proposent jamais « Toujours ». C'est donc au moins aussi prudent que pour tes propres
  mots, et souvent plus.
- Un programme ne peut pas répondre à ces cartes : seul toi, dans l'application.
- Un message de l'API ne fait jamais expirer une demande d'accord en attente : il attend qu'elle soit réglée.

## Pause, plafonds, mode hébergé

- **Pause** : un bot en pause refuse les messages et objectifs de l'API (`409`, code `paused`) — rien n'est mis en file.
- **Plafonds d'usage** (`docs/PLAFONDS.md`) : le travail venu de l'API compte comme **travail sans surveillance**
  (personne ne regarde un programme travailler, et un programme peut boucler). Un plafond « sans surveillance » ou
  « tout » atteint refuse donc l'API (`429`, code `usage_cap`, avec `resetAt`), alors que tes propres messages passent
  toujours sous un plafond « sans surveillance ».
- **Mode hébergé** : un compte suspendu reste en lecture seule (`403`, code `suspended`) ; quand l'offre ne permet pas au
  bot de travailler (budget épuisé, modèle non permis), `403`, code `plan`. Le travail accepté est compté comme
  n'importe quel tour du bot.

## Limites

- 60 requêtes par minute et par clé ; 10 messages ou objectifs par minute et par clé ; 120 requêtes par minute et par
  adresse (les mauvaises clés comprises). Au-delà : `429` et `Retry-After: 60`.
- Corps de requête : 256 Ko au plus ; un texte ou un objectif : 20 000 caractères au plus (`413`).
- Une clé peut attendre 4 réponses à la fois (`wait`). Attente : 30 s par défaut, 120 s au plus (55 s par MCP).
- Un secret collé dans un message (clé, mot de passe…) est masqué avant d'être enregistré ou envoyé à un modèle.

## API REST

Adresse de base : `https://ton-sklubot.exemple/api/v1`. Authentification : `Authorization: Bearer sk_bot_…`.
Réponses en JSON ; une erreur est `{ "error": "phrase", "code": "code_stable" }`. Rien n'est mis en cache.

| Méthode | Chemin | Permission | Corps / paramètres | Réponse |
|---|---|---|---|---|
| GET | `/v1/bot` | aucune | – | `{ bot: { id, name, label, description, paused, busy, waitingForOwner }, key: { id, name, scopes } }` |
| GET | `/v1/bot/messages` | `read` | `?after=<seq>&thread=<seq>&limit=1…200` | `{ thread, messages: [{ seq, thread, role, from, name, text, at }], next, more }` |
| POST | `/v1/bot/messages` | `write` | `{ text, thread? }` | `202 { seq, thread, status: "queued", wait }` |
| GET | `/v1/bot/messages/:seq/wait` | `read` | `?timeout=0…120` | `{ status, seq, thread, replies, reply }` |
| POST | `/v1/bot/tasks` | `tasks` | `{ objective, thread?, maxRounds? }` | `202 { seq, thread, task: { id, objective, status, rounds, maxRounds, summary, reason, thread } }` |
| GET | `/v1/bot/tasks/:id` | `tasks` | – | `{ task }` (seulement un objectif donné par l'API à ce bot) |
| POST | `/v1/mcp` | selon l'outil | JSON-RPC MCP | voir plus bas |

- `from` : `owner` (toi), `bot`, `api`, `member` (membre d'un espace), `voice`, `other`. Seuls les messages et réponses
  sont lus : ni étapes d'outils, ni cartes, ni avis.
- `thread` : le `seq` d'un message de la discussion principale, pour travailler dans son fil (0 ou absent : la discussion
  principale).
- Lecture continue : rappelle `GET /v1/bot/messages?after=<next>`. Une réponse encore en cours d'écriture termine la page
  (`more: true`) : elle viendra entière au prochain appel.
- `status` de `wait` : `working` (le bot travaille encore), `done` (réponse dans `reply`), `no_reply` (le bot a fini
  sans écrire : tour sauté ou en échec, regarde l'application), `needs_approval` (le bot attend ton accord dans
  l'application — personne d'autre ne peut répondre), `paused`.
- Codes d'erreur : `401 unauthorized`, `403 scope | suspended | plan`, `404 not_found`, `409 paused | too_many_keys`,
  `413 too_long | too_large`, `429 rate_limited | usage_cap | too_many_waits`, `400` pour un corps invalide.

### Exemples curl

```sh
CLE="sk_bot_…"                       # la clé copiée à sa création
BASE="https://ton-sklubot.exemple/api/v1"

# Qui suis-je ?
curl -s "$BASE/bot" -H "Authorization: Bearer $CLE"

# Envoyer un message (réponse : 202 et le seq du message)
curl -s -X POST "$BASE/bot/messages" \
  -H "Authorization: Bearer $CLE" -H "Content-Type: application/json" \
  -d '{"text": "Fais-moi le point sur les factures en retard."}'

# Attendre la réponse (jusqu'à 60 s)
curl -s "$BASE/bot/messages/42/wait?timeout=60" -H "Authorization: Bearer $CLE"

# Lire la discussion après le message 40
curl -s "$BASE/bot/messages?after=40" -H "Authorization: Bearer $CLE"

# Donner un objectif (5 tours au plus), puis suivre son état
curl -s -X POST "$BASE/bot/tasks" \
  -H "Authorization: Bearer $CLE" -H "Content-Type: application/json" \
  -d '{"objective": "Classer les factures de mars dans le dossier Compta", "maxRounds": 5}'
curl -s "$BASE/bot/tasks/goal_…" -H "Authorization: Bearer $CLE"
```

## Serveur MCP

`https://ton-sklubot.exemple/api/v1/mcp`, transport **Streamable HTTP** (sans session : chaque requête est authentifiée
par la clé ; `GET` répond 405, ce que la spécification permet à un serveur qui n'ouvre pas de flux de lui-même). Construit
avec le SDK MCP officiel pour TypeScript (`@modelcontextprotocol/sdk`). Exactement **cinq outils**, rien d'autre :

| Outil | Permission | Ce qu'il fait |
|---|---|---|
| `list_bots` | aucune | le bot de la clé (une clé ne joint que son bot), son état et ce que la clé permet |
| `send_message` | `write` | `{ text, thread? }` → `{ seq, thread, status }` |
| `wait_reply` | `read` | `{ seq, timeout_seconds? (≤ 55) }` → comme `GET …/wait` |
| `read_messages` | `read` | `{ after?, thread?, limit? }` → comme `GET /v1/bot/messages` |
| `create_task` | `tasks` | `{ objective, max_rounds?, thread? }` → comme `POST /v1/bot/tasks` |

Une clé ne voit que les outils que ses permissions permettent (`list_bots` toujours). Les outils acceptent un `bot_id`
facultatif : un autre bot que celui de la clé est refusé. Pas de clé « de compte » : pour piloter plusieurs bots, crée une
clé par bot et ajoute un serveur par bot dans ton client (le plus petit périmètre possible pour chaque clé).

### Claude Code

Documentation : <https://code.claude.com/docs/en/mcp> (« Example with Bearer token »).

```sh
claude mcp add --transport http sklubot-juno https://ton-sklubot.exemple/api/v1/mcp \
  --header "Authorization: Bearer sk_bot_…"
```

Ou dans un `.mcp.json` de projet (le jeton lu dans une variable d'environnement) :

```json
{
  "mcpServers": {
    "sklubot-juno": {
      "type": "http",
      "url": "https://ton-sklubot.exemple/api/v1/mcp",
      "headers": { "Authorization": "Bearer ${SKLUBOT_KEY}" }
    }
  }
}
```

### Claude Desktop

Claude Desktop **n'accepte pas** de serveur distant avec clé dans `claude_desktop_config.json` (ce fichier sert aux
serveurs locaux). Un serveur distant s'ajoute par l'interface des connecteurs
(<https://claude.com/docs/connectors/custom/remote-mcp>) :

1. **Personnaliser → Connecteurs → Ajouter → Ajouter un connecteur personnalisé**.
2. Nom : `Sklubot – Juno` ; URL : `https://ton-sklubot.exemple/api/v1/mcp`.
3. Authentification : **No sign-in** ; dans **Request headers**, en-tête `authorization`, valeur `Bearer sk_bot_…`
   (avec le mot `Bearer` et l'espace).

Attention : les « Request headers » sont **en bêta** et ne sont pas proposés à tous les comptes ; et Claude se connecte
depuis les serveurs d'Anthropic, donc ton Sklubot doit être **joignable sur Internet en HTTPS**. Sans ces en-têtes, un
pont local comme `mcp-remote` (paquet npm communautaire, <https://github.com/geelen/mcp-remote>) peut être déclaré dans
`claude_desktop_config.json` (Réglages → Développeur → Modifier la config) :

```json
{
  "mcpServers": {
    "sklubot-juno": {
      "command": "npx",
      "args": ["mcp-remote", "https://ton-sklubot.exemple/api/v1/mcp", "--header", "Authorization: Bearer ${AUTH_TOKEN}"],
      "env": { "AUTH_TOKEN": "sk_bot_…" }
    }
  }
}
```

### Cursor

Documentation : <https://cursor.com/docs/context/mcp>. Dans `~/.cursor/mcp.json` (ou `.cursor/mcp.json` d'un projet) :

```json
{
  "mcpServers": {
    "sklubot-juno": {
      "url": "https://ton-sklubot.exemple/api/v1/mcp",
      "headers": { "Authorization": "Bearer sk_bot_…" }
    }
  }
}
```

L'onglet **Accès API** montre ces extraits prêts à copier, avec la clé juste créée ou `sk_bot_…` à remplacer.

## Sécurité, en bref

- Une clé est comme un mot de passe : qui la détient lit la discussion de ce bot (permission `read`) et peut lui
  demander du travail (`write`, `tasks`). Donne à chaque programme sa propre clé, avec le moins de permissions possible,
  et révoque celle qui a fuité.
- L'API est servie sur le port web normal, sous `/api/v1`. Elle n'est jamais servie sur le canal privé des ordinateurs
  des bots (`botlink.ts`), et elle est distincte du point d'accès `/mcp/<bot>` que le moteur d'un bot utilise pendant
  ses tours (`agent/mcp.ts`, inchangé).
- Idées reprises (sans code) de l'API de bot et du serveur MCP d'OpenMausBot (Apache-2.0) : clé affichée une fois et
  gardée hachée, l'appelant ne répond jamais aux demandes d'accord, jeu d'outils volontairement réduit.
