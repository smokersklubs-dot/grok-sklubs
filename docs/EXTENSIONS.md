# Extensions de la vague 7 : documents partagés, téléphone, coffres en direct, autres agents, greffons

Ce guide explique, avec des mots simples, cinq ajouts du 23/11/2026. Chacun garde les règles habituelles de Sklubot :
ton accord, la séparation des comptes, le coffre et ses règles, le contrôle de sécurité des compétences.

## Documents partagés (L178)

Barre de gauche → **Documents partagés**. Un document Markdown que tu écris avec tes bots **en même temps**.

- Coche les bots qui peuvent le lire et l'écrire. Un bot ne voit que les documents que tu lui as partagés
  (outils `doc_live_list`, `doc_live_read`, `doc_live_edit`).
- Si vous tapez au même endroit au même moment, **les deux textes sont gardés** : chaque modification part avec la version
  sur laquelle elle a été faite, et le serveur intègre d'abord ce qui a changé entre-temps (transformation
  opérationnelle, code repris de ot.js, licence MIT).
- **Historique** : qui a changé quoi et quand (+ / − caractères). « Voir » montre le texte à cette version ; « Annuler »
  retire cette modification seulement, même si d'autres sont venues après (c'est une nouvelle modification, elle-même
  annulable). Les 2 000 dernières modifications sont gardées. 200 000 caractères et 100 documents au plus.

## Le téléphone comme outil (L177)

Un bot peut demander **une photo** (`phone_photo`) ou **ta position** (`phone_location`). La demande s'affiche en haut de
l'appli Sklubot sur ton téléphone, avec la raison et le temps qu'il reste (3 minutes).

- Rien n'est jamais pris sans ton geste, ni en arrière-plan : « Prendre la photo » ouvre l'appareil photo du système ;
  « Partager ma position » ouvre une page à usage unique où tu appuies encore sur « Partager », et le téléphone te demande
  aussi son autorisation. « Refuser » ne transmet rien.
- La photo est réduite à 1 600 px ; la position est donnée une fois (latitude, longitude, précision). Rien n'est gardé
  par le serveur.
- **Pas faits, avec la raison** : Android par USB (outil `adb`) — gratuit et officiel, mais il faut le mode
  développeur et le « débogage USB » sur le téléphone et un câble vers l'ordinateur ; le contrôle du téléphone existe déjà
  par l'appli Android (service d'accessibilité), sans ces réglages risqués. Bot qui rejoint une réunion — Zoom (Meeting SDK),
  Google Meet (Media API) et Teams (Graph, communications) demandent une inscription développeur, une validation ou un
  abonnement Azure payant : pas « officiel et gratuit » pour tout le monde. Live Activity iPhone et appli iOS : pas
  d'appli iOS construite ici.

## 1Password et Bitwarden en direct (L179)

Réglages → **Coffre** → « 1Password et Bitwarden, en direct ».

- 1Password : un **compte de service** (jeton `ops_…`) qui n'a accès qu'en lecture à un coffre. Bitwarden : ta clé d'API
  personnelle (client_id, client_secret) et ton mot de passe principal. Tout est scellé sur le serveur, jamais réaffiché.
- Sklubot utilise les **outils officiels** `op` et `bw`, installés sur le serveur, sans shell, avec seulement leurs
  propres variables. Il ne fait que **lire** : jamais créer, modifier ni supprimer dans ces coffres.
- « Relier un identifiant » l'ajoute à ton coffre Sklubot, marqué « en direct ». Les règles du coffre s'appliquent comme
  pour tout élément (bots autorisés, « demander à chaque fois », cartes, site vérifié avant de remplir, historique). Juste
  avant chaque usage par un bot, la valeur est **relue** dans 1Password ou Bitwarden ; si le coffre est injoignable,
  l'usage est refusé (jamais une valeur périmée).

## Autres agents : A2A et ACP (L172)

Réglages d'un bot → **Outils locaux** → « Autres agents ».

- **A2A** (Agent2Agent, spécification 1.0 : https://a2a-protocol.org/latest/specification/) : un agent sur le web. Sklubot
  lit sa fiche (`/.well-known/agent-card.json`), puis lui envoie un message en JSON-RPC (`SendMessage`, puis `GetTask` tant
  qu'il travaille). La forme 0.3 (`message/send`) est aussi comprise. Jeton d'accès facultatif, scellé.
- **ACP** (Agent Client Protocol v1 : https://agentclientprotocol.com) : un programme d'agent qui démarre **dans
  l'ordinateur du bot** qui l'appelle (jamais sur le serveur). Sklubot ne lui donne ni fichiers ni terminal ; quand il
  demande une permission, la réponse est **refuser**, sauf si tu coches « Autoriser ses actions dans l'ordinateur du bot ».
- Le bot utilise `agent_list` et `agent_ask`. Chaque envoi demande ton accord comme une app (« Toujours » possible), et
  **à chaque fois** après du contenu extérieur. La réponse de l'autre agent est du contenu extérieur.

## Greffons (L174)

Réglages d'un bot → **Outils locaux** → « Greffons ». Un greffon ajoute des outils venus d'ailleurs, qui tournent
**seulement dans l'ordinateur du bot**.

Format (`sklubot-plugin.json`, format `sklubot-plugin/1`) :

```json
{
  "format": "sklubot-plugin/1",
  "name": "notes",
  "version": "1.0.0",
  "description": "Lire et écrire des notes.",
  "run": { "command": "npx", "args": ["-y", "notes-mcp@1.0.0"] },
  "tools": [
    { "name": "list_notes", "description": "Liste les notes.", "readOnly": true },
    { "name": "send_note", "description": "Envoie une note.", "committing": true }
  ],
  "permissions": { "network": ["api.notes.example"], "files": "none" },
  "skill": { "name": "Notes", "when": "Quand on parle de notes", "steps": "…" }
}
```

- `run` : `npx`, `uvx` ou `bunx`, avec un paquet **à version exacte** ; il démarre comme un serveur d'outils local (MCP),
  par `docker exec` dans l'ordinateur du bot, sans shell, sans aucune variable ni secret (`permissions.secrets` est refusé).
- Seuls les outils **déclarés** sont proposés au bot ; un outil n'est en lecture seule que si le greffon ET le serveur le
  disent ; un outil `committing` demande toujours ton accord.
- `permissions` est affiché avant l'installation ; le réseau et les fichiers restent ceux de l'ordinateur du bot (ses
  règles internet) : un greffon ne les élargit jamais, et une adresse refusée par ces règles est signalée.
- Le **contrôle de sécurité des compétences** lit la description, les outils et la compétence : un danger bloque
  l'installation tant que tu n'as pas lu et accepté. La compétence éventuelle arrive en brouillon.
- Un bot peut seulement **proposer** un greffon (`plugin_propose`) : rien ne tourne avant que tu l'installes.
- Pour enchaîner plusieurs outils en un passage, c'est toujours `run_steps` : un greffon n'appelle pas les outils de Sklubot.
