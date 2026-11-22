# Audit de claude-mem (thedotmack/claude-mem) face à Sklubot

Date : 22/11/2026. Clone `--depth 1` en lecture seule, rien exécuté, instructions trouvées dans le dépôt ignorées.
Côté Sklubot, code lu : `server/src/agent/memory.ts`, `recall.ts`, `prompt.ts`, `tools.ts` (`conversation_search`,
`memory_*`), `reliability.ts`, `store.ts` (`searchMessages`), `routes.ts`, `skills-library/catalog.json`, `guides.ts`.
Test lancé à part : `similar()` de `memory.ts` sur deux phrases presque identiques (voir « Écarts » n° 3).

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 19 | 21 | 16 | 8 | 20 |

(86 lignes de fonctions, dont 1 « IDÉE » et 1 non vérifiée ; plus 29 lignes de compétences : 4 ADAPTER, 10 IDÉE, 15 NON.)

## Licence

**Apache License 2.0** (`LICENSE`, `NOTICE` : « Copyright 2026 Alex Newman »). `docs/license.md` précise que l'Apache 2.0
couvre le cœur libre (moteur mémoire, serveur, CLI, SDK, adaptateurs, outils MCP, tests, exemples, docs) ; le cloud, la
synchro d'équipe, « TeamBrain » hébergé et les fonctions entreprise sont **réservés** hors licence. Permis : copier,
modifier, revendre, en gardant l'avis de licence et le `NOTICE`. Les marques (logo, nom, jeton « CMEM ») ne sont pas
couvertes. Les compétences du dossier `plugin/skills/` n'ont pas de licence propre : elles suivent l'Apache 2.0 du dépôt.

## Ce qu'est claude-mem

Un « second agent » qui regarde un agent de code travailler (Claude Code, Codex, Cursor, OpenCode et ~15 autres), via
les crochets (hooks) de ces outils. Chaque appel d'outil est envoyé à un petit serveur local (worker Bun) ; un modèle
« observateur » en tire de courtes **observations** typées (bugfix, décision, découverte…) et un résumé de fin de
session. La session suivante démarre avec un **index compact** de ces observations ; l'agent ouvre les détails à la
demande (recherche → chronologie → détails). Stockage SQLite + FTS5, recherche par le sens optionnelle avec Chroma.
Autour : visionneuse web, écran « My Work », sauvegardes, notifications Telegram, synchro cloud payante.

