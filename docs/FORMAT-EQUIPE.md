# Format « Équipe Sklubot (.md) » — `sklubot-team/1`

Une **équipe complète dans un seul fichier Markdown** : ses bots, leurs consignes, leurs compétences, leurs routines,
ses groupes et les applis qu'elle utilise. Le fichier a deux parties :

1. un **en-tête YAML** (entre deux lignes `---`) : la partie que Sklubot lit ;
2. un **mode d'emploi** en Markdown : la partie que les humains lisent (Sklubot la montre à l'import, sans jamais
   l'exécuter ni en tirer de réglage).

On peut le mettre sur GitHub ou dans un gist, l'envoyer par e-mail, le relire dans n'importe quel éditeur.

> À ne pas confondre avec le « fichier d'équipe » des **modèles** (`format: sklubot-equipe`, docs/MODELES-EQUIPE.md),
> où chaque bot est une section `## Bot:` du texte. Le format `sklubot-team/1` met toute la structure dans l'en-tête,
> et ajoute les groupes, les applis, le chef d'équipe, le cerveau suggéré et la mise à jour d'une équipe déjà importée.

## Où le trouver dans Sklubot

- **Importer** : bouton **+** de la barre latérale → **Importer une équipe (.md)** (aussi dans la palette de commandes).
  Trois sources : un fichier choisi, un texte collé, ou un lien `https` (une page GitHub `…/blob/…` ou un gist sont lus
  dans leur version brute).
- **Partager** : menu d'une section ou d'un bot dans la barre latérale → **Partager en fichier .md**. Sklubot montre le
  fichier, on le copie ou on le télécharge.
- **Par un bot** : demande-lui « exporte l'équipe en .md ». Il utilise l'outil `team_export` : le fichier va dans sa
  bibliothèque (`~/files/equipes/…`) et apparaît dans la discussion. C'est une copie pour toi, sans validation à
  donner ; le bot ne le **publie jamais** de lui-même (GitHub, gist, page publique) : c'est toi qui choisis.

Code : `server/src/teammdyaml.ts` (le YAML), `server/src/teammd.ts` (lecture, écriture, mode d'emploi),
`server/src/teammdimport.ts` (lien, aperçu, création, partage), `server/src/teammdroutes.ts` (API),
`server/src/agent/teamexport.ts` (outil `team_export`), `web/src/components/TeamMarkdown.tsx` (écrans).
Tests : `server/test/team-markdown.test.ts`. Captures : `docs/screenshots/equipe-md/`.

## La sécurité d'abord

- **Rien n'est créé avant « Créer l'équipe »**. L'aperçu lit le fichier et montre tout : bots, compétences, routines,
  groupes, applis à connecter, conflits de noms, limites de l'offre.
- Un fichier **ne transporte jamais** : clé, jeton, mot de passe, coffre-fort, conversation, souvenir, permission,
  niveau d'autonomie ou de validation, ordinateur, adresse de serveur, e-mail, Telegram, plafond de dépense. Un champ de
  ce genre est **retiré** et listé (« non autorisé », « ressemble à un identifiant », « non reconnu ») sans jamais
  montrer sa valeur. Tout passage d'un texte autorisé qui ressemble à un secret devient `[secret retiré]`, et une
  compétence dont le texte semble contenir une clé est **signalée et décochée**.
- Les bots créés démarrent **en mode prudent**, sur le **cerveau par défaut du compte** (le cerveau suggéré n'est
  utilisé que si tu le coches et que ton compte y a accès), avec les outils par défaut.
- Les **routines arrivent en pause** (même si le fichier dit le contraire) ; une routine sans horaire valide n'est pas
  créée. Les compétences de la **Bibliothèque** sont ajoutées actives (ce sont celles livrées avec Sklubot) ; celles
  écrites dans le fichier arrivent **en brouillon**.
- Les **applis** ne sont que des noms : rien n'est connecté, chacun connecte ses propres comptes ensuite.
- Un lien est récupéré en **https seulement**, par le garde réseau du serveur (jamais d'adresse privée ou locale, chaque
  redirection revérifiée et forcée en https), **512 Ko au plus** (fichier, texte collé ou réponse du lien).
- Les **limites** de l'installation et de l'offre (mode hébergé) sont vérifiées avant d'écrire quoi que ce soit : si ça
  ne rentre pas, rien n'est créé, pas même la section.
- Le partage ne lit que **tes propres bots** ; seuls les noms d'applis du **catalogue** de Sklubot sont écrits (jamais
  une adresse ou un nom de serveur maison), et un cerveau d'un fournisseur propre au compte (`up-…`) n'est jamais écrit.

## Réimporter : mettre à jour ou copier

Chaque fichier porte un `id`. Si tu as déjà importé une équipe de même `id`, l'aperçu le dit et propose :

- **Mettre à jour** : les mêmes bots reçoivent le rôle, les consignes et l'apparence du fichier ; les compétences et
  routines **nouvelles** (par nom) sont ajoutées ; les groupes sont remis à jour. Rien n'est supprimé, le nom, les
  souvenirs, les conversations et les réglages des bots restent.
- **Créer une copie** : de nouveaux bots à côté des premiers (un numéro est ajouté aux noms déjà pris).

Partager à nouveau une section importée garde son `id` : le fichier repartagé se réimporte en « Mettre à jour ».

## L'en-tête, champ par champ

