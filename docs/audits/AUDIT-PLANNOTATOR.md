# Audit de Plannotator (backnotprop/plannotator) face à Sklubot

Date : 22/11/2026. Clone `--depth 1` en lecture seule, rien exécuté. Sources lues : `README.md`, la documentation
(`apps/marketing/src/content/docs/**` : plan-review, annotate, questions, inbox, sharing, ai-features, gates, custom
feedback…), `packages/ui/types.ts` et la liste des composants de `packages/ui/components`. Côté Sklubot : `tools.ts`
(`ask_user`), `goals.ts` (`goal_propose`), `pagetools.ts`, `peerreview.ts`, `web/src/components/Cards.tsx`,
`SecretsFilesProviders.tsx` (carte « Fichiers modifiés »), `PageVersions.tsx`, `docker/desktop/Dockerfile`.

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 11 | 20 | 19 | 4 | 17 |

(73 lignes, dont 2 non vérifiées. Pas de compétences au sens « pack » : le dossier `apps/skills` ne contient que les commandes du produit.)

## Licence

**Double licence au choix : Apache 2.0 (`LICENSE-APACHE`) ou MIT (`LICENSE-MIT`)**, « Copyright 2025-2026 backnotprop ».
Les paquets `packages/core`, `ui`, `system`, `references` ont chacun un fichier Apache 2.0 ; l'extension VS Code
(`apps/vscode-extension`) est sous MIT d'un autre auteur. On peut tout copier, modifier, revendre en gardant l'avis de
licence. Le service hébergé (« Workspaces », partage chiffré, Inbox cloud) n'est pas dans le dépôt.

## Ce qu'est Plannotator

Un **outil de relecture** local, dans le navigateur, branché sur les agents de code. Quand l'agent propose un plan (mode
« plan »), finit un travail, écrit un document ou une page HTML, Plannotator s'ouvre : la personne surligne, barre,
commente, répond à des questions sous forme de cartes, puis **Approuve** ou **Renvoie** ; les annotations repartent vers
l'agent comme un retour structuré. Il fait aussi la revue de code (diff local, PR GitHub/GitLab) avec commentaires
ligne par ligne, et une « Inbox » où les agents laissent questions, fichiers et revues pendant qu'ils continuent.

## Peut-on l'installer dans l'image de bureau des bots (`docker/desktop/Dockerfile`) ?

**Non recommandé.**
- Le bureau des bots contient déjà Claude Code et Codex (`Dockerfile:28`). Les crochets de Plannotator interceptent le
  mode plan de Claude Code et **attendent une décision humaine dans un navigateur** ; les moteurs de Sklubot tournent sans
  surveillance (`engine.ts`), un tour resterait bloqué jusqu'au délai de la veille (`watch.ts`). Sur les versions
  récentes, le « mod » rend la main et la décision revient plus tard en message : mieux, mais elle reviendrait dans le
  bureau du bot, pas dans le chat Sklubot où l'utilisateur se trouve.
- L'installeur est un `curl … | bash` qui télécharge le binaire depuis GitHub, peut contacter npm et configure des
  crochets dans chaque agent trouvé ; le dépôt contient aussi un service de télémétrie (`apps/telemetry`). On pourrait
  épingler une version (`--version`, `--minimal`), comme pour `agent-reach` (`Dockerfile:31-44`), mais le gain serait nul :
  l'utilisateur ne regarde pas le navigateur du bot pour relire.
- **Ce que renvoie l'outil** : un texte Markdown de retour (« L'utilisateur a supprimé… ; commentaire sur “…” : … ») ou un
  JSON `{"decision": "approved" | "annotated" | "dismissed", "feedback": "…"}`. **Ce que renvoie l'équivalent Sklubot** :
  une carte de question renvoie le choix comme prochain message de l'utilisateur (`tools.ts:1205-1211`) ; une carte
  d'accord renvoie oui/non ; la carte « Fichiers modifiés » permet de voir le diff, d'annuler, et de demander une
  relecture par un autre bot (`SecretsFilesProviders.tsx:106-190`, `peerreview.ts`). Il n'y a **pas** de retour annoté
  passage par passage.