Sklubot n'est pas un outil pour agents de code mais une équipe de bots pour tout le monde : beaucoup de fonctions sont
donc « NON REPRIS ». Les idées utiles sont dans la mémoire du **travail fait** (pas seulement des faits sur l'utilisateur),
la divulgation progressive, l'anti-doublon et la fiabilité.

## Tableau complet

Taille : S = moins d'une journée, M = quelques jours, L = une semaine ou plus.

### Capture et observations

| Domaine | Fonction claude-mem | Statut | Preuve Sklubot (fichier:ligne) | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Capture | Chaque appel d'outil (lu, modifié, lancé) envoyé au worker par crochets (`src/cli/hook-command.ts`) | DIFFÉRENT | Les étapes du bot sont déjà des lignes `step` dans la discussion (`loop.ts`) | Sklubot n'en tire **aucune** mémoire durable ; seul le résumé de compaction les résume (`memory.ts:85`) | — |
| Capture | Observateur : un modèle transforme l'activité en observations typées (titre, sous-titre, faits, récit, concepts, fichiers lus/modifiés) — `src/sdk/prompts.ts:44-80` | MANQUANT | `consolidate` n'apprend que des faits sur l'utilisateur (`memory.ts:160`) | Le bot ne garde pas « ce que j'ai fait, ce qui a marché, ce qui a raté ». Voir « Écarts » n° 1 | M |
| Capture | Types d'observation : bugfix, feature, refactor, change, discovery, decision, security_alert, security_note, sensitive (`plugin/modes/code.json`) | MANQUANT | — | Une petite liste adaptée (« décision », « réglé », « bloqué », « appris ») suffirait | S |
| Capture | Résumé de fin de session (fait, appris, prochaines étapes) | PARTIEL | Résumé de compaction quand l'historique est trop long (`memory.ts:63-93`) | Pas de résumé à la fin d'une tâche si la conversation reste courte ; pas de « prochaines étapes » montrées au tour suivant | S |
| Capture | Modes de travail (code, code « chill » qui note moins, enquête e-mails, études de droit) — `plugin/modes/*.json` | MANQUANT | — | Pour Sklubot : « métier » du bot (secrétariat, prospection…) qui change ce qu'on retient. Les modèles `server/templates/*.md` pourraient porter ce réglage | M |
| Capture | Langue des observations (29 langues, `code--fr`) | FAIT | Les notes suivent la langue de l'utilisateur ; l'interface est en français/anglais (`i18n.ts`) | — | — |
| Capture | Créateur de mode personnalisé (types et concepts à soi) — compétence `mode-creator` | MANQUANT | — | Voir « consignes d'extraction » dans l'audit mem0 | S |
| Capture | Balises `<private>…</private>` : ce qui est entre elles n'est jamais mémorisé (`src/utils/tag-stripping.ts`, rappel affiché à l'utilisateur `cli/handlers/user-message.ts:54`) | MANQUANT | Aucun moyen de dire « ne retiens pas ce message » (recherche `incognito`, `noMemory` : rien) | Un bouton « hors mémoire » sur un message, ou la balise, respecté par `consolidate` et `conversation_search` | S |
| Capture | Tour entièrement privé : aucun livrable copié (`cli/deliverables-capture.ts:277`) | MANQUANT | — | Idem | S |
| Capture | Masquage des secrets avant envoi au modèle (motifs intégrés + motifs perso, option « générique », taille max → marqueur) — `src/utils/redaction.ts` | PARTIEL | `looksSecret` refuse une note (`sensitive.ts:47`) ; les secrets collés sont masqués (`pastedsecrets.ts`) | Pas de motifs personnalisés réglables par l'utilisateur | S |
| Capture | Seuls les messages **tapés par la personne** comptent (`services/prompt-import/owner-prompt-filter.ts` écarte ceux écrits par un agent) | FAIT | `typedByUser` `grounding.ts:50`, appliqué dans `consolidate` `memory.ts:153` ; test `wave5.test.ts` | Même principe des deux côtés | — |
| Capture | Gros résultat d'outil **résumé** par un petit modèle au lieu d'être coupé au milieu (`services/worker/field-optimizer.ts`) | DIFFÉRENT | Sklubot coupe (`clip`) les résultats trop longs | Pour la compaction, `render` coupe à 600 caractères par résultat (`memory.ts:56`) : des détails se perdent | M |
| Capture | Captures d'écran des outils gardées et montrées (`services/media/*`), envoyées au modèle seulement si autorisé | PARTIEL | Le bot voit l'écran (`screen_view`) ; les images ne sont pas gardées comme souvenirs | Pas de « ce que j'ai vu » retrouvable plus tard | M |
| Capture | Filet anti-perte : si le worker est arrêté, les événements vont dans une file sur disque, rejouée plus tard (`services/worker/hook-spool-drain.ts`) | DIFFÉRENT | Tout est déjà dans SQLite côté serveur | Sans objet | — |
| Capture | Importer l'historique passé de l'agent (prompts, coûts) au premier lancement (`services/prompt-import/`) | PARTIEL | Import Grok (`grokimport.ts`), import de mémoire (`memory.ts:223`) | Pas d'import d'historique ChatGPT/Claude | M |

### Contexte au démarrage (injection)