Toutes les valeurs sont du **texte** (rien n'est deviné : `1.10`, `no` ou `2024-01-01` restent du texte).

| Champ | Contenu |
|---|---|
| `format` | **obligatoire** : `sklubot-team/1` |
| `id` | identifiant stable de l'équipe (lettres, chiffres, `.`, `_`, `-` ; 3 à 64) ; à défaut, tiré du nom |
| `name`, `description` | nom et phrase de présentation |
| `version` | version de **ton** équipe (texte libre, ex. `1.3`) |
| `language`, `author` | langue (`fr`, `en`) et auteur |
| `chief` | nom du bot chef d'équipe : il mène les groupes, et l'import propose d'en faire ton bot principal |
| `bots` | liste des bots (20 au plus) |
| `groups` | liste des groupes (discussions à plusieurs bots) |
| `connectors` | applis à connecter, **par nom seulement** |

Par bot :

| Champ | Contenu |
|---|---|
| `name` | nom (un numéro est proposé s'il est déjà pris) |
| `role` | rôle, en une phrase |
| `look` | apparence : `shape`, `color`, `type`, `eyes`, `accessory`, `idle`, `mouth`, `cheeks`, `intensity`, `tint` |
| `personality` | ton et personnalité |
| `instructions` | consignes (bloc `|-` sur plusieurs lignes) |
| `model` | cerveau **suggéré**, `fournisseur:modèle` (jamais une clé) |
| `skills` | compétences : `- library: <id>` (Bibliothèque) ou `- skill_md: |-` suivi d'un SKILL.md complet (ou `name`, `when`, `steps`) ; 30 au plus |
| `routines` | `name`, `cron` (5 champs), `timezone`, `task` ; 20 au plus ; toujours en pause |
| `connectors` | noms d'applis pour ce bot (s'ajoutent à la liste de l'équipe) |

Par groupe : `name`, `members` (noms de bots du fichier, au moins deux), `rule` (**qui répond** : `lead` le meneur
d'abord, `everyone` tout le monde, `mentions` seulement le bot mentionné, `auto` Sklubot choisit) et `lead` (le meneur,
placé en premier).

Par appli : `name`, `for` (les bots qui s'en servent), `why` (à quoi elle sert). Une adresse, un e-mail ou une clé dans
le nom sont retirés.

### Le YAML accepté

Un sous-ensemble simple et sûr, lu sans dépendance : `clé: valeur`, listes `- élément` et `- clé: valeur`, textes entre
`"…"` (échappements JSON) ou `'…'`, blocs `|`, `|-`, `|+`, `>`, `>-`, listes courtes `[a, "b"]`, `[]`, `{}` et
commentaires `#`. **Refusés**, avec la ligne et une phrase claire : ancres `&`, alias `*`, étiquettes `!`, clés de fusion
`<<`, clés complexes `?`, `{ … }` non vide, tabulations en début de ligne, clé en double, plus de 10 niveaux.

## Exemple complet

```markdown
---
format: sklubot-team/1
id: agence-contenu-7f3a
name: "Agence de contenu"
description: "Trois bots qui écrivent, relisent et publient les contenus d'une petite agence."
version: "1.3"
language: fr
author: "Agence Exemple"
chief: "Léa"
bots:
  - name: "Léa"
    role: "Coordonne l'équipe et le calendrier éditorial"
    look:
      shape: cat
      color: plum
      type: mascot
      eyes: visor
    model: "openrouter:anthropic/claude-sonnet-4.5"
    personality: "Claire, posée, va droit au but."
    instructions: |-
      Tu reçois les demandes des clients, tu les découpes en tâches
      et tu les confies à Max ou à Zoé.

      Rien n'est publié sans mon accord.
    skills:
      - library: methode-de-travail
      - skill_md: |-
          ---
          name: "Brief client"
          description: "Quand un client envoie une demande"
          ---

          1. Reformuler la demande en trois lignes.
          2. Lister ce qui manque et le demander.
          3. Proposer un planning.
    routines:
      - name: "Point du lundi"
        cron: "0 9 * * 1"
        timezone: Europe/Paris
        task: "Fais le point de la semaine : ce qui est prêt, ce qui bloque, ce qui arrive."
  - name: "Max"
    role: "Rédige les articles et les newsletters"
    look:
      shape: mochi
      color: teal
    instructions: "Tu écris dans le ton de chaque client, avec des phrases courtes."
    connectors: ["Google Drive"]
  - name: "Zoé"
    role: "Publie et répond aux commentaires"
groups:
  - name: "Comité éditorial"
    members: ["Léa", "Max", "Zoé"]
    rule: auto
    lead: "Léa"
connectors:
  - name: "Notion"
    why: "le calendrier éditorial"
---

# Agence de contenu

Trois bots qui écrivent, relisent et publient les contenus d'une petite agence.

## L'équipe

- **Léa** (chef d'équipe) — coordonne et tient le calendrier
- **Max** — rédige articles et newsletters
- **Zoé** — publie et répond aux commentaires

## Comment l'utiliser

Envoie tes demandes à Léa ou dans le groupe « Comité éditorial ». Connecte Google Drive et Notion
après l'import, puis active les routines que tu veux garder.
```

## API

Toutes les routes agissent sur le compte connecté uniquement.

| Route | Corps | Réponse |
|---|---|---|
| `POST /api/team-md/preview` | `{ text, filename }` ou `{ url }` | l'aperçu (`TeamMdPreview`) ; rien n'est créé |
| `POST /api/team-md/commit` | `{ previewId, mode: "create" \| "update" \| "copy", bots: [{ index, include, name?, skills?, routines?, useModel? }], groups?, section?, chiefPrimary? }` | `{ report }` |
| `POST /api/team-md/export` | `{ sectionId }` ou `{ botIds }`, `includeApps?` | `{ filename, text, bots, groups, connectors, masked }` |

Un aperçu expire après 15 minutes et ne sert qu'une fois. Les liens sont limités à 20 récupérations par heure et par
compte.