- Conclusion : reprendre les **idées** dans l'interface web de Sklubot (annoter une réponse, une page, un diff ; cartes
  de question plus riches), pas installer l'outil.

## Tableau complet

Taille : S = moins d'une journée, M = quelques jours, L = une semaine ou plus.

### Relecture d'un plan

| Domaine | Fonction Plannotator | Statut | Preuve Sklubot (fichier:ligne) | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Plan | Le plan de l'agent s'ouvre tout seul pour relecture avant d'agir (crochet `ExitPlanMode`) | PARTIEL | `goal_propose` : carte « accepter / refuser » avant un objectif long (`goals.ts:313-326`) | La carte montre l'objectif, pas un **plan par étapes** ; rien n'oblige le bot à montrer son plan avant une tâche coûteuse | M |
| Plan | Approuver → l'agent exécute ; Refuser → les annotations partent comme retour | PARTIEL | Accepter / refuser l'objectif | Refuser ne permet pas de dire **quoi** changer, sauf en écrivant un nouveau message | S |
| Plan | « Approuver avec des notes » | MANQUANT | — | « D'accord, mais n'envoie pas l'e-mail sans me le montrer » attaché à l'approbation | S |
| Plan | Diff entre deux versions du plan (« Plan Diff ») quand l'agent le renvoie | MANQUANT | — | Voir ce qui a changé après une remarque | S |
| Plan | Archive des décisions de plan en lecture seule (`plannotator archive`) | PARTIEL | Les cartes restent dans la discussion ; journal d'audit | Pas de liste « décisions prises » | S |
| Plan | Approbation automatique en mode non interactif | FAIT | Mode « Auto » avec relecteur (`COUVERTURE.md` A5), routines sans surveillance | — | — |
| Plan | Messages renvoyés à l'agent personnalisables (`prompts.plan.denied`, `approvedWithNotes`…) | NON REPRIS | Textes fixes | Réglage pour développeurs | — |

### Annotation de documents, messages, pages

| Domaine | Fonction Plannotator | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Annotation | Surligner un passage et **commenter** ; supprimer (barrer) ; commentaire global (`AnnotationType` : DELETION, COMMENT, GLOBAL_COMMENT — `packages/ui/types.ts:24-26`) | MANQUANT | Réactions et retour 👍/👎 sur une réponse (`feedbackNote` `loop.ts:1658`) | Sélectionner une phrase d'une réponse ou d'une page du bot et dire « change ça » | M |
| Annotation | Annoter la **dernière réponse** de l'agent (`/plannotator-last`) | MANQUANT | — | Le cas le plus courant : corriger un brouillon d'e-mail du bot phrase par phrase | M |
| Annotation | Annoter un fichier Markdown, texte, config (YAML, JSON, CSV…) | MANQUANT | Fichiers du bot visibles (`my_files`, aperçu) | Commenter un fichier livré | M |
| Annotation | Annoter une **page HTML** rendue, ou un site local en direct via un proxy | MANQUANT | Pages du bot (`page_publish`), aperçu (`PagePreview.tsx`) | Cliquer sur un bloc de la page publiée et laisser une remarque au bot | M |
| Annotation | Annoter une URL (page récupérée et convertie en Markdown) | PARTIEL | Le bot lit une page (`page_read`, `web_fetch`) | L'utilisateur ne peut pas annoter la page lue | M |
| Annotation | Annoter un dossier (navigateur de fichiers) | NON REPRIS | — | Usage développeur | — |
| Annotation | Annoter des **images** (régions dessinées) — `ImageAnnotator`, `ImageRegions.tsx` | MANQUANT | Pièces jointes images dans le chat | « Mets le logo ici » en entourant une zone d'une image générée | M |
| Annotation | Diagrammes Mermaid / Graphviz rendus et annotables | PARTIEL | Les pages du bot peuvent contenir des diagrammes | Pas de rendu Mermaid dans les messages (non vérifié) | S |
| Annotation | Étiquettes rapides (« trop long », « à vérifier »…) — `QuickLabelDropdown.tsx` | MANQUANT | — | Retours en un clic | S |
| Annotation | Pièces jointes et mentions dans un commentaire | PARTIEL | Pièces jointes et mentions `@Bot` dans le compositeur (`ComposerMentions.tsx`) | Pas rattachées à un passage | — |
| Annotation | Fils de réponses sur une annotation (`inReplyTo`) | PARTIEL | Fils de discussion sur un message (`thread`) | Fil sur un message, pas sur un passage | — |
| Annotation | Brouillons d'annotations sauvegardés (rien de perdu si l'onglet se ferme) — tests `annotationDraftPersistence` | PARTIEL | Brouillon du compositeur (non vérifié) | — | S |
| Annotation | Retour structuré envoyé à l'agent (citation exacte + remarque) | MANQUANT | — | C'est le cœur : la remarque garde le texte exact visé | M |
| Annotation | Texte en couleur lisible (contraste corrigé automatiquement à 3:1) | NON REPRIS | Thème Sklubot | Détail | — |
| Annotation | Table des matières, rail de contenu, impression | PARTIEL | Pages du bot ; export PDF via OpenMan | — | — |