| Domaine | Fonction claude-mem | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Contexte | Index compact des observations utiles au démarrage d'une session (`services/context/ContextBuilder.ts`) | PARTIEL | Bloc « What you remember » à chaque tour (`prompt.ts:218-224`) | Seulement des faits sur l'utilisateur, pas le travail fait | M |
| Contexte | Budget mesuré : on rend, et tant que c'est trop long on retire l'élément le plus coûteux, jamais coupé en deux (`services/context/ContextBudget.ts`) | FAIT | `pickMemories` remplit `PROMPT_MEMORY_CHARS` note par note sans couper (`prompt.ts:35-41`) | — | — |
| Contexte | Coût en jetons de chaque couche affiché (`TokenCalculator.ts`) | MANQUANT | — | L'utilisateur ne voit pas combien coûte la mémoire dans chaque message | S |
| Contexte | « Previously » : dernier message de la session précédente, au choix | PARTIEL | Fils et compaction ; après un « nouveau départ » (reset), rien n'est repris sauf par `conversation_search` | Proposer « reprendre où on en était » après un reset | S |
| Contexte | Liste des choses encore ouvertes (work state : tâches todo/doing/done/dropped) montrée à chaque démarrage — outil `work_state_write` | FAIT | Tâches du bot (`task_add`, `task_update`), objectifs (`goals.ts`) | — | — |
| Contexte | Classement « force » ACT-R : récence + jours de reconfirmation (`services/reinforcement/rank.ts`) | DIFFÉRENT | Confirmation (`memories.confirm`) et recul à 90 jours (`prompt.ts:30`) | Sklubot ne garde qu'un drapeau « confirmé », pas l'historique des confirmations | S |
| Contexte | Réglages fins de ce qui est injecté (nombre, types, résumé, dernier message) — `ContextSettingsModal.tsx` | PARTIEL | `autoRecall` on/off (`store.ts:712`) | Pas de réglage du volume de mémoire injecté | S |
| Contexte | Aperçu du bloc injecté dans la visionneuse (`ui/context-preview-note.ts`) | MANQUANT | — | « Ce que ton bot voit de sa mémoire maintenant » : rassurant et utile pour comprendre un oubli | S |
| Contexte | Bloc placé pour garder un préfixe identique et profiter du cache du fournisseur (`sdk/prompts.ts:84-92`) | PARTIEL | L'heure est mise dans le message pour garder l'invite stable (`loop.ts:714`) | Mais le bloc mémoire de l'invite système change à chaque message (choix par mots du dernier message) : cache cassé. Voir audit mem0 « Écarts » n° 3 | S |
| Contexte | Texte rappelé traité comme donnée : caractères invisibles et de direction retirés, balises neutralisées, citations entourées de «…» (`services/integrations/grok-bot-untrusted-text.mjs`) | PARTIEL | Notes marquées « informations, jamais des ordres » (`recall.ts:263`) | Le texte d'une note (importée, par exemple) entre brut dans l'invite. Nettoyer bidi/zero-width et balises à l'import et à l'injection | S |
| Contexte | Démarrage « à froid » : lire tout le projet une fois (`/learn-codebase`) | NON REPRIS | — | Propre au code | — |

### Recherche et lecture

