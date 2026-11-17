# Importer depuis Grok Bot

Sklubot peut recréer, en quelques clics, les bots que tu fais tourner dans **Grok Bot** (ou dans un autre assistant) :
tu colles une consigne dans ta conversation là-bas, l'assistant répond par un export structuré, et tu colles cette
réponse dans Sklubot. Sklubot est un produit indépendant : il n'est ni affilié à xAI ni approuvé par elle. La consigne,
le format et le code d'import sont propres à Sklubot (aucun texte, prompt ni code d'un autre produit n'a été repris).

Où : **Réglages → Équipe → Importer depuis Grok Bot**.

## Les trois étapes

1. **La consigne.** Copie la consigne (en français ou en anglais) et colle-la dans ta conversation avec l'assistant.
2. **La réponse.** Colle toute sa réponse : les phrases autour du bloc ne gênent pas. Sklubot lit le bloc, corrige les
   petites fautes de JSON, vérifie chaque champ et **retire tout ce qui ressemble à un secret** (il te dit où, jamais quoi).
3. **L'aperçu.** Tu coches ce que tu gardes, tu peux renommer les bots, les compétences et les routines, et corriger
   l'horaire d'une routine. **Rien n'est créé avant « Importer ».** L'aperçu reste valable 15 minutes.

## Ce que l'import crée (un paquet prudent)

