# Modèles d'équipe et fichier d'équipe

Sklubot sait décrire une équipe de bots dans **un seul fichier Markdown**, lisible par un humain (et par n'importe quel
assistant IA), que l'on peut partager, mettre sur GitHub, ou réimporter sur un autre Sklubot. La même forme sert à la
**galerie de modèles** livrée avec Sklubot.

- **Partir d'un modèle** : bouton **+** de la barre latérale → *Partir d'un modèle* (aussi au premier lancement, dans
  la palette de commandes et dans Réglages → Équipe). La galerie se filtre par catégorie et par recherche.
- **Importer un fichier d'équipe** : même fenêtre, onglet *Fichier* (un `.md` choisi ou collé) ou *Lien* (une adresse
  https, par exemple un lien brut GitHub).
- **Exporter en modèle** : menu d'une section ou d'un bot dans la barre latérale, ou Réglages → Équipe. On coche les bots,
  on donne un titre ; Sklubot montre le fichier puis le télécharge.

Code : `server/src/teamfile.ts` (lecture, écriture, aperçu, création), `server/templates/*.md` (la galerie),
`web/src/components/TeamTemplates.tsx` (galerie, relecture, export). Tests : `server/test/team-templates.test.ts` et
`server/test/team-templates-hosted.test.ts`.

## Ce qu'un fichier peut contenir — et rien d'autre

Le format est une **liste blanche**. Par bot, un fichier peut porter :