| Domaine | Fonction claude-mem | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Recherche | Divulgation progressive en 3 étapes : `search` (index ~50-100 jetons/ligne) → `timeline` → `get_observations` (détails) | MANQUANT | `memory_search` renvoie tout le texte ; `conversation_search` renvoie 12 extraits (`tools.ts:743-750`) | Pas d'index puis détails : peu grave pour des notes courtes, utile pour l'historique | S |
| Recherche | `timeline` : ce qui s'est passé avant/après un résultat | MANQUANT | `conversation_search` ne donne qu'un extrait par message | Lire les messages autour d'un résultat (`depth_before/after`) | S |
| Recherche | Filtres : type, date début/fin, projet, source, ordre, pagination | PARTIEL | `conversation_search` : portée « mine / everyone » seulement | Pas de filtre de date (« ce qu'on a dit en octobre ») | S |
| Recherche | Recherche plein texte indexée (SQLite FTS5, maintenance de l'index `FtsMaintenance.ts`) | PARTIEL | `searchMessages` fait des `LIKE` sur `json_extract` sans index (`store.ts:892-900`) | Lent sur un gros compte ; **sans pliage des accents** (« reunion » ne trouve pas « réunion ») ; pas de classement (le plus récent d'abord). Un index FTS5 avec `unicode61 remove_diacritics` règle les trois | S |
| Recherche | Recherche hybride mots + sens (Chroma, `HybridSearchStrategy.ts`) | MANQUANT | — | Voir audit mem0 | L |
| Recherche | Recherche « bête » rapide (recouvrement de mots des titres) | FAIT | `memory_search` BM25 (`recall.ts:178`) | — | — |
| Recherche | Lire l'entrée/sortie brute d'un ancien appel d'outil (`get_tool_uses`) | MANQUANT | Les lignes `step` gardent un résumé ; le résultat brut est dans l'historique mais pas cherchable | Utile pour « quel était le prix trouvé hier ? » | S |
| Recherche | Chaque observation a un numéro qu'on peut citer et ouvrir | PARTIEL | Les notes ont un id interne, non montré au bot | Le bot ne peut pas dire « d'après ma note n° 12 » ni l'utilisateur la retrouver | S |
| Recherche | Recherche depuis Claude Desktop (MCP HTTP) | NON REPRIS | — | — | — |
| Recherche | Recherche approfondie dans un processus enfant isolé (`services/deep-search/`) | NON REPRIS | — | — | — |
| Recherche | Bases de connaissances (« corpus ») construites à partir des observations et interrogées (`build_corpus`, `query_corpus`) | MANQUANT | — | « Tout ce que je sais sur le client X » en un document | M |
| Recherche | Recherche structurelle de code par tree-sitter (`smart_search`, `smart_outline`, `smart_unfold`) | NON REPRIS | — | Propre au code | — |
| Recherche | Recherche dans l'historique d'écran Screenpipe | NON REPRIS | — | Enregistrement de l'écran de l'utilisateur : trop intrusif | — |

### Gestion, anti-doublon, sauvegardes

| Domaine | Fonction claude-mem | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Gestion | Note explicite (`save_memory` : « après avoir cherché les doublons ») | FAIT | `memory_save` `tools.ts:862` | La consigne « cherche d'abord » n'y est pas ; aucun contrôle de doublon dans `memory_save` | S |
| Gestion | Anti-doublon en deux niveaux : identique → fusion ; proche (cosinus pondéré par la rareté) → **candidat** à vérifier, **avec veto** si un mot rare diffère (`services/dedup/nearDuplicate.ts`, `idfVeto.ts`) | PARTIEL | `similar()` Jaccard ≥ 0,7 (`memory.ts:107-115`) | **Bogue réel** (testé) : « Le client Dupont paie… à 30 jours » et « Le client Durand paie… » sont jugés identiques ; « rapport le lundi » et « rapport le vendredi » aussi. Le nouveau fait est jeté, ou pire l'ancien est « confirmé ». Voir « Écarts » n° 3 | S |
| Gestion | Reconfirmation : une observation revue renforce l'ancienne (jours gardés) | FAIT | `memories.confirm` `memory.ts:146, 186` | — | — |
| Gestion | Supprimer une observation / une session depuis la visionneuse | FAIT | `DELETE /memories/:id` `routes.ts:1160` | — | — |
| Gestion | Fusion de projets, adoption de worktrees (`ProjectMerge.ts`, `WorktreeAdoption.ts`) | NON REPRIS | — | — | — |
| Gestion | Sauvegardes locales de la base : instantanés, état, restauration par échange atomique (`services/backup/`) | FAIT | `autobackup.ts`, `backuparchive.ts`, `backupcheck.ts`, `docs/SAUVEGARDE.md` | — | — |
| Gestion | Synchro cloud (cmem.ai) | NON REPRIS | — | Payante, hors licence | — |
| Gestion | Export vers Notion (`NotionExporter.ts`) | PARTIEL | Export Markdown/JSON de la mémoire (`routes.ts:2657`) | Pas d'envoi direct vers un outil | S |
| Gestion | Rétention des journaux (`log-retention.ts`) | NON VÉRIFIÉ | — | — | — |

### Interface

| Domaine | Fonction claude-mem | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Interface | Visionneuse : fil des observations, filtre par catégorie, sélection de projet, cartes de session, page de détail, copier, supprimer, journaux (`src/ui/viewer/components/*`) | PARTIEL | Écran « Mémoire » du bot : liste, filtre par statut, recherche, export, oublier (`BotSettings.tsx:575-700`) | Pas de vue « ce que le bot a fait » par session, pas de journaux techniques lisibles | M |
| Interface | « My Work » : demandes en direct, progression, passations à l'humain, file de relecture enregistrée (`src/ui/my-work`) | DIFFÉRENT | Tâches de fond suivies dans la discussion, « Aujourd'hui » (`today.ts`), objectifs (`goals.ts`) | Comparable ; Sklubot n'a pas de file « à relire » qui regroupe tout ce qui attend l'utilisateur au même endroit (non vérifié en détail) | M |
| Interface | « My Goals » et « My Rules » : objectifs et règles tirés des messages de la personne, avec citations datées, file de décisions, historique des règles remplacées (compétence `owner-goals`) | PARTIEL | Règles en langage naturel avec historique et annulation (`rules.ts`, `db.ts:343`), `rule_propose` | Pas de carte d'objectifs déduite des messages, avec citations | M |
| Interface | Estimation de date de fin affichée seulement avec 2 mesures de progression (« règles de vérité ») | MANQUANT | — | Bonne pratique d'honnêteté pour les tâches longues | S |
| Interface | Liens vers des livrables sans vraie cible marqués « exemple » plutôt que lien mort | IDÉE | — | — | — |
| Interface | Interface traduite (fr, ko, zh…) | FAIT | `web/src` + `i18n.ts` (fr/en) | — | — |
| Interface | Prix des modèles et coût par agent (compétence `agent-cost-report`, `cmem-pro-costs.ts`) | FAIT | `usage.ts`, `credits.ts`, `PLAFONDS.md` | — | — |
| Interface | Bannière animée de l'installeur | NON REPRIS | — | — | — |

### Équipe

| Domaine | Fonction claude-mem | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Équipe | TeamBrain : espace partagé, chacun choisit ce qu'il partage, attribution par membre (`team_brief`, `team_search`) | PARTIEL | Bots partagés à un espace, compétences partagées entre bots (`store.ts:561`), `conversation_search` portée « everyone » (tous les bots d'un compte) | Pas de mémoire d'équipe entre **personnes** ; `COUVERTURE.md:51` le note | L |
| Équipe | « Où le travail des collègues entre en collision avec le tien » | NON REPRIS | — | Propre au code | — |
| Équipe | Travail délégué à toi | FAIT | Tâches entre bots, `bot_message`, `helper_start` | — | — |