| Élément | Comment il arrive |
|---|---|
| Bots | Autonomie **prudente** (il demande avant d'agir), modèle **par défaut du compte**, outils par défaut. Un nom déjà pris devient « Nom (2) ». |
| Compétences | En **brouillon** : visibles dans les réglages du bot (Compétences), jamais données au bot ni partagées tant que tu ne les as pas activées. |
| Routines | Créées **en pause**, avec l'horaire cron lu ou corrigé. Une routine sans horaire valide n'est pas créée : elle est listée dans la note « À faire ». Une routine en pause ne compte pas dans la limite de routines actives de l'offre. |
| Souvenirs | Seulement ceux que tu as **cochés** (aucun n'est coché d'avance), marqués « importé ». |
| Applications | Rien n'est connecté : une note « À faire » dans la conversation du bot liste les applications à connecter (Réglages → Applis). |
| Clés, mots de passe, autorisations | **Jamais.** Aucune clé, aucune règle d'autorisation, aucune approbation n'est créée. |

Tout se fait en une seule transaction : si une limite est atteinte (nombre de bots de l'installation, ou de l'offre en mode
hébergé), rien n'est créé et le message dit quoi faire. Une ligne est ajoutée au journal d'activité.

## La consigne (français)

````text
Je déplace mes bots vers une autre application. Prépare un export de chacun des bots (ou assistants) que tu fais tourner pour moi, en respectant exactement ces règles.

1. Ta réponse contient UN SEUL bloc de code, ouvert par ```json et fermé par ```. Une phrase avant ou après le bloc est permise, rien d'autre dans le bloc.
2. Le bloc est un JSON valide (guillemets droits, aucune virgule en trop, aucun commentaire) de cette forme exacte :
{
  "format": "sklubot-bots",
  "version": 1,
  "bots": [
    {
      "name": "",
      "role": "",
      "personality": "",
      "instructions": "",
      "memories": [""],
      "skills": [{ "name": "", "when": "", "steps": [""] }],
      "routines": [{ "name": "", "schedule": "", "cron": "", "timezone": "", "task": "" }],
      "apps": [""]
    }
  ]
}
3. Un objet par bot dans "bots". Ce que veut dire chaque champ :
   - "name" : le nom du bot.
   - "role" : son travail, en une ou deux phrases.
   - "personality" : sa personnalité et son ton.
   - "instructions" : les consignes qu'il suit, telles que je les lui ai données.
   - "memories" : les faits sur moi qu'il garde et que j'ai accepté de partager. Un fait par ligne ; je les relirai un par un.
   - "skills" : ses savoir-faire ; pour chacun, son nom, quand s'en servir ("when") et ses étapes dans l'ordre ("steps").
   - "routines" : ses tâches régulières ; "schedule" dit quand en mots simples, "cron" donne l'expression cron à 5 champs si tu en es sûr (sinon ""), "timezone" le fuseau horaire (par exemple "Europe/Paris", sinon ""), "task" ce qu'il fait à chaque fois.
   - "apps" : les applications qui lui sont connectées, par leur nom seulement (par exemple "Gmail").
4. Une rubrique vide reste vide : [] ou "". N'invente rien.
5. Ne mets JAMAIS dans l'export : mot de passe, clé d'API, jeton (token), cookie, code de vérification, identifiant de connexion, numéro de carte ou de compte bancaire, ni aucune donnée privée d'autres personnes (leurs coordonnées, leurs messages). Si un texte en contient, remplace ce passage par [RETIRÉ].
````

## The prompt (English)

````text
I am moving my bots to another app. Prepare an export of each bot (or assistant) you run for me, following these rules exactly.

1. Your reply contains ONE code block only, opened with ```json and closed with ```. A sentence before or after the block is fine; nothing else goes inside the block.
2. The block is valid JSON (straight quotes, no extra commas, no comments) in exactly this shape:
{
  "format": "sklubot-bots",
  "version": 1,
  "bots": [
    {
      "name": "",
      "role": "",
      "personality": "",
      "instructions": "",
      "memories": [""],
      "skills": [{ "name": "", "when": "", "steps": [""] }],
      "routines": [{ "name": "", "schedule": "", "cron": "", "timezone": "", "task": "" }],
      "apps": [""]
    }
  ]
}
3. One object per bot in "bots". What each field means:
   - "name": the bot's name.
   - "role": its job, in one or two sentences.
   - "personality": its personality and tone.
   - "instructions": the instructions it follows, as I gave them.
   - "memories": the facts about me it keeps and that I agreed to share. One fact per line; I will review each one.
   - "skills": what it knows how to do; for each, its name, when to use it ("when") and its steps in order ("steps").
   - "routines": its recurring jobs; "schedule" says when in plain words, "cron" gives the 5-field cron expression if you are sure (otherwise ""), "timezone" the time zone (for example "Europe/Paris", otherwise ""), "task" what it does each time.
   - "apps": the apps connected to it, by name only (for example "Gmail").
4. An empty section stays empty: [] or "". Do not make anything up.
5. NEVER put in the export: passwords, API keys, tokens, cookies, verification codes, sign-in details, card or bank account numbers, or any private data about other people (their contact details, their messages). If a text contains any, replace that part with [REMOVED].
````

## Format de l'export (version 1)

Un seul bloc ```json contenant un objet :

| Champ | Type | Sens | Limite |
|---|---|---|---|
| `format` | texte | toujours `"sklubot-bots"` | — |
| `version` | nombre | `1` (une version plus récente est lue au mieux, avec un avertissement) | — |
| `bots` | liste | un objet par bot | 20 bots |
| `bots[].name` | texte | nom du bot | 60 caractères |
| `bots[].role` | texte | son travail (devient la description du bot) | 500 |
| `bots[].personality` | texte | personnalité et ton (ajoutés aux consignes) | 2 000 |
| `bots[].instructions` | texte | consignes permanentes | 6 000 |
| `bots[].memories` | liste de textes | faits sur l'utilisateur, à relire | 50 × 500 |
| `bots[].skills[]` | objets `{ name, when, steps }` | `steps` : liste d'étapes (ou un texte) | 30 |
| `bots[].routines[]` | objets `{ name, schedule, cron, timezone, task }` | `cron` à 5 champs ou `""` ; `timezone` IANA ou `""` (sinon le fuseau du profil) | 20 |
| `bots[].apps` | liste de textes | noms d'applications seulement (adresses et liens retirés) | 30 |

Tolérances : texte autour du bloc, plusieurs blocs (le premier qui est un export gagne), bloc non fermé, pas de bloc du
tout, virgules finales, commentaires `//`, retours à la ligne bruts dans les textes, guillemets typographiques, liste de
bots sans enveloppe, quelques noms de champs en français (`nom`, `consignes`, `competences`, `etapes`…). Les champs
inconnus sont ignorés et signalés. Taille maximale : 200 Ko.

Ce qui est retiré et signalé : clés et jetons reconnus (format `sk-…`, `ghp_…`, `xai-…`, JWT, clés privées…),
valeurs après « mot de passe : », « token : », « api key : », cookies, valeurs « Bearer », numéros de carte (contrôle de
Luhn), et tout champ dont le nom évoque un identifiant (`password`, `apiKey`, `token`, `cookie`, `secret`…).
C'est un filet de sécurité, pas une garantie : relis l'aperçu, surtout les souvenirs.

## API

`POST /api/import/grok/preview` puis `POST /api/import/grok/commit` : voir `docs/API.md`. Code : `server/src/grokimport.ts`.