### Questions posées par l'agent

| Domaine | Fonction Plannotator | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Questions | Carte de question à choix unique | FAIT | `ask_user` avec jusqu'à 6 réponses (`tools.ts:1205-1211`), carte `question` (`Cards.tsx:352`) | — | — |
| Questions | Choix multiples (`:::question-multi`) | MANQUANT | — | Cocher plusieurs réponses | S |
| Questions | Réponse libre (`:::question-text`) | PARTIEL | L'utilisateur peut écrire un message | Pas de champ dans la carte | S |
| Questions | Contexte obligatoire : jamais de question « nue », quelques phrases sur l'enjeu | MANQUANT | `ask_user` n'a qu'un champ `question` | Champ « pourquoi je demande » affiché sous la question | S |
| Questions | Choix **recommandé** par l'agent, avec « pourquoi » | MANQUANT | — | Aide la personne pressée à valider en un clic | S |
| Questions | « Enjeu » (Stakes) en gras ; étiquette **« Irréversible »** | MANQUANT | Les accords d'actions irréversibles ont leur avertissement (`irreversible.ts`) | Pas sur les questions | S |
| Questions | Choix illustrés par des images (tuiles cliquables, zoom) | MANQUANT | — | « Quel visuel ? » avec 3 images générées | S |
| Questions | Une question déjà tranchée revient cochée quand l'agent renvoie le plan | NON REPRIS | — | — | — |
| Questions | Plusieurs questions dans un même document, réponses envoyées ensemble | MANQUANT | Une carte = une question | Un mini-formulaire de 3 questions | S |

### Revue de code

| Domaine | Fonction Plannotator | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Code | Diff des changements locaux | FAIT | Carte « Fichiers modifiés » avec diff par fichier (`SecretsFilesProviders.tsx:86-110`), route `/cards/:seq/files/diff` | — | — |
| Code | Annuler les changements | FAIT | Bouton « Annuler » avec confirmation (`SecretsFilesProviders.tsx:114-160`) | Plannotator n'a pas d'annulation : avantage Sklubot | — |
| Code | Commentaire sur une ligne du diff, suggestion de code, « inquiétude » (`CodeAnnotationType`) | MANQUANT | — | Commenter une ligne d'un fichier modifié par le bot | M |
| Code | Relecture par une IA qui poste des commentaires (Review Agents) | PARTIEL | Relecture par un autre bot (`peerreview.ts`, verdict approuvé / changements / non concluant) | Verdict global, pas ligne par ligne | S |
| Code | Revue guidée : l'agent range le diff en chapitres, le plus important d'abord | MANQUANT | — | Pour un gros changement de fichiers du bot ; peu fréquent chez les utilisateurs visés | M |
| Code | PR GitHub / GitLab / Bitbucket, Git, Jujutsu, Perforce, GitButler | NON REPRIS | Outils GitHub (`githubissues.ts`, `githubcontents.ts`) | Public développeur | — |
| Code | Revues personnalisées (consignes de revue à soi) — `docs/custom-reviews.md` | PARTIEL | Le bot relecteur suit les règles du compte | — | — |