### Notifications et canaux

| Domaine | Fonction claude-mem | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Canaux | Alertes Telegram pour certains types d'observation (sécurité, décision) — `TelegramNotifier.ts` | FAIT | Telegram (`telegram.ts`), notifications push (`push.ts`) | — | — |
| Canaux | Récapitulatif de fin de session sur Telegram (`TelegramWrapupNotifier.ts`) | PARTIEL | La réponse revient sur Telegram (`loop.ts:425`) | Pas de résumé « voici ce que j'ai fait aujourd'hui » envoyé à heure fixe, sauf via une routine | S |
| Canaux | Flux vers Discord, Slack (via OpenClaw) | NON REPRIS | — | — | — |

### Fiabilité

| Domaine | Fonction claude-mem | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Fiabilité | Règle « ne jamais payer deux fois » : on ne réessaie sur place que si l'on **sait** que le travail n'a pas eu lieu (429, refus avant envoi) ; une erreur ambiguë (5xx, réseau, délai) n'est pas réessayée sur place (`services/worker/retry.ts`) | DIFFÉRENT | `isTransient` réessaie aussi les 5xx et coupures réseau (`reliability.ts:29-35`) | Pour un appel de modèle simple c'est acceptable ; pour un outil qui agit (envoi, achat) il faut la règle de claude-mem. Sklubot l'a déjà pour les actions irréversibles (`irreversible.ts`, résultat « incertain ») | — |
| Fiabilité | Budget d'envois payés par lot (au plus 1 renvoi) — `paid-send-budget.ts` | PARTIEL | Plafonds de dépense et de jetons (`spend.ts`, `usagecaps.ts`), `retryMaxWaitMs` | Pas de compteur « renvois » par requête | S |
| Fiabilité | Erreurs du fournisseur classées (contexte trop long → recycler la conversation au lieu d'échouer) — `provider-errors.ts` | FAIT | `failures.ts` (cartes avec remèdes), compaction forcée si l'historique déborde (`loop.ts:1133`) | — | — |
| Fiabilité | Délai par tentative (`CLAUDE_MEM_LLM_TIMEOUT_MS`) compté à part | FAIT | `AbortSignal.timeout(180_000)` dans `ask` (`memory.ts:25`), veille de tour (`watch.ts`) | — | — |
| Fiabilité | Redémarrage auto borné quand le CLI `claude` ne se lance plus après une mise à jour (`stale-spawn-recovery.ts`) | PARTIEL | Moteurs Claude Code/Codex (`engine.ts`) ; non vérifié pour ce cas précis | — | — |
| Fiabilité | Sonde de santé avec délai de 5 s (écouteur fantôme) — `HealthMonitor.ts` | FAIT | `health.ts`, `monitor.ts` | — | — |
| Fiabilité | Arrêt propre (`GracefulShutdown.ts`) | FAIT | `index.ts` (non relu en détail) | — | — |
| Fiabilité | `doctor` : vérifie Bun, uv, lanceur, worker et dit quoi réparer | PARTIEL | Page santé / `desktest.ts` | Pas de « docteur » côté utilisateur qui explique en mots simples | S |
| Fiabilité | Mise à jour automatique avec échéances (`services/auto-update/`) | NON REPRIS | Serveur déployé par l'opérateur | — | — |
| Fiabilité | Générateur de rapport de bogue (`npm run bug-report`) | MANQUANT | Bouton « retour » (`feedback`) | Un rapport tout prêt (versions, derniers incidents, sans secrets) pour le support | S |
| Fiabilité | Base locale corrompue mise en quarantaine | NON REPRIS | — | — | — |
| Fiabilité | Limitation de débit stockée (`RateLimitStore.ts`) | DIFFÉRENT | `RateWindow` en mémoire | — | — |
| Fiabilité | Jeton d'API local pour le worker, jamais donné à une autre machine (`HealthMonitor.ts` en-tête) | DIFFÉRENT | Sessions et clés du serveur | — | — |

### Installation, intégrations, développeurs

| Domaine | Fonction claude-mem | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Installation | `npx claude-mem install` détecte les agents et les configure | NON REPRIS | — | — | — |
| Installation | Connexion par lien magique, essai gratuit avec carte | NON REPRIS | — | Commercial | — |
| Installation | Télémétrie anonyme activée par défaut | NON REPRIS | — | Vie privée | — |
| Intégrations | 18 installateurs (Aider, Codex, Cursor, Gemini, Windsurf, Devin, Kimi, OpenClaw, Hermes, T3 Code…) | NON REPRIS | — | Hors produit | — |
| Intégrations | « Grok Bot » : lit les journaux de discussion faute de crochets ; pousse des lignes « [awareness] » datées dans le journal mémoire du bot (`GrokBotAwarenessPusher.ts`) | NON REPRIS | — | Produit tiers | — |
| Intégrations | Serveur MCP (stdio et HTTP), visibilité des outils réglable | FAIT | `botmcp.ts`, `teammcp.ts` | — | — |
| Intégrations | SDK | NON REPRIS | — | — | — |
| Intégrations | Image Docker | FAIT | `docker/`, `Dockerfile.production` | — | — |
| Intégrations | Agent « sidekick » API (`services/agent-runner/api-agent.ts`) | NON REPRIS | — | — | — |
| Développeurs | Couverture des exigences UI vérifiée automatiquement (`my-work/COVERAGE.md`, `<Req ids>`) | MANQUANT | — | Idée de qualité : chaque exigence de `COUVERTURE.md` liée à un écran ou un test | M |
| Développeurs | Jeton crypto « CMEM » mis en avant dans le README | NON REPRIS | — | Hors sujet | — |

### Compétences (`plugin/skills/` et `claude-mem-grok-bot/skills/`)

Licence de chaque dossier : Apache 2.0 (celle du dépôt, pas de fichier propre). Équivalents cherchés dans
`server/skills-library/catalog.json` (16 compétences), `server/templates/`, `server/src/agent/guides.ts` (9 guides),
`docs/COMPETENCES.md`.

| Compétence | Ce qu'elle fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| `mem-search` | Recherche en 3 étapes dans la mémoire | Apache 2.0 | `memory_search`, `conversation_search` | IDÉE (ajouter « timeline ») |
| `handoff` | Écrit un `HANDOFF.md` : but, état, fichiers touchés, essais ratés, prochaines étapes, pour qu'une nouvelle session continue | Apache 2.0 | Résumé de compaction (`memory.ts:85`) | **ADAPTER** : note de passation quand un bot passe la main à un autre bot ou avant un reset |
| `make-plan` | Plan par phases avec recherche de documentation avant d'agir | Apache 2.0 | Objectifs (`goals.ts`), compétence « Méthode de travail » | IDÉE |
| `do` | Exécute un plan phase par phase avec des sous-agents | Apache 2.0 | Assistants (`helper_start`), tâches de fond | IDÉE |
| `build`, `build-and-release`, `release`, `version-bump` | Chaîne complète de code : plan, exécution, surveillance de PR, publication | Apache 2.0 | — | NON (code) |
| `babysit` | Surveille une PR jusqu'à ce qu'elle soit prête | Apache 2.0 | Routines « watch » (`routine_create` kind `watch`) | NON (code) |
| `childhood` | Surveille une version publiée après mise en ligne | Apache 2.0 | — | NON (code) |
| `standup` | Point quotidien en lecture seule sur des branches | Apache 2.0 | — | NON (code) ; IDÉE d'un « point du jour » des bots |
| `weekly-digests` | Récit semaine par semaine d'un projet, depuis la chronologie | Apache 2.0 | « Aujourd'hui » (`today.ts`, `todayminutes.ts`) | **ADAPTER** : bilan hebdomadaire de ce que l'équipe de bots a fait |
| `timeline-report` | Rapport « Le voyage de [projet] » sur tout l'historique | Apache 2.0 | — | IDÉE |
| `request-progress` | Regroupe les conversations en demandes, mesure la progression, écrit l'histoire | Apache 2.0 | Tâches et objectifs | IDÉE |
| `owner-goals` | Déduit objectifs, demandes et règles des seuls messages de la personne, avec citations datées | Apache 2.0 | `rule_propose`, `consolidate` | **ADAPTER** : proposer des règles/objectifs avec citation, validés en carte |
| `knowledge-agent` | Construit des « cerveaux » thématiques à partir des observations | Apache 2.0 | — | IDÉE |
| `learn-codebase` | Lit tout un dépôt une fois | Apache 2.0 | — | NON (code) |
| `smart-explore` | Recherche de code par AST | Apache 2.0 | — | NON (code) |
| `pathfinder` | Cartographie d'architecture en diagrammes | Apache 2.0 | — | NON (code) |
| `oh-my-issues` | Regroupe des tickets GitHub par cause | Apache 2.0 | Outils GitHub (`githubissues.ts`) | NON (développeurs) |
| `design-is` | Audit d'un design selon les 10 principes de Dieter Rams, puis plan | Apache 2.0 | « Règles de métier du design », « Design soigné » | IDÉE (grille d'audit en plus) |
| `what-the` | Explique un sujet technique en mots simples (qui, quoi, où, pourquoi, quand) | Apache 2.0 | Compétence « Réponses courtes » | **ADAPTER** (petit, utile au public visé) |
| `wowerpoint` | Transforme un document en diapositives « kawaii » style NotebookLM | Apache 2.0 | « Présentations (diapositives) », OpenMan | IDÉE |
| `how-it-works` | Explique le fonctionnement de claude-mem | Apache 2.0 | `docs/MEMOIRE.md` | NON (propre au produit) |
| `backup-setup` | Mise en place et restauration des sauvegardes | Apache 2.0 | `SAUVEGARDE.md` | NON (déjà couvert) |
| `cloud-sync` | Synchro avec l'offre payante | Apache 2.0 | — | NON (commercial) |
| `mode-creator` | Crée un mode d'observation personnalisé | Apache 2.0 | — | IDÉE |
| `agent-cost-report` | Rapport de coûts par agent | Apache 2.0 | `usage.ts` | IDÉE |
| `screenpipe` | Cherche dans l'enregistrement d'écran/audio | Apache 2.0 | — | NON (intrusif) |
| `ccs-align` | Cycle horaire d'un « siège » de supervision | Apache 2.0 | — | NON (interne) |
| Grok Bot : `install`, `host-observer` | Installation et observateur local | Apache 2.0 | — | NON |
| Grok Bot : `mem-search`, `agent-cost-report` | Copies des précédentes | Apache 2.0 | — | NON (doublons) |