| Élément | Où | Ce qu'il devient à l'import |
|---|---|---|
| nom | `## Bot: <nom>` | le nom du bot (un numéro est ajouté s'il est déjà pris) |
| rôle | `- role:` | sa description |
| personnalité | `### Personnalité` | ajoutée à ses consignes (« Personnalité et ton : … ») |
| consignes | `### Consignes` | ses consignes |
| compétences | `### Compétence: <nom>` | des compétences **en brouillon** (le bot ne s'en sert qu'une fois activées) |
| routines | `### Routine: <nom>` | des routines **en pause** (rien ne tourne avant que tu les actives) |
| applis suggérées | `- apps:` | une liste « À faire » dans la conversation du bot ; **rien n'est connecté** |
| apparence | `- look:` | forme, couleur et allure du personnage |

Un fichier **ne porte jamais** : modèle, niveau d'autonomie ou de validation, effort, outils, ordinateur, applis
connectées, connecteurs, clés, coffre-fort, souvenirs, conversations, espace de travail, partage, Telegram, voix,
plafonds de dépense. Si un fichier en contient quand même (à la main ou par malveillance), **le lecteur les retire** et
l'aperçu dit lesquels et où (« non autorisé », « non reconnu » ou « ressemble à un identifiant »), sans jamais montrer la
valeur. Tout ce qui ressemble à un secret dans un texte autorisé (clé d'API, jeton, mot de passe, cookie, numéro de
carte…) est remplacé par `[secret retiré]`.

Quoi que dise le fichier, les bots créés démarrent **en mode prudent** (ils demandent avant d'agir), sur le **modèle
par défaut du compte**, avec les outils par défaut.

## Le format, version 1

```markdown
---
format: sklubot-equipe
version: 1
title: "Boutique en ligne"
description: "Deux bots pour une petite boutique…"
icon: star
category: commerce
tags: ["e-commerce", "catalogue"]
language: fr
author: "Ton nom"
---

# Boutique en ligne

Un paragraphe libre (ignoré à l'import).

## Bot: Capucine

- role: Rédige et améliore les fiches produits.
- look: shape=mochi color=rose type=mascot eyes=round accessory=bow idle=float
- apps: Shopify, Google Drive

### Personnalité

Précise, enthousiaste sans en faire trop.

### Consignes

Tu t'occupes du catalogue de la boutique.
- Tu proposes toujours un brouillon : rien n'est publié sans mon accord.

### Compétence: Écrire une fiche produit

- when: Quand je donne un nouveau produit.

1. Rassembler les caractéristiques.
2. Écrire le titre.

### Routine: Contrôle du catalogue

- cron: 0 9 * * 1
- timezone: Europe/Paris
- schedule: chaque lundi à 9 h

Fais le tour des fiches modifiées la semaine passée.
```

### En-tête (front matter YAML)

Un bloc entre deux lignes `---` tout en haut. Seul un petit sous-ensemble de YAML est lu : `clé: valeur`, valeurs entre
guillemets `"…"` ou `'…'`, listes `[a, b]` ou en lignes `  - a`. Clés reconnues (alias français entre parenthèses) :

| Clé | Valeur |
|---|---|
| `format` | `sklubot-equipe` (un autre format est refusé ; absent : lu comme version 1, avec un avertissement) |
| `version` | `1` (plus grand : lu quand même, avec un avertissement) |
| `title` (`titre`) | titre de l'équipe, 80 caractères |
| `description` (`resume`) | une ou deux phrases, 400 caractères |
| `icon` (`icone`) | `users`, `chart`, `search`, `target`, `mail`, `calendar`, `book`, `image`, `star`, `bulb`, `shield`, `globe`, `folder`, `sun`, `brain`, `wrench`, `phone`, `chat`, `tasks`, `send` (sinon `users`) |
| `category` (`categorie`) | `commerce`, `marketing`, `sales`, `admin`, `finance`, `support`, `personal`, `research` |
| `tags` (`etiquettes`, `mots-cles`) | 8 au plus |
| `language` (`langue`) | par exemple `fr` |
| `author` (`auteur`) | libre |

Toute autre clé est retirée et signalée.

### Corps

- `# Titre` : facultatif (sert de titre si l'en-tête n'en a pas).
- `## Bot: <nom>` (ou `## Bot : <nom>`) : ouvre un bot. Un autre titre de niveau 2 (`## À propos`…) est ignoré et
  signalé, avec tout ce qu'il contient.
- Juste sous `## Bot:`, des **champs** : lignes `- clé: valeur` (clé d'un seul mot), suivies d'une ligne vide.
  `role` (`rôle`, `job`), `look` (`apparence`), `apps` (`applications`, `applis`, séparées par des virgules ; noms
  seulement : adresses et liens sont retirés).
- `### Personnalité` (`Personality`, `Ton`) et `### Consignes` (`Instructions`) : texte libre.
- `### Compétence: <nom>` (`Skill:`) : champ `- when:` (`quand`), puis une ligne vide, puis les étapes.
- `### Routine: <nom>` : champs `- cron:` (expression à 5 champs), `- timezone:` (`fuseau`, un fuseau IANA ; sinon
  celui du profil), `- schedule:` (`horaire`, en mots), puis une ligne vide, puis la tâche. Sans cron valide, la routine
  est montrée dans l'aperçu : tu peux en taper un ; sinon elle n'est pas créée et va dans la liste « À faire ».
- Tout autre `### …` est retiré et signalé (`### Souvenirs`, `### Modèle`… sont « non autorisés »).
- Un titre de niveau 4 ou plus, les listes, le gras, les blocs de code sont du texte ordinaire. Dans un bloc de code,
  rien n'est lu comme structure.
- Une ligne de texte qui commence par `#` est écrite `\#` à l'export ; la barre oblique est retirée à la lecture.

### Apparence (`look`)

Des paires `clé=valeur` séparées par des espaces : `shape` (`forme`), `color` (`couleur`), `type` (`mascot`, `dots`,
`muse`), `eyes` (`yeux`), `accessory` (`accessoire`), `idle` (`mouvement`), `mouth` / `cheeks` (`yes` / `no`),
`intensity` (0 à 1), `tint` (`teinte`, `#RRGGBB`). Les valeurs sont celles de l'éditeur d'apparence ; une valeur
inconnue reprend la valeur par défaut. Les réglages de comportement du personnage (suivi du curseur, euphorie, cri) ne
viennent jamais d'un fichier.

### Limites

200 Ko par fichier ; 20 bots, 30 compétences et 20 routines par bot, 30 applis ; les textes sont coupés aux mêmes
longueurs que dans l'application (consignes 6 000 caractères, compétence 20 000…). Au-delà, l'aperçu le dit.

## Import depuis un lien

L'adresse doit être en **https**. Le serveur la récupère via son garde réseau (`guardedFetch` : jamais un réseau privé
ou local, redirections vérifiées à chaque saut), en 20 secondes au plus, et **s'arrête au-delà de 200 Ko** (la taille
est comptée en lisant, pas seulement d'après l'en-tête). Une page web (HTML) ou un fichier qui n'est pas du texte est
refusé. Un lien de page GitHub `https://github.com/<compte>/<dépôt>/blob/<branche>/<chemin>` est converti en
`https://raw.githubusercontent.com/…`. L'aperçu affiche la source (hôte et chemin) ; elle est aussi notée dans le
journal d'activité et dans la note « À faire » de chaque bot créé. Quelques lectures d'adresse par compte et par quart
d'heure au plus.

## Aperçu puis création

1. **Aperçu** : rien n'est créé. Il est gardé 15 minutes, pour ce compte seulement. Il montre la source, ce qui a été
   retiré ou masqué, les avertissements, la place restante (limite `MAX_BOTS` du serveur, offre en mode hébergé).
2. **Relecture** : tu coches les bots, compétences, routines et applis gardés, tu peux renommer, corriger un cron, et
   ranger les bots dans une nouvelle section.
3. **Création** : en **une seule transaction** ; si une limite (serveur ou offre) ne le permet pas, **rien** n'est créé,
   pas même la section. Routines en pause : elles ne comptent pas dans les routines actives de l'offre tant que tu ne
   les actives pas.

## Export

« Exporter en modèle » écrit le fichier à partir de tes bots : nom, rôle (sa description), consignes (la personnalité
ajoutée par un import retourne dans sa section), compétences, routines planifiées, apparence. Il ne lit **jamais** les
souvenirs, les conversations, le modèle, l'autonomie, les outils, l'ordinateur, les connexions ni les clés ; chaque
texte passe par le masque à secrets, et la fenêtre dit combien de passages ont été masqués. Seuls tes propres bots et
sections peuvent être exportés.

## Galerie intégrée

Les modèles livrés sont des fichiers de `server/templates/` (un fichier par équipe, nom en minuscules et tirets). Ils
sont écrits pour Sklubot (textes originaux) et vérifiés par les tests : chacun se lit sans rien retirer, a une
description, une icône, une catégorie, et des routines planifiées. Pour en ajouter un, dépose un `.md` au même format
dans ce dossier.

| Fichier | Titre | Catégorie | Bots |
|---|---|---|---|
| `boutique-en-ligne.md` | Boutique en ligne | commerce | Capucine (fiches produits), Gaspard (commandes et stocks) |
| `seo-contenu.md` | Référencement et contenus | marketing | Noé (SEO), Iris (articles) |
| `reseaux-sociaux.md` | Réseaux sociaux | marketing | Lou (calendrier éditorial, publications) |
| `prospection-b2b.md` | Prospection B2B | sales | Hector (prospects), Margaux (messages et relances) |
| `secretariat.md` | Secrétariat et administratif | admin | Odile (e-mails, agenda, devis, échéances) |
| `suivi-finances.md` | Suivi des finances | finance | Colette (trésorerie, impayés, comptable) |
| `service-client.md` | Service client | support | Basile (réclamations, avis, FAQ) |
| `assistant-personnel.md` | Assistante personnelle | personal | Paloma (journée, rappels, rendez-vous) |
| `veille-recherche.md` | Veille et recherche | research | Ernest (concurrents, fournisseurs, synthèses) |

## Versions

- **1** (novembre 2026) : première version. Une version future ajoutera des champs ; un Sklubot qui lit la version 1
  ouvrira un fichier plus récent avec un avertissement, en ignorant (et signalant) ce qu'il ne connaît pas.

L'ancien export JSON (Réglages → Équipe → *Exporter l'équipe*, `sklubotTeam: 1`) reste disponible pour déplacer une
équipe complète d'un serveur à l'autre.