### IA dans la relecture

| Domaine | Fonction Plannotator | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| IA | « Demander à l'IA » sur un passage sélectionné | MANQUANT | — | Sélectionner une phrase d'une page et demander « explique » | S |
| IA | « Demander à cette session » : la question va à l'agent qui a ouvert la relecture ; s'il travaille : « attendre la fin » ou « interrompre maintenant » | PARTIEL | Messages pendant un tour : file et « pilotage » (`drainSteering`, `loop.ts:712`) ; bouton stop | Le choix explicite « après / maintenant » n'est pas proposé (non vérifié dans l'interface) | S |
| IA | Si la session ne répond pas, le dire, **ne pas** basculer en silence sur une autre IA | DIFFÉRENT | Sklubot bascule sur un modèle de secours mais le **dit** dans la discussion (`loop.ts:519-523`) | Comparable ; Sklubot l'annonce | — |
| IA | Choix du fournisseur pour la relecture (Claude, Codex, autres CLI) | FAIT | Modèle du bot relecteur (`memory.ts:17-30`, `selectedBot`) | — | — |

### Inbox (boîte de réception des agents)

| Domaine | Fonction Plannotator | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Inbox | Une seule fenêtre où les agents laissent questions, fichiers, revues ; « rien ne bloque l'agent » | PARTIEL | Chaque bot a son chat ; non-lus (`bumpUnread`) ; « Aujourd'hui » (`today.ts`) | Pas de vue unique « tout ce qui attend ta réponse, tous bots confondus » (cartes en attente) | M |
| Inbox | Répondre d'un clic ; les réponses arrivent comme prochain tour de l'agent | FAIT | Cartes → message suivant (`tools.ts:1211`) | — | — |
| Inbox | Ouvrir depuis le téléphone via Tailscale ; app iOS (`apps/mobile/ios`) | FAIT | App mobile Expo (`mobile/`), notifications push | — | — |
| Inbox | Serveur MCP de l'Inbox pour tout agent | DIFFÉRENT | API bot (`botapi.ts`), MCP d'équipe | — | — |
| Inbox | `inbox call <action> <json>` pour scripter | NON REPRIS | — | — | — |
| Inbox | Graphique d'activité, comptes multiples | PARTIEL | Activité et usage (`usage.ts`) | — | — |
| Inbox | Statut / arrêt / redémarrage propres avec codes de sortie | NON REPRIS | — | — | — |

### Partage et équipe

| Domaine | Fonction Plannotator | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Partage | Lien de partage d'un plan annoté (contenu compressé **dans le fragment `#`**, jamais envoyé au serveur) | DIFFÉRENT | Pages publiques ou privées (`page_publish`, `publiclinks.ts`) | Sklubot héberge la page ; pas d'annotations partagées | — |
| Partage | Gros partages chiffrés, expirent après 7 jours | PARTIEL | Liens publics de fichiers (`file_public_link`) | Pas d'expiration automatique vérifiée | S |
| Partage | Importer la relecture d'un collègue et la fusionner | MANQUANT | — | Relire à deux une page avant de la publier | M |
| Partage | Désactiver le partage (`PLANNOTATOR_SHARE=disabled`) | FAIT | Les pages peuvent être privées ; réglages d'espace | — | — |
| Partage | Export vers Obsidian, Notion | PARTIEL | Connecteurs d'applis (`connectors.ts`) | Pas d'export direct d'une page | S |
| Partage | API d'annotations externes (`docs/integrations/external-annotations-api.md`) | NON REPRIS | — | — | — |