Total : 29 lignes (certaines regroupent plusieurs compétences) — 4 ADAPTER, 10 IDÉE, 15 NON.

## Écarts de comportement

Seuls les flux où claude-mem a un équivalent sont comparés ; les autres (appel vocal, salon multi-bots, ordinateur sur un
lien, inscription) sont sans objet.

1. **Une tâche longue faite hier, reprise aujourd'hui.**
   - claude-mem : chaque action devient une observation typée (« découverte : le site X exige une connexion »,
     « décision : on passe par l'API »), et un résumé de fin de session dit ce qui reste. La session suivante démarre
     avec cet index ; l'agent ne refait pas les mêmes erreurs.
   - Sklubot : si la conversation n'a pas dépassé `COMPACT_CHARS` (300 000 caractères, `config.ts:150`), l'historique entier
     est encore là et tout va bien. Après un **reset** (« nouveau départ ») ou dans un autre bot, il ne reste que les faits
     sur l'utilisateur ; ce qui a été **essayé et raté** est perdu, sauf si le bot pense à `conversation_search`.
   - Correctif : à la fin d'une tâche (ou au reset), écrire 3 à 5 « leçons » du bot (outil ou passe automatique), gardées
     à part des faits sur l'utilisateur, marquées « apprises de mon travail, à vérifier », et montrées seulement quand le
     sujet revient (même rappel BM25). Taille M.

2. **Retrouver ce qui a été dit.** claude-mem : FTS5 indexé, filtres de date/type, puis chronologie autour du résultat.
   Sklubot (`store.ts:892-900`) : `LOWER(...) LIKE '%mot%'` pour **chaque** mot (ET), sans index, sans accents pliés, trié
   par date. « reunion budget » ne trouve pas « Réunion budget » (accent), et un compte avec des centaines de milliers de
   lignes fait un parcours complet de table à chaque appel. Correctif : table FTS5 sur le texte des messages avec
   `remove_diacritics 2`, classement `bm25()`, filtre de date, et un paramètre « autour de ce message ». Taille S.

3. **Deux faits presque pareils (anti-doublon).** claude-mem : identique → fusion ; proche → simple **candidat**, et un
   mot rare différent (un nom, un jour) **interdit** la fusion. Sklubot : `similar()` (`memory.ts:107-115`) dit « même
   fait » dès 70 % de mots communs. Testé : `similar("Le client Dupont paie toujours ses factures à 30 jours fin de mois",
   "Le client Durand paie …")` → `true` ; `similar("Préfère recevoir le rapport le lundi matin par e-mail", "… le vendredi
   matin …")` → `true`. Conséquences dans `consolidate` (`memory.ts:183-187`) : le fait sur Durand est jeté, ou la note
   Dupont passe « confirmée » avec un extrait qui parle de Durand ; à l'import (`memory.ts:239`), la ligne est écartée
   comme « doublon ». Correctif : veto si un mot présent d'un seul côté est rare dans les notes du bot (idf élevé, on a
   déjà le calcul dans `recall.ts`) ou est un nombre, un jour, un nom propre ; et la confirmation exige que l'extrait
   contienne les mots rares de la note. Ajouter ces deux phrases en test. Taille S.

