# Audit complet : CopilotKit/OpenBot comparé à Sklubot

Date : 22/11/2026. Dépôt lu : `CopilotKit/OpenBot`, commit `7645ea8` du 21/11/2026 (copie superficielle, lue sans rien exécuter, puis supprimée).
Sklubot lu dans `/home/user/grok-sklubs` en lecture seule (d'autres agents modifiaient l'arbre : les numéros de ligne peuvent avoir bougé de quelques lignes).

Nom du fichier : deux dépôts s'appellent « OpenBot » dans la liste, d'où `AUDIT-COPILOTKIT-OPENBOT.md` (celui-ci) et `AUDIT-NIGHTLY-LABS-OPENBOT.md`.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 74 |
| PARTIEL | 60 |
| MANQUANT | 36 |
| DIFFÉRENT | 17 |
| NON REPRIS | 11 |
| Non vérifié (voir fin) | 6 |
| **Total** | **204 lignes** |

Lecture rapide : OpenBot est le concurrent le plus proche de Sklubot (il se présente lui-même comme « alternative à Grok Bot »). Sur la sécurité des actions (cartes, empreinte d'action, usage unique, contenu extérieur), Sklubot est au même niveau, parfois plus strict. Les vrais écarts sont dans **le comportement d'un tour** : OpenBot coupe un tour muet (45 s puis vérification), renvoie le bot faire ce qu'il a promis (« je vais chercher le reste » sans appel), ferme la liste des parties d'une routine (Fait / Bloqué / Sauté), ne refait jamais deux fois le même changement dans un tour, et a un **prompt de méthode** beaucoup plus travaillé (quand demander, comment réessayer selon le type d'échec, ne rien affirmer sans résultat, réponses courtes). Il a aussi une **politique réseau sortante par bot** et la **« Web Bot Auth »** que Sklubot n'a pas.

## Licence

**MIT** (`LICENSE`, « Copyright (c) 2026 CopilotKit »). On peut utiliser, copier, modifier, publier, vendre, à condition de garder la notice de copyright et le texte de la licence dans toute copie substantielle. Pas d'obligation de publier nos changements. Le nom et le logo « OpenBot », « CopilotKit » ne sont pas donnés par la licence.

Attention : **CopilotKit Intelligence** (fils de conversation durables, mémoire, apprentissage automatique) est un produit **séparé, sous licence propriétaire** (licence locale gratuite, essai, ou payante). Le code serveur d'OpenBot (`server/src/...`) n'est **pas dans ce dépôt** : le serveur tourne depuis des images publiées. Le dépôt contient l'app web (`app/`), le code partagé (`shared/`), le bureau Tauri (`desktop/`), l'extension Recorder (`extension/`), l'app mobile (`mobile/`), les harnais d'agents (`agent-*`) et une documentation très complète. Donc : beaucoup d'idées réutilisables (MIT), mais le mécanisme serveur exact n'a pu être lu que par la doc, le CHANGELOG (9 800 lignes) et les fichiers partagés.

## Ce qui a été lu côté OpenBot

- Docs : `how-openbot-works.md`, `coworkers.md`, `approvals.md`, `routines.md`, `web-research.md`, `automatic-learning.md`, `personal-edition.md`, `architecture.md`, `configuration.md` (voix, passage entre bots, sous-agents, Slack/Teams, SMS/push, e-mail entrant, ordinateur, réseau sortant, Web Bot Auth, proxy).
- Code partagé : `shared/bot-prompt.ts` (le prompt de méthode, 1 000 lignes avec les raisons de chaque phrase), `routine-checklist.ts`, `run-notices.ts`, `orchestration.ts`, `subagent.ts`, `standing-rule.ts`, `person-time-zone.ts`, `model-lock.ts`, `model-tool-limit.ts`, `security-floor.ts`, `send-file.ts`, `file-download.ts`, `decision-tools.ts`, `recorder-masking.ts`, etc.
- App : liste complète des écrans (`app/src/routes/**`, 130 routes) et des dossiers `app/src/lib/*`.
- CHANGELOG : sections Conversations, Fichiers, Tâches et agents, Routines, Politique en langage courant, Bureau, Teach a Bot.

## Tableau complet des fonctions

Statuts : FAIT, PARTIEL, MANQUANT, DIFFÉRENT, NON REPRIS. Taille : S (moins d'un jour), M (quelques jours), L (une semaine ou plus). Chemins Sklubot depuis `server/src/` sauf mention ; « test : x » = `server/test/x.test.ts`.

### Conversations (chat)

| Domaine | Fonction OpenBot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Chat | Conversation avec un bot, réponse en flux | FAIT | `agent/loop.ts` (`submitUserMessage`, `runScopedTurn`), `web/src/components/ChatView.tsx` ; test : app, wave2 | — | — |
| Chat | Plusieurs conversations séparées avec le même bot | PARTIEL | fils (`thread`) dans `agent/loop.ts`, `web/src/components/ThreadPanel.tsx` | Chez Sklubot un bot = un chat principal + fils ; OpenBot ouvre une conversation neuve à chaque fois. Pas de liste « conversations » par bot | M |
| Chat | Renommer une conversation | MANQUANT | aucun « rename » côté conversation (grep) | Menu « Renommer » | S |
| Chat | Titre automatique d'une conversation (premiers mots de la personne, pas la réponse) | PARTIEL | sections/fils nommés à la main | Nommage auto des fils | S |
| Chat | File de messages visible pendant le travail, avec « Envoyer maintenant » et « Retirer » | DIFFÉRENT | `agent/loop.ts:372` : le message est fondu dans le tour en cours (steering) | Pas de file visible ; l'utilisateur ne peut pas « couper et envoyer » ni retirer. Voir écarts | M |
| Chat | Bouton Stop qui garde les étapes finies et la réponse partielle | FAIT | `agent/loop.ts` (arrêt du tour, `closeCalls`) | — | — |
| Chat | Tour coupé (serveur muet) : avis clair + bouton « Continuer » au lieu de « Réflexion… » éternel | PARTIEL | `agent/watch.ts:21` avis « semble bloqué » après 5 min, boutons « Attendre » / « Arrêter et reprendre » | 5 min au lieu de 45 s ; aucun délai d'inactivité sur l'appel modèle lui-même (`llm/*`), donc sans clic le tour reste ouvert | S |
| Chat | Conversation muette 45 s : l'app demande au serveur si le tour vit encore, sinon le termine | MANQUANT | — | Sonde de vie du tour côté app | S |
| Chat | Revenir sur une conversation où le bot travaille montre qu'il travaille ; un second onglet rejoue le tour depuis le début | FAIT | `bus.ts` (`setLive`), état live relu à l'ouverture | — | — |
| Chat | Réponse finale reste à sa place (pas de saut de défilement) | NON VÉRIFIÉ → voir fin | — | — | — |
| Chat | Formules mathématiques (LaTeX) dessinées | MANQUANT | aucun KaTeX/MathJax dans `web/` | Rendu LaTeX dans les messages | S |
| Chat | Composants riches : graphiques, tableaux, fiches, listes à cocher, cartes de choix, formulaires | PARTIEL | artefacts privés (`artifact-design.ts`, `pageroutes.ts`), `ask_user` avec réponses toutes prêtes (`agent/tools.ts:1205`), « réponses riches » (docs/API.md wave 5b) | Pas de galerie de composants natifs dans le fil (graphique, tableau triable, formulaire) ; un artefact HTML est plus lourd | M |
| Chat | Règle « Markdown par défaut, composant seulement si utile » | PARTIEL | `agent/prompt.ts:181` « lists or tables only when they make the answer easier » | Pas de règle sur les cartes d'alerte ni « ne dessine pas deux fois » | S |
| Chat | Un graphique porte sa source (figures vérifiées ou « de mémoire ») | MANQUANT | — | Règle de provenance pour les chiffres et graphiques | S |
| Chat | Recherche dans tout l'historique côté serveur | FAIT | `conversation_search` `agent/tools.ts:743` ; `web/src/components/CommandPalette.tsx` | — | — |
| Chat | Palette de commandes Cmd/Ctrl+K | FAIT | `web/src/App.tsx:64`, `CommandPalette.tsx` | — | — |
| Chat | Nouvelle conversation avec raccourci (+, Maj+N) et destinataire vide | PARTIEL | palette | Raccourci dédié | S |
| Chat | Pièces jointes avant le premier message | FAIT | `Composer.tsx`, `uploads.ts` ; test : large-attachments | — | — |
| Chat | Pièces Word, Excel, PowerPoint | FAIT | `computer.ts:503` (types), `office.ts` | — | — |
| Chat | Limite de taille dictée par le serveur, refus clair dans la zone de saisie | FAIT | `uploadlimits.ts` ; test : large-attachments | — | — |
| Chat | Choisir le modèle depuis l'écran d'accueil / par conversation | PARTIEL | modèle par bot (`BotSettings.tsx`, `TeamModels.tsx`) | Pas de sélecteur par conversation | S |
| Chat | Modèle par défaut d'un bot | FAIT | `bot.model`, `reliability.ts:18` | — | — |
| Chat | Le bot sait quel modèle il est (« trust this line ») | MANQUANT | `agent/prompt.ts` ne nomme pas le modèle | Une ligne « tu tournes sur X » | S |
| Chat | Date du jour dans le fuseau de la personne, envoyée par le navigateur | PARTIEL | heure en tête de chaque message (`agent/loop.ts:714`), fuseau du profil (`agent/prompt.ts:190`) | Fuseau lu dans le profil seulement, pas celui du navigateur ; si vide, UTC | S |
| Chat | Réactions sous un message | FAIT | `message_react` `agent/tools.ts:511` | — | — |
| Chat | Notification « a répondu » quand la réponse n'est qu'un composant | FAIT | `push.ts` (type `reply`) | — | — |
| Chat | Carte « Travaillé pendant N s » qui replie les étapes d'un tour | FAIT | lignes d'étapes repliables dans `ChatView.tsx` | — | — |

### Bots (configuration)

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Bots | Bot = nom, titre, rôle envoyé à chaque tour (« Setup ») | FAIT | `agent/prompt.ts:89` (nom, label, description, instructions `:249`) | — | — |
| Bots | Bloc d'identité « on t'appelle X ; une demande à X est pour toi » | PARTIEL | `agent/prompt.ts:90` | Phrase « une demande adressée à X, c'est toi » absente (utile en groupe) | S |
| Bots | Règles de travail communes ajoutées par le déploiement (jamais oubliées pour un nouveau bot) | FAIT | `buildSystemPrompt` commun à tous les bots | — | — |
| Bots | Bot de départ « Assistant personnel » | FAIT | bot principal (`bot.primary`), modèles d'équipe (`teamtemplates`) ; test : team-templates | — | — |
| Bots | Visibilité privé / public, publication à l'équipe ou à des personnes | DIFFÉRENT | mode « teammate » (`agent/prompt.ts:95`), espaces de travail (`workspaces.ts`) ; test : wave6-workspaces | Sklubot est pensé pour une personne et ses bots ; partage plus simple | — |
| Bots | Épingler / masquer un bot dans sa liste | PARTIEL | `bot.hidden` pour les assistants internes (`researchreports.ts:45`) | Pas d'épinglage ni de masquage choisi par l'utilisateur | S |
| Bots | Suppression douce (conversations lisibles après) | DIFFÉRENT | `agent/retire.ts` (retraite d'un bot) | À vérifier : ce qui reste lisible | — |
| Bots | Dupliquer un bot | FAIT | `web/src/components/DuplicateBotModal.tsx` | — | — |
| Bots | « Bot isolé » : un ordinateur à lui seul | FAIT | chaque bot a déjà son ordinateur (`linux.ts`) | — | — |
| Bots | Brancher un agent externe (AG-UI : LangGraph, Mastra, CrewAI, Claude Agent SDK, ADK…) | DIFFÉRENT | moteurs abonnement Claude Code / Codex (`agent/engine.ts`) | Pas de protocole ouvert pour un agent tiers ; idée : un « bot distant » par URL | L |
| Bots | Tester une adresse d'agent avant de l'enregistrer | MANQUANT | — | Lié à la ligne précédente | S |
| Bots | Harnais prouvés par modèle (« model lock » : un modèle n'est proposé qu'après un vrai appel réussi) | PARTIEL | `apimodels.ts`, `modelAvailable` (`reliability.ts:23`) | Pas de test quotidien réel par modèle et par moteur | M |
| Bots | Le bot connaît les apps qu'il peut utiliser dès le 1er message | FAIT | `agent/prompt.ts:148` | — | — |

### Routines, objectifs, check-ins

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Routines | Routine à heure fixe créée en parlant au bot | FAIT | `routine_create` `agent/tools.ts:898`, `cron.ts` ; test : wave3 | — | — |
| Routines | Écran « Nouvelle routine » en 4 parties (quoi, démarre, fait, jusqu'à) | PARTIEL | `GoalsAndJobs.tsx`, `RulesAndNudges.tsx` | Pas un seul écran qui choisit lui-même routine/objectif/check-in selon les réponses | M |
| Routines | Déclenchement par événement (nouveau mail, PR, Slack) | FAIT | déclencheurs d'apps natives (`scheduler.ts:39`, `routines.ts:143`), surveillance (`watch`), webhook (`routines.ts:110` `hookUrl`) | — | — |
| Routines | Déclenchement par e-mail entrant à une adresse dédiée | FAIT | `botmail.ts:181` (`receiveMail`) ; test : wave6-mail | — | — |
| Routines | Plancher 15 min entre deux passages | PARTIEL | surveillances : `everyMin` ; cron libre | Pas de plancher ferme qui résiste à « toutes les minutes » | S |
| Routines | Au plus 20 routines actives par personne | MANQUANT | — | Plafond simple | S |
| Routines | Règle de fatigue : un seul message au 1er échec après un succès ; 10 échecs → arrêt | PARTIEL | `scheduler.ts:258-266` : avis à **chaque** échec, pause après N | Bruit : un avis par nuit pour un jeton expiré | S |
| Routines | Créneaux manqués sautés, pas rejoués | DIFFÉRENT | `scheduler.ts:184` rattrape **une** fois si manqué il y a moins de 24 h | Équivalent raisonnable | — |
| Routines | Routine en liste : parties numérotées, chaque partie close Fait / Bloqué / Sauté avec raison | MANQUANT | — | Voir écarts | M |
| Routines | Plus d'étapes pour une routine (24 + 4 par partie, max 48) | DIFFÉRENT | 60 pas pour tout, + un tour de plus pour une routine (`agent/loop.ts:1152`) | Équivalent | — |
| Routines | « Personne ne regarde ce tour » + format de rapport fixe (résultat, « Ce que je n'ai pas pu confirmer », questions, changements avec liens) | MANQUANT | `agent/turn-request.ts` ne donne pas ce cadre | Voir écarts | S |
| Routines | Dernier pas : outils coupés, « réponds avec ce que tu as » | PARTIEL | passe « rapport final » `agent/loop.ts:1076` (si le tour finit muet) | Pas au dernier pas de la limite | S |
| Routines | Objectif (goal) avec critère de réussite, progrès, fin quand atteint | FAIT | `agent/goals.ts` ; test : wave5 | — | — |
| Routines | Objectif récurrent jamais « complété » par un passage | NON VÉRIFIÉ | — | — | — |
| Routines | Check-in : regarde et ne fait que prévenir ; 24 par bot et par jour | FAIT | `agent/nudges.ts:61-108` (plafond quotidien, budget, heures calmes), `checkins_set` `agent/tools.ts:1004` | — | — |
| Routines | Offre de check-in par carte sur un sujet regardé ensemble | MANQUANT | — | Outil « propose un suivi » | S |
| Routines | Tâche lancée depuis un check-in : demande avant chaque changement | PARTIEL | tours de routine marqués (`origin`) | Règle explicite « tout changement demande » | S |
| Routines | Une routine tourne au nom de celui qui l'a créée ; l'audit dit « routine » | FAIT | `audit(...,"routine",...)` `scheduler.ts:266`, journal `origin` (`agent/loop.ts:1611`) | — | — |
| Routines | Réponse d'une routine dans la conversation choisie | PARTIEL | dans le chat du bot | Pas de choix « poster dans tel fil/salon » | S |

### Mémoire et apprentissage

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Mémoire | Faits partagés par tous les bots vs faits d'un bot | FAIT | profil partagé `profile_update` (`agent/tools-team.ts:63`), `memory_save` par bot | — | — |
| Mémoire | Rappel par le sens (embeddings), repli mots-clés | PARTIEL | `agent/recall.ts` (mots-clés FR/EN), `agent/prompt.ts:18` | Pas de rappel par le sens | M |
| Mémoire | Importer des faits depuis une app connectée (source de mémoire) | MANQUANT | — | Ex. lire son agenda/contacts pour apprendre « qui est qui » | M |
| Mémoire | « Ce que dit la personne passe avant la mémoire » | MANQUANT | — | Une phrase dans le prompt | S |
| Apprentissage | Apprentissage automatique : propose des compétences tirées des conversations, avec preuves, à approuver | PARTIEL | `skill_propose` (`agent/tools.ts:785`) : le bot propose après une tâche | Pas d'analyse de fond sur plusieurs conversations ; pas de file « compétences proposées » avec preuves | M |
| Apprentissage | « Apprendre maintenant » + auto-approbation | MANQUANT | — | — | M |
| Apprentissage | Teach a Bot : enregistrer une démonstration dans le navigateur du bot → compétence | FAIT | `teach.ts` (captures + frappe masquée) ; test : non trouvé | Pas de test dédié | S |
| Apprentissage | Masquage des secrets dans l'enregistrement (1 500 lignes de règles) | PARTIEL | `teach.ts` ne garde que les comptes de touches | Captures d'écran non masquées (un mot de passe visible à l'écran reste dans l'image) | M |
| Apprentissage | Narration vocale pendant l'enregistrement | MANQUANT | — | — | M |
| Apprentissage | Partage de compétences entre personnes, avec demande à l'admin | DIFFÉRENT | compétences partagées entre bots (`agent/prompt.ts:237`), bibliothèque (`skillslibrary.ts`) | Pas de multi-personnes | — |

### Compétences et apps

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Compétences | Compétence appelée par « / » | PARTIEL | `ComposerMentions.tsx` (@App) | Pas d'appel de compétence par « / » | S |
| Compétences | Compétences écrites, apprises, proposées dans une seule liste | FAIT | `SkillsLibrary.tsx`, `skills` (store) ; test : skills-library | — | — |
| Compétences | Compétence déclare des rôles d'outils (`@research/search`) et non un fournisseur | MANQUANT | — | Idée simple pour la bibliothèque | S |
| Compétences | Analyse de sécurité d'une compétence importée | FAIT | `skillscan.ts` ; test : skill-scan | — | — |
| Apps | Apps via Composio, Arcade, MCP par URL | DIFFÉRENT | catalogue MCP officiel (`catalog.ts`), `connectors.ts`, apps natives Gmail/Agenda/Drive/Outlook/Slack | Pas de Composio/Arcade (payants) ; MCP par URL présent | — |
| Apps | Ajouter un serveur MCP par son adresse | FAIT | `connectors.ts`, `connectorcatalogroutes.ts` ; test : connector-errors | — | — |
| Apps | Plusieurs comptes d'une même app ; le bot choisit le bon compte | FAIT | `agent/prompt.ts:152` (comptes natifs par libellé) | — | — |
| Apps | Outil marqué « destructeur » par l'app (destructiveHint) → demande | FAIT | `connectors.ts:47-183` | — | — |
| Apps | Recherche d'outils quand trop d'actions (plafond 128 outils par requête) | PARTIEL | `engine.ts:361` (ToolSearch des moteurs) | Côté API, pas de recherche d'outils ni de compte avant envoi | M |
| Apps | Descriptions maison des actions les plus utilisées (Gmail, Sheets…) | PARTIEL | apps natives avec leurs propres descriptions | — | — |
| Apps | Chaque réponse d'app commence par une ligne « a tourné / partiellement / échec, type d'échec, quoi essayer » | PARTIEL | `failures.ts` classe les échecs du tour ; erreurs d'app brutes | Enveloppe standard sur chaque résultat d'app | S |
| Apps | Valeur texte convertie au type du schéma (nombre, booléen) avant envoi | MANQUANT | — | Petite correction utile | S |
| Apps | Paramètre inconnu refusé avant de demander à la personne | MANQUANT | — | Évite une carte inutile | S |
| Apps | Carte « connecter cette app » quand une question en a besoin (`show_app_access`) | FAIT | `connector_request` `agent/tools.ts:1214` | — | — |
| Apps | Règle : contenu **privé** introuvable sur le web → carte de connexion de l'app, jamais « ça n'existe peut-être pas » | MANQUANT | — | Une phrase de prompt | S |
| Apps | Recherche web : Parallel, Exa, Firecrawl gratuits ou à clé | DIFFÉRENT | chaîne de recherche (`search.ts`, `searchTools` `agent/tools.ts:813`), Agent Reach, x_search | Équivalent | — |
| Apps | Prompt : « avec un outil de recherche, n'ouvre pas Google dans le navigateur » | DIFFÉRENT | `agent/prompt.ts:57` pousse à ouvrir le **lien donné** dans le navigateur (bon) | Rien n'interdit d'aller sur Google pour chercher | S |
| Apps | Comptes liés GitHub / Slack (code « link » à usage unique, 10 min) | PARTIEL | GitHub App (`githubapp.ts`), Telegram (code) | Pas de Slack lié | M |
| Apps | Coffre (vault) : identifiants remplis sans que le bot les voie | FAIT | `vault_list` / `vault_type` (`agent/tools.ts:552`), `VaultSection.tsx` ; test : wave3 | — | — |
| Apps | Clé de modèle ajoutée dans le coffre utilisée par les bots | FAIT | `AiAccounts.tsx`, `providers.ts` ; test : free-plan-own-keys | — | — |

### Ordinateur et navigateur

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Ordinateur | Ordinateur par bot : Chromium, dossier qui reste, shell | FAIT | `linux.ts`, `computer.ts`, `docker/desktop` ; test : linux, wave7-linux | — | — |
| Ordinateur | Instantané de page avec références d'éléments + `snapshotId`, refus si périmé | FAIT | `element_snapshot` / `element_click` (`agent/prompt.ts:105`, `agent/elements.ts`) ; test : elements | — | — |
| Ordinateur | Après envoi d'un formulaire, relire la page et dire ce qui s'est passé | PARTIEL | « check the result after each action » `agent/prompt.ts:104` | Pas de règle « relis la page après un envoi » | S |
| Ordinateur | Prise en main par la personne (takeover) puis rendu | FAIT | `takeover.ts`, `ask_takeover` (`agent/tools.ts:1221`) ; test : wave3 | — | — |
| Ordinateur | « Une phrase n'est pas une demande : appelle l'outil » (ne pas écrire « connecte-toi et dis-moi ») | PARTIEL | `agent/prompt.ts:134` | Pas la règle explicite « si tu t'apprêtes à dire qu'il faut se connecter, fais l'appel » | S |
| Ordinateur | Demander **une seule valeur** (code, mot de passe) tapée dans une case masquée qui va droit dans le champ | PARTIEL | `secret_request` (clés d'API), `vault_type`, `totp_code` | Pas de « case masquée vers ce champ de la page » pour un code SMS | M |
| Ordinateur | Changer un mot de passe sur un site : confié à la personne (« Je l'ai fait moi-même ») | PARTIEL | plancher : changements de compte demandent (`agent/sensitive.ts`) | Pas de carte « à faire par toi » | S |
| Ordinateur | Fichiers envoyés par le bot dans la conversation (carte) | FAIT | `file_send` `agent/tools.ts:356` | — | — |
| Ordinateur | Téléchargement toujours en pièce jointe opaque (jamais HTML rendu sur l'origine de l'app) | NON VÉRIFIÉ | `pagefiles.ts`, `publiclinks.ts` | À vérifier : en-têtes `Content-Disposition` | S |
| Ordinateur | Python + openpyxl, pandas, python-docx… installés, et le bot le sait | FAIT | `agent/prompt.ts:112` | — | — |
| Ordinateur | Ordinateur démarré quand on ouvre l'écran ; mis en veille quand inactif | FAIT | `config.ts:74` `desktopIdleMin`, `freecomputers.ts` ; test : free-computers | — | — |
| Ordinateur | Politique réseau sortante par bot (tout / défaut + liste / liste seule / rien), filtre local, rien ne sort avant la politique | MANQUANT | `linux.ts:155` : bots isolés entre eux, **pas** de filtre de sortie | Voir « À faire » | L |
| Ordinateur | Adresses de métadonnées cloud refusées depuis l'ordinateur | NON VÉRIFIÉ | — | À vérifier dans `deploy/install.sh` | S |
| Ordinateur | Environnement du shell épuré (pas de clés héritées) | FAIT | conteneur séparé, relais de secrets (`egress.ts`) ; test : isolation | — | — |
| Ordinateur | gVisor (`runsc`) en option | PARTIEL | `linux.ts:199` `desktopRuntime` | Documenté ? à vérifier | S |
| Ordinateur | Jeton d'ordinateur dérivé par bot (HMAC) | FAIT | `botlink.ts` (socket propre à l'ordinateur) ; test : botlink-live | — | — |
| Ordinateur | Chromium « headed » par défaut contre les détections | FAIT | bureau graphique complet (`docker/desktop`) | — | — |
| Ordinateur | Web Bot Auth (signature Ed25519 des requêtes, annuaire `/.well-known`) | MANQUANT | — | Option pour les sites Cloudflare | M |
| Ordinateur | Proxy résidentiel par bot (`EGRESS_PROXY_<BOT>`) | MANQUANT | — | Option opérateur, désactivée par défaut | S |
| Ordinateur | Délais : action 10 s, navigation 30 s, tour de navigateur borné | PARTIEL | délais par outil dans `computer.ts` | Pas de « tour de navigateur » borné entre bots | S |
| Ordinateur | Dossiers de l'ordinateur personnel (bureau) : lecture seule, chaque modif/commande demandée par une fenêtre locale | FAIT | Sklubot Relais : double verrou (`agent/mycomputer.ts:10-17`) ; test : relay | — | — |
| Ordinateur | « Commandes sur ton ordinateur : jamais » (réglage) | PARTIEL | « Always » par bot | Interrupteur global « jamais de commande » | S |

### Approbations et sécurité

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Approbations | Supprimer, envoyer, partager, publier, payer demandent toujours | FAIT | plancher `agent/authorize.ts:25`, `agent/irreversible.ts`, `agent/sensitive.ts` ; test : floor-autonomy | — | — |
| Approbations | Réponses : une fois / pour cette conversation / toujours ici / refuser | FAIT | `agent/conversationgrants.ts`, « Always » (`agent/authorize.ts:141`) ; test : conversation-grant (11/11 passent, lancé ce jour) | — | — |
| Approbations | « Autoriser une fois » valable 10 min pour l'action vue ; si l'action change, rien n'est fait | FAIT | carte liée à l'empreinte (`agent/executions.ts:28`), expire à 25 min (`config.ts:191`) | 25 min au lieu de 10 : acceptable | — |
| Approbations | Carte de partage montre tout le texte envoyé (Afficher tout) | NON VÉRIFIÉ | `Cards.tsx` | — | — |
| Approbations | Carte nomme le compte (« depuis lea@… sur Gmail ») | PARTIEL | libellés de compte natifs | À vérifier sur la carte | S |
| Approbations | Reconnaissance par le **verbe** du nom d'outil ou le libellé du bouton, jamais par le contenu | DIFFÉRENT | `user_quote` + mots de l'utilisateur (`agent/grounding.ts`), clics engageants (`agent/prompt.ts:145`) | Sklubot va plus loin (preuve par citation) | — |
| Approbations | Revue automatique (auto-review) avec consignes admin | FAIT | `bot.autonomy === "auto"` (`agent/prompt.ts:213`), `judge` ; test : floor-autonomy | — | — |
| Approbations | « Extra vigilant » : demander avant tout changement | FAIT | bots « careful » (`agent/authorize.ts:28`) | — | — |
| Approbations | Règles écrites en langage courant → règle structurée (« Describe the rule ») | PARTIEL | `rule_propose` avec citation (`agent/prompt.ts:146`), `rules.ts` ; test : rule-words | Règles en texte lues par le modèle, pas compilées en règle vérifiable | M |
| Approbations | Admin ferme un type d'action pour tous (« demander à chaque fois » / « à faire soi-même ») | NON REPRIS | — | Pas d'admin d'équipe dans Sklubot (une personne) | — |
| Approbations | Le bot n'ajoute pas sa propre question avant la carte (« on te demande une seule fois ») | PARTIEL | `agent/prompt.ts:156` « The system asks on your behalf » | Pas « ne demande pas d'abord en mots » | S |
| Approbations | Test fermé « quand demander » (erreur dure à défaire, lectures très différentes, seul la personne sait ; nom ambigu → demander) | PARTIEL | `agent/prompt.ts:159` « only when a real decision is the user's » | Pas les 3 cas, ni « nom qui colle à plusieurs → demande lequel » | S |
| Approbations | Une approbation sans réponse dont le tour a fini : « pas de résultat, la personne n'a pas répondu » | FAIT | approbations orphelines expirées au redémarrage (`index.ts:100`) | — | — |
| Sécurité | Enveloppe « contenu non fiable » sur les résultats d'outils | FAIT | `agent/prompt.ts:160`, marquage `tainted` (`agent/loop.ts`) ; test : security | — | — |
| Sécurité | Politique en expressions (CEL) sur outil, page, élément, commande, fichier, initiateur | DIFFÉRENT | `authorize.ts` en code fixe + règles en mots | Pas de langage de règles ; pour une personne, c'est suffisant | — |
| Sécurité | « Qui a lancé » : personne / routine / objectif / mémoire / passage entre bots, dans chaque ligne d'audit | FAIT | `origin` dans le journal (`agent/loop.ts:1611`) | — | — |
| Sécurité | Version minimale sûre signée (security floor) pour les apps | MANQUANT | — | Pour mobile/compagnon | M |
| Sécurité | Jeton d'installation obligatoire en mode une personne (cookie) | DIFFÉRENT | comptes avec mot de passe, 2FA (`totp.ts`) ; test : totp | Sklubot a de vrais comptes | — |
| Sécurité | Mode une personne refusé sur une adresse publique | NON REPRIS | Sklubot a toujours une connexion | — | — |

### Activité et audit

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Activité | Journal : lu, changé, envoyé, refusé, approuvé | FAIT | `journal.ts`, `addJournal` (`agent/loop.ts:1611`), `SurveillanceView.tsx` ; test : wave5b | — | — |
| Activité | Activité par bot depuis sa page | FAIT | `DetailsPanel.tsx` | — | — |
| Activité | « Demande au journal » : question en mots → filtres | MANQUANT | — | Petite boîte de recherche en langage courant | M |
| Activité | « Pourquoi ? » sur une ligne : rejoue les contrôles et dit si les réglages d'aujourd'hui décideraient autrement | MANQUANT | — | — | M |
| Activité | « Que se passerait-il si… » (simulateur de politique sans modèle) | MANQUANT | — | — | M |
| Activité | Ligne bloquée nomme la règle qui a arrêté | PARTIEL | raison dans le journal | Nom de la règle | S |
| Activité | Export OpenTelemetry | MANQUANT | — | Pour les gros déploiements | M |

### Tâches, sous-agents, plusieurs bots

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Tâches | Le bot confie un gros travail à une tâche (fil à part), la conversation reste courte | FAIT | `task_start` (tâches de fond, `agent/bgtasks.ts`) ; test : wave5 | — | — |
| Tâches | Stop / guider une tâche depuis sa carte | PARTIEL | arrêt des tâches (`TasksView.tsx`) | Guidage d'une tâche en cours | S |
| Tâches | Tâche : nouvel essai seulement si utile (panne passagère ≤ 3 passages, jamais sur refus durable) | FAIT | `agent/failures.ts:37` (classement, nouveaux tours espacés) ; test : failures | — | — |
| Tâches | Tâche fait un changement d'app **une seule fois** (enregistré avant envoi, jamais renvoyé après reprise) | FAIT | `agent/executions.ts:9-17` (réservation, « incertain », carte « est-ce passé ? ») ; test : wave5, failures | — | — |
| Tâches | Même changement demandé deux fois **dans un tour** : fait une fois, le 2e appel reçoit le 1er résultat | MANQUANT | `agent/loop.ts:1399-1401` : refus seulement au 5e appel identique | Voir écarts | S |
| Tâches | Même appel en échec 2 fois → plus envoyé, « change-le » | PARTIEL | `LoopGuard` `agent/reliability.ts:87` : arrêt du **tour** après 4 échecs de suite du même outil | Arrêt brutal au lieu d'une note au bot à 2 | S |
| Tâches | Tâche qui attend la personne (prise en main, secret, connexion) affiche « Te concerne » et reprend | FAIT | `ask_takeover`, `secret_request` mettent le tour en attente ; vue « besoin de toi » (`push.ts` `needs`) | — | — |
| Tâches | Résultats de tâches dans l'ordre, et prévenir (push/Slack) si non lu après quelques secondes | PARTIEL | push à la fin (`push.ts`) | Pas de « non lu après N s » ; pas de nouvel essai d'écriture pendant 1 jour | S |
| Sous-agents | `run_subagent` : copie fraîche de soi, 10 en même temps, 100 par réponse, la suite attend son tour | PARTIEL | `helper_start` (`agent/tools.ts:1123`) : **4 assistants max**, refus au-delà (`agent/team.ts:9`) | Pas de file d'attente : au 5e le bot est refusé et doit gérer | M |
| Sous-agents | Consigne « sous-agents seulement pour des parties indépendantes avec beaucoup de lecture ; décisions et approbations restent au bot principal » | PARTIEL | `agent/prompt.ts:172` « self-contained side job » | Pas la règle « jamais pour une simple question » ni « l'approbation remonte » | S |
| Plusieurs bots | Un bot demande à un autre (grant directionnel, profondeur 1, 3 bots par tour) | FAIT | `bot_message` (`agent/tools.ts:1085`), `MAX_HOPS = 3` (`agent/team.ts:8`) ; test : room-routing | Pas de liste « qui peut demander à qui » | — |
| Plusieurs bots | Conversation de groupe avec plusieurs bots et plusieurs personnes | PARTIEL | salons (`agent/roomrouting.ts`, `tools-room.ts`) ; test : room-routing, roombudget | Salons d'une seule personne + ses bots | — |
| Plusieurs bots | Bot qui n'a rien à dire en groupe : pas de ligne rouge « tour fini sans rien dire » | FAIT | `stay_quiet` (`agent/tools.ts:1279`) | — | — |
| Plusieurs bots | Groupe : nom de qui a envoyé chaque ligne | FAIT | salons multi-bots | — | — |
| Plusieurs bots | Page « Agents » : agents vers lesquels les bots délèguent | NON REPRIS | — | Lié aux agents externes | — |

### Voix

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Voix | Dictée dans la zone de saisie (Stop, Envoyer, Annuler, Réessayer ; 2 min, 10 Mo) | FAIT | `voice/transcribe.ts`, `voice/providers.ts:212` ; test : voice-transcribe | — | — |
| Voix | Dictée sur l'appareil (Apple Speech, SAPI) dans l'app de bureau | NON REPRIS | compagnon Electron | Dépend de la plateforme | — |
| Voix | Appel vocal en temps réel (OpenAI Realtime / Grok voice), le modèle vocal délègue le travail outillé au bot | DIFFÉRENT | `voice/session.ts:22` : micro → détection de parole → transcription → tour normal du bot → lecture phrase par phrase ; test : wave6-voice | Sklubot fait tout passer par le bot (plus lent mais un seul cerveau). Idée : modèle temps réel en option | L |
| Voix | Fin d'appel : transcription sauvée + carte « Appel vocal » résumée, réessai si le résumé échoue | PARTIEL | `calls.ts` | À vérifier : carte résumé + bouton réessayer | S |
| Voix | Brouillon d'appel gardé dans le navigateur si l'enregistrement échoue | MANQUANT | — | Boîte d'envoi locale | S |
| Voix | Appel coupé à 15 min ; une 2e demande pendant que le fil travaille est refusée avec explication | PARTIEL | `voice/session.ts` | À vérifier : durée max | S |

### Canaux et notifications

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Canaux | Slack et Teams (via OpenTag), cartes d'approbation dans Slack | MANQUANT | Slack seulement comme app (outils), pas comme canal | Canal Slack (voir audits précédents I1/I2) | L |
| Canaux | Telegram | DIFFÉRENT | `telegram.ts` (canal complet chez Sklubot, absent d'OpenBot) | — | — |
| Canaux | SMS Twilio avec STOP/START | NON REPRIS | fournisseur payant ; AgentPhone en app (`catalog.ts:164`) | — | — |
| Canaux | Push mobile (Expo) | PARTIEL | Web Push (`push.ts`) ; app mobile Expo (`mobile/`) | À vérifier : push natif de l'app mobile | M |
| Canaux | « Te joindre » (Reaching you) : où le bot te prévient | PARTIEL | `NotificationsSection.tsx`, réglages de push par type et heures calmes (`push.ts:94`) | Choix du canal par bot | S |
| Canaux | Notifications à l'ouverture de l'app de bureau | NON VÉRIFIÉ | compagnon | — | — |

### Réglages, admin, équipes

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Admin | Organisations multiples, membres, rôles, invitations | DIFFÉRENT | mode hébergé multi-comptes (`hosted.ts`), espaces partagés (`workspaces.ts`) | Pas de rôles d'organisation | — |
| Admin | SSO Google / Microsoft / Okta, « SSO obligatoire » | PARTIEL | connexion Google (`googlelogin.ts`) ; test : google-login | Microsoft/Okta | M |
| Admin | SCIM (comptes créés et retirés par l'annuaire) | NON REPRIS | — | Entreprise, hors cible | — |
| Admin | Liste blanche de modèles et de serveurs MCP | NON REPRIS | — | Une personne choisit elle-même | — |
| Admin | Chaque tour compté (metering) | FAIT | `usage.ts`, `usagecaps.ts`, `credits.ts` ; test : usage-caps, credits | — | — |
| Admin | Interrupteurs d'entreprise (bots, navigateur cloud, réseau, ordinateur) | PARTIEL | `disabledTools` par bot, shell coupable (`agent/prompt.ts:108`) | Pas d'interrupteur global « réseau » | S |
| Admin | Mises à jour gérées sur Kubernetes (agent signé, fenêtre de maintenance, sauvegarde vérifiée) | NON REPRIS | — | Kubernetes, hors cible | — |
| Admin | Sauvegarde | FAIT | `autobackup.ts`, `backupcheck.ts` ; test : auto-backup, backup-drill | — | — |
| Admin | Clés d'API personnelles pour l'API | FAIT | `botapi.ts`, `BotApi.tsx` ; test : bot-api | — | — |
| Admin | API REST décrite en OpenAPI 3.1, erreurs `problem+json`, pagination curseur, `Idempotency-Key` sur chaque écriture | PARTIEL | `docs/API.md`, `docs/API-BOT.md` | Pas de fichier OpenAPI, pas de clé d'idempotence générale (seulement `thirdparty.ts:30`) | M |
| Admin | Dépréciation avec en-têtes `Deprecation` / `Sunset` | MANQUANT | — | — | S |
| Admin | L'app dit sa version et le serveur peut demander une version plus récente | PARTIEL | `DownloadPage.tsx` | Pas de version minimale imposée | S |
| Admin | Télémétrie produit anonyme, documentée, désactivable | NON REPRIS | choix de confidentialité | — | — |

### Accueil, bureau, mobile

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Accueil | Tour de découverte des bots de départ | FAIT | `Onboarding.tsx:77` ; test : non trouvé | — | — |
| Accueil | Admin reçoit « Ajouter une clé de modèle » quand un bot n'a pas de connexion IA | PARTIEL | `KeysHealthLinks.tsx`, `Reliability.tsx` | Vérifier que le 1er message propose le remède | S |
| Accueil | Configuration de bureau dit ce qui manque (Docker sans CPU/mémoire/disque) | PARTIEL | `disk.ts`, `diskwatch.ts`, `health.ts` | — | — |
| Bureau | App de bureau signée Mac/Windows avec tout dedans | DIFFÉRENT | compagnon Electron (`companion/`) + serveur auto-hébergé | — | — |
| Bureau | Mises à jour de l'app de bureau signées | PARTIEL | — | À vérifier côté compagnon | M |
| Mobile | App iOS/Android : conversations, approbations, push | PARTIEL | `mobile/` (Expo) | Couverture à vérifier écran par écran | M |
| Mobile | Connexion entreprise depuis le téléphone (ticket 2 min) | NON REPRIS | — | — | — |

### Fiabilité

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Fiabilité | Le travail continue tout de suite après approbation, même après redémarrage | FAIT | `recoverInterruptedTurns` (`agent/loop.ts`) ; test : engine-queue, pause | — | — |
| Fiabilité | Plusieurs serveurs sur une base (LISTEN/NOTIFY) | NON REPRIS | SQLite, un seul serveur | Hors cible | — |
| Fiabilité | Migrations au démarrage, retour arrière possible | FAIT | `db.ts` ; test : migrations | — | — |
| Fiabilité | Réponse coupée par la longueur : « continue exactement où tu t'es arrêté » | FAIT | `agent/loop.ts:1056` | — | — |
| Fiabilité | Bot qui finit un pas sur une promesse sans appel → renvoyé la faire (2 fois max) | MANQUANT | `agent/loop.ts:1073-1090` ne regarde que le tour **muet** | Voir écarts | S |
| Fiabilité | Modèle qui ne répond pas : « ce modèle ne répond pas » au lieu d'une erreur vague | FAIT | `failures.ts`, modèle de secours (`agent/loop.ts:495`) ; test : failures | — | — |
| Fiabilité | Modèles de secours par bot / compte / serveur | FAIT | `modelChain` `agent/reliability.ts:18` | — | — |

### Prompt de méthode (règles de travail)

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Prompt | Utiliser d'abord ce qu'on a (conversation, résultats), puis apps, puis web, puis la personne | MANQUANT | — | Paragraphe « comment travailler » | S |
| Prompt | Lire par lots indépendants d'environ 5, lire chaque résultat avant le lot suivant ; changements un par un | MANQUANT | — | Idem | S |
| Prompt | Ne jamais inventer un id, une adresse, un nom pour un appel ; une recherche vide n'est pas « rien » | PARTIEL | `agent/prompt.ts:182` « Never invent facts, names, numbers or links » | Pas appliqué aux **arguments d'appel** ; pas « essaie autrement » | S |
| Prompt | Échecs par type : passager → 1 essai ; refus de la personne → jamais ; issue inconnue → regarder d'abord ; échec répété → rapport court | PARTIEL | `agent/prompt.ts:156-158` (refus et issue inconnue) | Pas « réessaie une fois » pour un passager, pas « rapport court » | S |
| Prompt | Dire « fait » seulement si un résultat le montre ; relire une fois après un changement d'app | PARTIEL | `agent/prompt.ts:182` | Pas la relecture ciblée, pas « dis "tous" seulement si tu as tout vérifié », pas « ne dis rien de ce que tu n'as pas regardé » | S |
| Prompt | Taille de la réponse adaptée ; « Peux-tu… ? » → oui/non + une question ; une question-demande se fait | PARTIEL | `agent/prompt.ts:180` « Short… Lead with the outcome » | Règles précises absentes | S |
| Prompt | Rapport de fin en 1-2 phrases avec lien, sans récapituler les étapes | PARTIEL | `agent/prompt.ts:165` (rapport final structuré) | Sklubot demande un rapport plus long ; risque de verbosité | S |
| Prompt | Parler dans les mots de la personne, jamais nommer un outil ni citer une erreur brute | FAIT | `agent/prompt.ts:183` et `:241` | — | — |
| Prompt | Tableurs utilisables : entrées étiquetées, formules vivantes, en-têtes gelés, vérifier #REF! | MANQUANT | — | Paragraphe « documents » | S |
| Prompt | Provenance : dire d'où vient une réponse ; chiffres « qui engagent » jamais affirmés sans source | MANQUANT | — | Paragraphe « sources » | S |
| Prompt | Ce qui est installé sur l'ordinateur, pour ne pas écrire un script pour un programme absent | FAIT | `agent/prompt.ts:112` | — | — |
| Prompt | Dire en une phrase ce qu'on fait au premier geste sur l'ordinateur (car il met du temps à démarrer) | MANQUANT | — | Une ligne | S |
| Prompt | Refus de politique = règle, pas une panne : ne pas contourner, continuer le reste | FAIT | `agent/prompt.ts:156` | — | — |

## Écarts de comportement, flux par flux

### 1. Premier message à un bot

- **OpenBot.** Le serveur envoie le rôle dans `<identity>` et `<role>`, puis les règles de travail en balises (`how_to_work`, `asking`, `sources`, `answer_format`, `replies`, `documents`, `subagents`, `untrusted_content`) dans `shared/bot-prompt.ts:workingGuidance`. Le navigateur envoie le fuseau horaire avec chaque tour (`shared/person-time-zone.ts`), et le bot reçoit « Aujourd'hui est … dans ton fuseau ; n'utilise pas de commande pour le savoir » (`todayGuidance`). Une ligne dit quel modèle il est.
- **Sklubot.** `buildSystemPrompt` (`agent/prompt.ts:83`) : identité, « Comment tu travailles » (40 puces mêlant outils et règles), « Comment tu écris » (5 lignes), profil, « En ce moment », routines, règles, mémoire, compétences, guides. L'heure arrive dans chaque message (`agent/loop.ts:714`).
- **Différences.** (a) Sklubot mélange « quels outils existent » et « comment travailler » : les règles de méthode sont noyées dans 40 puces sur les outils. OpenBot les isole en balises courtes, chacune écrite après un incident réel. (b) Sklubot n'a pas de paragraphe « comment travailler » (ordre des sources, lots de lecture, ne pas inventer d'arguments). (c) Fuseau : si le profil n'a pas de fuseau, « demain » est calculé en UTC ; OpenBot le prend du navigateur.
- **Corrections.** Ajouter un bloc `## Méthode` court, adapté de l'idée d'OpenBot (en nos propres mots) : ordre des sources, lots de 5, rien d'inventé dans un appel, recherche vide ≠ rien, échecs par type, « dis fait seulement avec un résultat » (S). Envoyer le fuseau du navigateur avec chaque message et l'utiliser quand le profil est vide (S). Ligne « tu tournes sur le modèle X » (S).

### 2. Un bot qui utilise son ordinateur sur un lien, sans qu'on le lui dise

- **OpenBot.** Le prompt choisit **une** consigne selon ce que le tour possède : avec un outil de recherche, « chercher n'est pas le travail du navigateur » ; sans outil, « n'ouvre jamais Google, réponds de mémoire en le disant, et propose une app de recherche par carte » (`bot-prompt.ts:49-76`). Ouvrir une page renvoie son titre et son texte ; « ne dis jamais à la personne d'aller voir elle-même ».
- **Sklubot.** Plus ambitieux et plus visible : « ouvre-le d'abord dans ton navigateur pour que l'utilisateur regarde, puis lis-le » (`agent/prompt.ts:55-67`), avec un mode d'emploi YouTube détaillé et un repli. C'est mieux pour l'utilisateur.
- **Fragilités.** (a) Rien n'interdit au bot d'aller sur Google/Bing dans son navigateur pour **chercher** (murs de cookies, CAPTCHA) alors qu'il a `web_search`. (b) Comme noté dans l'audit OpenClaw, la consigne de lien n'est posée que sur le message qui lance le tour ; un lien tapé pendant le travail passe par le steering sans consigne (`agent/loop.ts:373`).
- **Corrections.** Une phrase : « pour chercher, utilise web_search ; n'ouvre pas un moteur de recherche dans ton navigateur » (S). Poser la consigne de lien aussi sur les messages fondus dans le tour (S).

### 3. Tâche longue qui échoue au milieu puis reprend

- **OpenBot.** (a) L'app sonde un tour muet après 45 s ; s'il est mort, elle le termine avec « Envoie un message pour continuer » ; un tour coupé par le serveur finit avec un avis et un bouton **Continuer**. (b) Une tâche est classée : passager → nouvel essai après l'attente demandée par le fournisseur, 3 passages au plus ; durable → jamais. (c) Chaque changement d'app est enregistré avant l'envoi : jamais renvoyé après reprise ; issue inconnue → relire l'app d'abord. (d) Dans un tour, le même changement demandé deux fois est fait une fois.
- **Sklubot.** (b) et (c) existent et sont solides : `agent/failures.ts`, `agent/executions.ts` (réservation, « incertain », carte « Est-ce passé ? / Vérifier / Réessayer »), testés (failures, wave5). Mais : (a) aucun délai d'inactivité sur l'appel modèle (`llm/*` n'a pas de minuterie ; grep « idle » vide), l'avis « semble bloqué » arrive après **5 min** (`agent/watch.ts:21`) et attend un clic ; (d) un même changement réussi peut être refait jusqu'à 4 fois dans un tour : seul le 5e appel identique est refusé (`agent/loop.ts:1399-1401`).
- **Corrections.** Délai d'inactivité de flux (90-120 s sans octet → erreur passagère → essai suivant ou modèle de secours) (S). Dans `execute`, si une exécution `done` de même empreinte existe dans ce tour pour un outil qui change quelque chose, renvoyer son résultat au lieu de relancer (S). Bouton « Continuer » sur l'avis de tour coupé (S).

### 4. Approbations

- **OpenBot.** Quatre réponses (une fois / cette conversation / toujours ici / refuser). « Une fois » vaut 10 min pour l'action exacte. Le bot est prévenu que c'est OpenBot qui demande, pour ne pas poser la question deux fois (`ASKING_GUIDANCE`). Un outil marqué destructeur porte une note dans sa description (`DESTRUCTIVE_TOOL_NOTE`). Changer un mot de passe sur un site est confié à la personne (« Je l'ai fait moi-même »).
- **Sklubot.** Au même niveau, et plus strict : preuve par citation des mots de l'utilisateur (`agent/grounding.ts`), empreinte d'action à usage unique, contenu extérieur qui durcit tout, plancher non négociable (`agent/authorize.ts:25`). Testé (conversation-grant 11/11 aujourd'hui, floor-autonomy, security).
- **Fragilités.** (a) La fragilité déjà notée reste : un message tapé pendant une carte fait expirer la carte (`expireEngineApprovals`), donc « oui vas-y » tapé au lieu de cliqué annule l'action. (b) Le prompt dit « le système demande pour toi » mais pas « ne demande pas d'abord en mots » : le bot peut poser sa question puis la carte arrive (double demande). (c) Pas de carte « à faire par toi » pour un changement de mot de passe.
- **Corrections.** (a) Traiter un « oui » / « non » court tapé pendant une carte comme la réponse (S). (b) Une phrase « ne demande pas d'abord : fais le geste, la carte demandera une seule fois » (S). (c) Carte « Je l'ai fait moi-même / Ne pas le faire » pour les changements d'identifiants (S).

### 5. Mémoire apprise puis rappelée

- **OpenBot.** Faits ajoutés par la personne partagés entre bots ; faits appris par un bot gardés par lui ; rappel par le sens (embeddings) avec repli mots-clés ; mémoire peut **importer** des faits d'une app connectée. Règle : « ce que la personne dit dans la conversation passe avant ce qui est mémorisé » (`ROLE_SCOPE_GUIDANCE`). L'apprentissage propose des compétences à partir de **plusieurs** conversations, avec preuves.
- **Sklubot.** Extraction après 10 min de calme, faits prouvés par extrait (`agent/memory.ts:137-201`), choix par mots communs (`agent/prompt.ts:18`), rappel automatique par mots (`agent/recall.ts`), notes contestées marquées. Testé (memory-recall, memory-guard).
- **Différences.** (a) Pas de rappel par le sens. (b) Pas de règle de priorité « la conversation passe avant la mémoire » : une vieille préférence peut contredire la demande du jour. (c) Pas d'import depuis les apps.
- **Corrections.** Phrase de priorité (S). Rappel par le sens (M). Source de mémoire « agenda / contacts » optionnelle (M).

### 6. Une routine qui se déclenche

- **OpenBot.** Le tour reçoit « Personne ne regarde ce tour » et un format de rapport fixe : résultat (hypothèses d'abord), « Ce que je n'ai pas pu confirmer », questions restantes, changements avec liens (`ROUTINE_RUN_LINES`). Une routine écrite en liste devient une **liste de contrôle** : chaque partie doit finir Fait / Bloqué / Sauté avec raison avant que le tour puisse finir (`shared/routine-checklist.ts`). Une promesse sans appel renvoie le bot au travail (2 fois max). Au dernier pas, outils coupés. Échecs : un seul message au premier échec après un succès, arrêt à 10.
- **Sklubot.** `fireRoutine` (`scheduler.ts:48`) : créneau réservé, rattrapage, saut « rien de neuf » par empreinte des entrées (`scheduler.ts:133`), pause après N échecs, avis à **chaque** échec (`scheduler.ts:261`). Le tour reçoit le texte de la routine (`agent/turn-request.ts`), sans cadre « personne ne regarde ».
- **Où OpenBot est plus solide.** (a) Une routine en 3 étapes qui en fait 2 finit « réussie » chez Sklubot. (b) Le rapport n'a pas de forme fixe : l'utilisateur doit chercher ce qui manque. (c) Le bot peut poser une question (`ask_user`) dans une routine où personne ne répond.
- **Corrections.** Cadre de tour de routine en 6 lignes (personne ne regarde, ne pas demander, faire le reste, relire son dernier paragraphe, format du rapport) (S). Liste de contrôle pour les routines en liste (M). Un seul avis au premier échec après un succès (S).

### 7. Conversation de groupe avec plusieurs bots

- **OpenBot.** Un message sans nom va à tous les bots du groupe ; celui qui n'a rien à dire ne laisse aucune ligne ; un bot nommé qui ne dit rien est un échec. Le rôle dit « une demande adressée à X est pour toi ». Passages entre bots : autorisations directionnelles, profondeur 1, 3 bots par tour, refus plutôt que coupe.
- **Sklubot.** Mention d'abord, puis choix de qui répond (règles puis petit modèle, `agent/roomrouting.ts`), 3 rebonds (`agent/team.ts:8`), budget de messages, `stay_quiet`. Testé (room-routing, roombudget).
- **Différence.** Au niveau. Manque : liste « qui peut demander à qui » par bot (aujourd'hui tout bot peut écrire à tout coéquipier).
- **Correction.** Optionnelle : autorisations directionnelles entre bots (S).

### 8. Appel vocal

- **OpenBot.** Modèle vocal temps réel (WebRTC OpenAI ou WebSocket Grok) qui parle directement et **délègue** au bot ce qui demande des outils ; contexte de 12 000 caractères ; transcription sauvée et résumée à la fin, réessai si le résumé échoue ; brouillon gardé dans le navigateur ; 15 min max ; une 2e demande pendant que le fil travaille est refusée avec explication.
- **Sklubot.** Pipeline maison (`voice/session.ts:22`) : détection de parole, transcription, tour normal du bot, lecture phrase par phrase, interruption à la voix. Testé (wave6-voice, voice-speak, voice-transcribe).
- **Différence.** Sklubot a un seul cerveau (plus cohérent, plus lent). OpenBot répond plus vite pour la conversation simple.
- **Corrections.** Boîte d'envoi locale pour la transcription (S). Plus tard : modèle temps réel en option, avec délégation au bot (L).

### 9. Livraison d'un fichier ou d'une page

- **OpenBot.** `computer_send_file` : le serveur tire le fichier par le téléchargement gouverné, le contrôle comme un envoi, le range comme pièce jointe ; les téléchargements sont **toujours** des pièces jointes opaques, jamais du HTML rendu sur l'origine de l'app (`shared/file-download.ts`). Fichiers dans S3/GCS au choix.
- **Sklubot.** `file_save`, `file_send` (`agent/tools.ts:336-356`), artefacts et pages privées, liens publics temporaires (`publiclinks.ts`). Règle « jamais fait sans résultat ».
- **À vérifier.** Que le téléchargement d'un `.html` ou `.svg` de la bibliothèque n'est jamais servi en ligne sur l'origine de l'app (risque de script). Je n'ai pas pu le prouver en lecture rapide.
- **Correction.** Test : un fichier `.html` de la bibliothèque est servi avec `Content-Disposition: attachment` ou depuis une origine séparée (S).

### 10. Accueil d'un nouvel utilisateur

- **OpenBot.** Bureau : écran unique qui dit ce qui se passe, ce qui manque (Docker sans mémoire), puis un bot de départ ; un admin sans clé de modèle reçoit « Ajouter une clé » au premier message. Un modèle n'est proposé que s'il a répondu à un vrai appel (model lock).
- **Sklubot.** 4-5 étapes passables (`web/src/components/Onboarding.tsx:77`). Comme noté dans l'audit OpenClaw, rien ne vérifie qu'un cerveau répond avant le premier message.
- **Correction.** Appel d'essai au modèle à la fin de l'accueil, avec remède si échec (S).

### 11. Erreur de moteur ou de fournisseur

- **OpenBot.** Message en mots simples quand le serveur est injoignable ; « ce modèle ne répond pas » ; harnais prouvés par modèle.
- **Sklubot.** Classement stable, disjoncteur, modèles de secours, carte avec remèdes, limite d'abonnement avec heure de retour (`agent/failures.ts`, `agent/sublimit.ts`). Testé (failures, sublimit, codex-retry). Au niveau ou mieux.
- **Petit écart.** Chaque essai raté écrit un avis dans le chat (`agent/loop.ts:495`) ; OpenBot reste plus discret.

### 12. Redémarrage en plein travail

- **OpenBot.** Le travail repris après une approbation continue tout de suite après un redémarrage ; les changements déjà envoyés ne sont pas renvoyés ; un résultat de tâche qui ne peut pas s'écrire est réessayé pendant un jour.
- **Sklubot.** `recoverInterruptedTurns`, actions « incertaines » jamais rejouées (`index.ts:101`), approbations orphelines expirées (`index.ts:100`). Testé (engine-queue, pause, wave2). Au niveau.

### 13. Message tapé pendant que le bot travaille

- **OpenBot.** Le message est **mis en file** et visible ; « Envoyer maintenant » arrête le tour en gardant ce qui est fait, puis envoie ; « Retirer » l'enlève.
- **Sklubot.** Le message est fondu dans le tour en cours (`agent/loop.ts:372`). Défaut déjà relevé : si le tour en cours est une routine ou un message d'un autre bot, le message de l'utilisateur hérite des droits de ce tour (fichiers personnels refusés, « crée une routine » refusé). Aucun test ne couvre ce cas.
- **Corrections.** Ne pas fondre un message de personne dans un tour qu'elle n'a pas lancé (S). Montrer les messages en attente avec « Envoyer maintenant » / « Retirer » (M).

### 14. Bot qui tourne en rond

- **OpenBot.** Même appel en échec 2 fois → plus envoyé, avec « change-le ou fais autrement » ; même changement 2 fois dans un tour → fait une fois.
- **Sklubot.** 5e appel identique refusé (`agent/loop.ts:1401`) ; tour arrêté après 4 échecs du même outil ou 4 résultats identiques (`agent/reliability.ts:87`), puis carte. Le bot n'est pas prévenu avant l'arrêt.
- **Correction.** Au 2e échec identique (même outil, mêmes arguments), refuser l'appel avec une note au bot au lieu d'attendre l'arrêt du tour au 4e (S).

### 15. Promesse non tenue en fin de pas

- **OpenBot.** Un pas qui finit sur « je vais chercher le reste » sans appel d'outil renvoie le bot faire le travail, 2 fois de suite au plus ; « relis ton dernier paragraphe : s'il promet un travail non fait, fais-le » est dans le cadre des routines.
- **Sklubot.** La boucle (`agent/loop.ts:1073-1090`) relance seulement un tour **muet** (aucun texte) ou demande un rapport final. Un tour qui dit « je m'en occupe » et s'arrête finit comme réussi.
- **Correction.** Détecteur simple (FR/EN : « je vais », « je m'en occupe », « I'll », « let me ») sur le dernier texte d'un tour sans appel → un message système « fais-le maintenant ou dis pourquoi tu ne peux pas », 2 fois max (S).

## À faire, du plus utile au moins utile

1. **Délai d'inactivité sur l'appel modèle** (90-120 s sans octet → erreur passagère, essai suivant ou secours) ; aujourd'hui un flux figé bloque la file du bot jusqu'au clic (S).
2. **Promesse sans appel** : renvoyer le bot faire ce qu'il annonce, 2 fois max (S).
3. **Même changement deux fois dans un tour** : renvoyer le résultat de la 1re exécution au lieu de refaire (S).
4. **Bloc « Méthode » dans le prompt** (ordre des sources, lots de 5, rien d'inventé dans un appel, recherche vide ≠ rien, échecs par type, « fait » seulement avec un résultat, relecture ciblée) (S).
5. **Cadre des tours de routine** : « personne ne regarde », ne pas demander, finir le reste, format de rapport avec « Ce que je n'ai pas pu confirmer » (S).
6. **Ne pas fondre un message de personne dans un tour qu'elle n'a pas lancé** (S).
7. **« Oui » / « non » tapé pendant une carte = réponse à la carte** (S).
8. **Règles « quand demander »** (3 cas fermés, nom ambigu → demander lequel, ne pas demander avant la carte) (S).
9. **Routine en liste → liste de contrôle Fait / Bloqué / Sauté** (M).
10. **Un seul avis au premier échec de routine après un succès** (S).
11. **2e échec identique → refus avec note au bot**, avant l'arrêt du tour (S).
12. **Fuseau du navigateur envoyé à chaque message** quand le profil est vide (S).
13. **Politique réseau sortante par bot** (tout / liste / rien, métadonnées cloud toujours refusées) (L).
14. **File visible des messages en attente** avec « Envoyer maintenant » et « Retirer » (M). — **FAIT (2026-11-23)** : file visible + « Retirer » (`QueuedNotes.tsx`), « Envoyer maintenant » (`agent/sendnow.ts`, web ; pas encore sur mobile)
15. **Bouton « Continuer »** sur l'avis de tour coupé ; avis « semble bloqué » plus tôt (S).
16. **Assistants (helpers) en file** au-delà de 4 au lieu d'un refus (M).
17. **Règles de provenance** (chiffres qui engagent, graphiques avec source) et **règles tableur** (formules vivantes) (S).
18. **Règle « la conversation passe avant la mémoire »** (S).
19. **Rappel par le sens** dans la mémoire (M).
20. **Interdire Google dans le navigateur pour chercher** quand `web_search` existe (S).
21. **Case masquée pour une seule valeur** (code SMS) qui va droit dans le champ de la page (M). — **FAIT (2026-11-23)** : `code_request` (L91, `agent/codebox.ts`)
22. **Carte « à faire par toi »** pour les changements de mot de passe sur un site (S). — **FAIT (2026-11-23)** : `ask_takeover` raison `password`, « Je l'ai fait moi-même » (L91)
23. **Test : fichier .html de la bibliothèque jamais rendu sur l'origine de l'app** (S).
24. **Appel d'essai au modèle à la fin de l'accueil** (S).
25. **Analyse de fond « compétences proposées »** à partir de plusieurs conversations, avec preuves et file d'approbation (M).
26. **Masquage des secrets dans les captures de Teach** (M). — **FAIT (2026-11-23)** : pages et fenêtres d'applis (OCR), cases à la taille de l'image (L40, `teachmask.ts`, `teachappmask.ts`)
27. **LaTeX** dans les messages (S). — **FAIT (2026-11-23)** : KaTeX (MIT) en MathML, chargé seulement si besoin (`lib/mathtex.ts`, `mathrender.ts`)
28. **Renommer une conversation / titre auto des fils** (S).
29. **Sélecteur de modèle par conversation** et ligne « tu tournes sur X » (S).
30. **Plancher 15 min et plafond 20 routines actives** (S).
31. **Journal : « demande au journal », « Pourquoi ? », « Que se passerait-il si »** (M).
32. **Enveloppe standard sur chaque résultat d'app** (a tourné / partiellement / échec + quoi essayer) et **conversion de types** selon le schéma (S).
33. **Web Bot Auth** et **proxy par bot** en option opérateur (M).
34. **Boîte d'envoi locale** pour les transcriptions d'appel (S).
35. **Fichier OpenAPI + en-têtes de dépréciation** pour l'API (M).
36. **Canal Slack** (L) — déjà noté dans les audits précédents.

## Non vérifié

- Le code **serveur** d'OpenBot n'est pas dans le dépôt : boucle d'agent, délais exacts, file de travail et politique d'approbation sont décrits d'après la doc, le CHANGELOG et `shared/`. Les chiffres (45 s, 40 pas, 10/100 sous-agents, 10 min) viennent du CHANGELOG et de `docs/configuration.md`.
- Côté Sklubot : rendu de la carte de partage (texte complet ?), durée max d'un appel vocal, carte de résumé d'appel avec réessai, en-têtes de téléchargement des fichiers `.html`, push natif de l'app mobile, mises à jour signées du compagnon, refus des adresses de métadonnées cloud depuis les ordinateurs, ce qui reste lisible après la retraite d'un bot, objectif récurrent jamais « complété ».
- Tests Sklubot lancés : `conversation-grant.test.ts` (11/11). Les autres statuts « FAIT » s'appuient sur la lecture du code et la présence d'un fichier de test nommé, pas sur une exécution.
- L'arbre Sklubot était modifié par un autre agent pendant la lecture : quelques numéros de ligne peuvent être décalés.