### Réglages, interface, accessibilité

| Domaine | Fonction Plannotator | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Interface | Raccourcis clavier documentés, mode Vim | PARTIEL | Palette de commandes (`CommandPalette.tsx`) | Pas de page des raccourcis (non vérifié) | S |
| Interface | Thèmes clair/sombre, réglages d'interface | FAIT | Thème Sklubot | — | — |
| Interface | Cibles tactiles et placement de la barre d'outils au toucher (tests dédiés) | NON VÉRIFIÉ | — | — | — |
| Interface | Annonces des nouveautés dans l'appli (dialogues) | FAIT | `announcements.ts`, `AnnouncementsView.tsx` | — | — |
| Interface | Mascotte animée (« Tater ») | NON REPRIS | Personnages Sklubot | — | — |
| Interface | Couverture des exigences UI vérifiée par script | NON REPRIS | — | — | — |

### Installation, sécurité, fiabilité

| Domaine | Fonction Plannotator | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Installation | Installeur qui détecte les agents et pose crochets, compétences, commandes | NON REPRIS | — | — | — |
| Installation | Installation minimale (binaire seul) | NON REPRIS | — | — | — |
| Installation | Désinstallation sûre : garde plans et réglages par défaut ; `--purge` demande de taper « purge » ; `--dry-run` ; s'arrête et explique si un fichier d'un autre outil ne se lit pas | PARTIEL | Suppression d'un bot avec ordre défini (`agent/retire.ts`), suppression de compte (`privacy.ts`) | Pas d'« aperçu de ce qui sera supprimé » avant d'effacer un bot (non vérifié) | S |
| Sécurité | Écoute seulement sur `127.0.0.1` | DIFFÉRENT | Serveur web authentifié | — | — |
| Sécurité | Avertissement de sécurité (`SECURITY.md`) | FAIT | `hardening.ts`, `docs/OUVERTURE-PUBLIQUE.md` | — | — |
| Sécurité | Télémétrie (service séparé) | NON REPRIS | — | Vie privée | — |
| Fiabilité | Toast « l'envoi a échoué » qui garde le retour (`SendFailureToast.tsx`) | PARTIEL | Erreurs d'API affichées | Garantir que le texte saisi n'est pas perdu si l'envoi échoue (non vérifié) | S |
| Fiabilité | Bannière « session remplacée » quand une autre fenêtre prend la main | NON VÉRIFIÉ | — | — | — |
| Fiabilité | Conteneurs distants, devcontainers, auto-hébergement | NON REPRIS | Déploiement VPS / Coolify (`docs/DEPLOIEMENT.md`) | — | — |
| Intégrations | Plugins Claude Code, Codex, Copilot, Gemini, OpenCode, Pi, Kiro, Droid, Amp, Cline, Qwen, Hermes, OpenClaw ; extension VS Code | NON REPRIS | — | Hors produit | — |
| Intégrations | « Grill me » : interface interactive pour une compétence de questions en rafale (blog) | NON REPRIS | — | — | — |
| Divers | Services annexes (feedback, paste, waitlist, relay, portal) | NON REPRIS | — | — | — |

## Écarts de comportement

Plannotator n'a ni bots, ni mémoire, ni routines, ni appels : seuls les flux « validations », « livraison de fichiers/pages »
et « une tâche longue » se comparent.