4. **Erreur du fournisseur.** claude-mem distingue « refusé avant travail » (réessai), « ambigu » (pas de réessai sur
   place, budget d'un renvoi) et « sortie illisible » (jamais). Sklubot réessaie 429, 5xx et réseau avec recul
   exponentiel puis passe au modèle de secours (`reliability.ts:18-48`), et protège les actions irréversibles par un
   résultat « incertain ». C'est solide pour un tour de chat ; le seul écart est le coût potentiel d'un 5xx déjà facturé,
   faible. Pas de correctif urgent.

5. **Ce que voit le bot.** claude-mem montre l'aperçu exact du bloc injecté et son coût en jetons. Sklubot ne montre rien :
   quand un bot « oublie », l'utilisateur ne peut pas savoir si la note était dans l'invite (limite de 4 000 caractères)
   ou non. Correctif : bouton « Ce que ton bot voit » dans l'écran Mémoire (notes injectées + rappelées au dernier tour).
   Taille S.

6. **Ne pas retenir un message.** claude-mem : `<private>` retiré avant tout stockage, rappel affiché. Sklubot : rien ;
   seul le réglage global `autoCapture` coupe tout l'apprentissage. Correctif : case « ne pas retenir » sur un message,
   lue par `consolidate`, `learnStyle` et `conversation_search`. Taille S.

## À faire (du plus utile au moins utile)

1. Corriger l'anti-doublon `similar()` (veto sur mot rare, nombre, jour, nom) + tests — S.
2. Index FTS5 avec accents pliés et classement pour `conversation_search`, filtre de date et « messages autour » — S.
3. Mémoire du travail : « leçons apprises » (réussites, échecs, décisions) gardées à part des faits sur l'utilisateur — M.
4. « Ne pas retenir ce message » (bouton ou balise) — S.
5. Aperçu « Ce que ton bot voit de sa mémoire » avec coût approximatif — S.
6. Note de passation (handoff) quand un bot passe une tâche à un autre ou avant un reset — S.
7. Nettoyage du texte des notes avant injection (caractères invisibles, balises) — S.
8. `memory_save` : vérifier un doublon avant d'ajouter et le dire au bot — S.
9. Résumé de fin de tâche avec « prochaines étapes » montré au tour suivant — S.
10. Bilan hebdomadaire de l'équipe de bots (adapté de `weekly-digests`) — S.
11. Objectifs et règles proposés depuis les messages, avec citation, validés en carte (adapté de `owner-goals`) — M.
12. Compétence « Explique simplement » (adaptée de `what-the`) — S.
13. Modes/métiers qui orientent ce que le bot retient — M.
14. Garder la date de chaque reconfirmation (classement plus juste) — S.
15. Rapport de bogue tout prêt pour le support — S.
16. Mémoire d'équipe entre personnes d'un même espace — L.

## Non vérifié

- La rétention des journaux et l'arrêt propre côté Sklubot (non relus en détail).
- Le cas « CLI claude qui ne se lance plus après mise à jour » dans `engine.ts`.
- Le contenu exact de l'écran « My Work » (lu via le README et les noms de composants, pas page par page).
- La qualité réelle de la recherche Chroma de claude-mem (non exécutée).