1. **Avant une tâche longue ou coûteuse (validation du plan).**
   - Plannotator : l'agent écrit un plan ; la personne le lit à son rythme, commente des passages précis, pose des
     questions ; « Refuser » renvoie un retour structuré ; l'agent revient avec une version 2 et un **diff** montre ce qui a
     changé. Rien ne s'exécute avant l'approbation.
   - Sklubot : pour un objectif long, `goal_propose` montre une carte « accepter / refuser » avec l'objectif
     (`goals.ts:313-326`) ; pour une action sensible, une carte d'accord liée à l'action. Pour une tâche moyenne (par
     exemple « prépare et envoie les 30 devis »), rien n'impose au bot de montrer un plan ; s'il le fait, c'est un message
     libre, et corriger un point oblige à réécrire tout le contexte.
   - Correctif : un outil `plan_propose` (étapes numérotées, chaque étape avec « ce que je vais faire / ce qui demande ton
     accord »), une carte avec « Approuver », « Approuver avec une note », « Modifier » (remarque par étape) ; la version
     suivante montre ce qui a changé. Taille M.

2. **Corriger un brouillon (livraison).**
   - Plannotator : sélectionner la phrase, « remplacer par… » ou « commentaire », envoyer ; l'agent reçoit la citation
     exacte et la remarque.
   - Sklubot : l'utilisateur doit recopier la phrase dans un nouveau message (« dans le 2e paragraphe, remplace… »). Avec
     un public non technique, c'est la source principale d'allers-retours.
   - Correctif : sur une réponse du bot ou une page, sélectionner du texte fait apparaître « Commenter » ; les remarques
     s'empilent et partent en un message structuré (`[Remarques sur ta réponse : « citation » → remarque]`). Taille M.

3. **Une question du bot.**
   - Plannotator : la question vient avec l'enjeu, la recommandation et sa raison, un drapeau « irréversible », parfois des
     images ; plusieurs questions peuvent être posées en même temps.
   - Sklubot : `ask_user` = une question + jusqu'à 6 réponses. Le bot met souvent le contexte dans un message à côté, ou
     pas du tout.
   - Correctif : ajouter à `ask_user` les champs facultatifs `why`, `recommended`, `irreversible`, `multi`, `images`, et la
     possibilité de grouper 2 à 4 questions dans une carte. Taille S.

4. **Fichiers modifiés par le bot.** Ici Sklubot fait **mieux** sur un point (annulation en un clic, relecture par un autre
   bot) et moins bien sur un autre (pas de commentaire par ligne). Correctif léger : un champ « remarque » par fichier
   dans la carte, envoyé au bot. Taille S.

## À faire (du plus utile au moins utile)

1. Commenter un passage d'une réponse ou d'une page du bot (sélection → remarque → retour structuré) — M. — FAIT 23/11 pour les pages aussi (`web/src/components/PageComment.tsx`, couche `server/src/clientshared/pagecomment.ts`).
2. Cartes de question plus riches : pourquoi, recommandation, irréversible, choix multiples, images, plusieurs questions — S.
3. `plan_propose` : plan par étapes à approuver, approuver avec note, version suivante avec diff — M.
4. Vue unique « ce qui attend ta réponse » (toutes les cartes en attente, tous bots) — M.
5. Remarque par fichier dans la carte « Fichiers modifiés » — S. — FAIT 23/11 (`web/src/components/FileRemark.tsx`).
6. Étiquettes rapides de retour sur une réponse (« trop long », « plus simple », « vérifie ») — S.
7. Annoter une image générée (zone entourée + remarque) — M. — FAIT 23/11 (repères numérotés et stylo, `web/src/components/ImageAnnotate.tsx`).
8. « Explique ce passage » sur une sélection — S.
9. Diff entre deux versions d'une page publiée (`PageVersions.tsx` ne fait que restaurer) — S.
10. Aperçu de ce qui sera supprimé avant d'effacer un bot ou ses données — S.
11. Relire une page à plusieurs avant publication — M.

## Non vérifié

- Le rendu Mermaid dans les messages Sklubot, la page des raccourcis, la sauvegarde des brouillons du compositeur.
- L'expiration des liens publics de fichiers Sklubot.
- La qualité réelle de l'interface Plannotator (non lancée) ; l'Inbox et l'app iOS lues seulement par la documentation.
