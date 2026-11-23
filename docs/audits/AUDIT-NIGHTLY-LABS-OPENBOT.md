# Audit complet : nightly-labs/openbot comparé à Sklubot

Date : 22/11/2026. Dépôt lu : `nightly-labs/openbot`, commit `ae9de4d` du 22/11/2026 (copie superficielle, 9 700 fichiers, lue sans rien exécuter, puis supprimée).
Sklubot lu dans `/home/user/grok-sklubs` en lecture seule (arbre modifié en parallèle par un autre agent : numéros de ligne approximatifs).

Nom du fichier : deux dépôts s'appellent « openbot » dans la liste ; celui de CopilotKit est dans `AUDIT-COPILOTKIT-OPENBOT.md`.

## Licence : à lire avant tout

**PolyForm Noncommercial 1.0.0** (`LICENSE`), copyright Synthetify Labs (Pologne), licence commerciale sur demande (`NOTICE`). Elle permet de lire, d'utiliser et de modifier **pour un usage non commercial** seulement. Sklubot est un produit (offre hébergée, crédits) : **on ne copie aucun code, aucun texte de prompt, aucune constante**. On ne garde que des idées de fonctionnement, décrites ici avec nos propres mots, à réécrire de zéro. Les composants tiers cités dans `NOTICE` (ex. Blobatar, MIT) ont leur propre licence. Le client WhatsApp est un fork de Baileys (client non officiel) : non repris.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 44 |
| PARTIEL | 42 |
| MANQUANT | 32 |
| DIFFÉRENT | 7 |
| NON REPRIS | 10 |
| Non vérifié | 2 |
| **Total** | **137 lignes** |

Lecture rapide : c'est une **app de bureau** (Electron, SolidJS) qui fait tourner des agents CLI (Codex, Claude Code, Grok, OpenCode, Gemini, Cursor, Cline, Kimi, Devin, Copilot, Mistral, Hermes) en mode **accès complet sans approbation** après un accord au premier lancement. Elle est donc **moins sûre** que Sklubot par conception (pas de cartes par action). Mais elle a plusieurs mécanismes de fiabilité que Sklubot n'a pas : un **contrôle de fin indépendant** (un petit modèle juge si la demande est vraiment finie et relance jusqu'à 3 fois), une **question à côté** qui ne touche pas la tâche, une **file de messages** avec pause / reprise / annulation, une **revue de mémoire** périodique, une **réserve de plusieurs comptes d'abonnement**, des **webhooks signés avec dédoublonnage**, et des **canaux Slack, Discord, Telegram** passant par un relais.

## Ce qui a été lu côté nightly-labs/openbot

- `README.md`, `NOTICE`, `docs/messaging.md`, `docs/webhooks.md`, `docs/automation.md`, `docs/architecture/agents.md`, `channels-and-messaging.md`, `browser.md`, `computer-use.md`, `skills-and-plugins.md`, `integrations.md`, `side-panel.md` (titres et premiers paragraphes de chaque section).
- Code (lecture des noms, constantes et quelques fichiers) : `src/backend/agent/finish-check.ts`, `plan-continuation.ts`, `routine-start-retry.ts`, `memory-review.ts`, `context-compaction.ts`, `usage-limit-gate.ts`, `provider-account-pool.ts`, `side-question.ts`, `queue-controls.ts`, `boot-recovery.ts`, `live-voice.ts`, `developer-instructions.ts` (thèmes des consignes seulement), liste complète de `src/backend`.

## Tableau complet des fonctions

Taille : S (moins d'un jour), M (quelques jours), L (une semaine ou plus). Chemins Sklubot depuis `server/src/` ; « test : x » = `server/test/x.test.ts`.

### Agents (bots)

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Agents | Agent persistant avec son propre espace de fichiers et sa conversation | FAIT | ordinateur et bibliothèque par bot (`linux.ts`, `computer.ts`) ; test : linux | — | — |
| Agents | Choix du moteur par agent parmi 12 CLI (Codex, Claude, Grok, OpenCode, Gemini, Cursor…) via ACP | PARTIEL | moteurs Claude Code et Codex (`agent/engine.ts`), API (OpenRouter, fournisseurs, `providers.ts`) ; test : codex-retry, engine-finish | Pas d'ACP générique (Grok CLI, Gemini, OpenCode…) | L |
| Agents | Détection des serveurs de modèles locaux (Ollama, LM Studio) et des agents installés | MANQUANT | — | Détection auto d'un point d'accès local | S |
| Agents | Point d'accès compatible OpenAI personnalisé | FAIT | `providers.ts`, `apimodels.ts` ; test : openrouter | — | — |
| Agents | Création et modification d'un agent **en parlant** (nom, titre, instructions, avatar, modèle, accès) | FAIT | `bot_create`, `self_update` (`agent/tools-team.ts:205`, `:242`), recruteur `bot_propose` ; test : recruiter | — | — |
| Agents | Message d'accueil d'un nouvel agent : il pose lui-même une question avec 3 premiers choix | MANQUANT | — | Premier tour automatique d'un nouveau bot | S |
| Agents | Fichier d'instructions dans l'espace de travail (AGENTS.md / CLAUDE.md) | DIFFÉRENT | instructions en base (`agent/prompt.ts:249`), format d'équipe en Markdown (`teammd.ts`) ; test : team-markdown | — | — |
| Agents | Modèle, effort de raisonnement, modèles de secours par agent | FAIT | `bot.model`, `fallbackModels` (`agent/reliability.ts:18`) | Effort de raisonnement : à vérifier | S |
| Agents | Masquer un agent (il continue à travailler) | PARTIEL | `bot.hidden` réservé aux assistants internes | Masquage choisi par l'utilisateur | S |
| Agents | Couleur exacte d'avatar et couleur des bulles par agent | PARTIEL | `CharacterEditor.tsx`, couleur du bot | Couleur des bulles | S |
| Agents | Dossiers dans la barre latérale (3 niveaux) | PARTIEL | sections / projets (`sectionroutes.ts`) | Un seul niveau | S |
| Agents | Modèles d'agent publiés par lien (sans fichiers ni mémoire, refus si un champ ressemble à un secret) | PARTIEL | modèles d'équipe (`teamtemplates`), export d'équipe (`agent/teamexport.ts`) ; test : team-templates | Pas de publication par lien ; vérifier le refus des secrets à l'export | M |
| Agents | Import d'agents depuis Grok Bot | FAIT | `grokimport.ts` ; test : grok-import, grok-import-hosted | — | — |
| Agents | Transfert d'une instance entière vers un autre serveur (.zip) | FAIT | `backuparchive.ts`, `projectimport.ts` ; test : backup-drill | — | — |
| Agents | Duplication d'un agent | FAIT | `DuplicateBotModal.tsx` | — | — |
| Agents | Fils secondaires (side threads) par agent, chacun avec sa file et son résultat | FAIT | fils (`thread`) dans `agent/loop.ts`, `ThreadPanel.tsx` | — | — |
| Agents | Supprimer un message de la conversation (le sien seulement) | MANQUANT | — | — | S |
| Agents | Épingler un message | MANQUANT | — | — | S |
| Agents | Agent supprimé : nettoyage (files, attentes, routines) | FAIT | `agent/retire.ts` | — | — |

### Conversation, file et contrôle du travail

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| File | File FIFO par agent, persistée, qui survit à un crash | FAIT | file sur disque (`agent/loop.ts` `enqueue`), reprise (`recoverInterruptedTurns`) ; test : engine-queue | — | — |
| File | Pause / reprise / annulation d'un message en file | PARTIEL | pause du bot (`agent/pause.ts`) ; test : pause | Pas d'annulation d'un message précis, pas de file visible | M |
| File | Guidage (steer) : un message ajouté au travail en cours, avec la consigne « ça s'ajoute, ça n'annule pas ; réponds d'abord à la question puis continue » | PARTIEL | messages fondus dans le tour (`agent/loop.ts:372`, `drainSteering`) | Pas de consigne qui dit au modèle comment traiter l'ajout | S |
| File | Question à côté (« /btw ») qui répond sans toucher la tâche en cours | MANQUANT | — | Voir écarts | M |
| Contrôle | **Contrôle de fin indépendant** : un modèle relit demande + étapes + réponse et dit fait / continuer / besoin de la personne / bloqué ; relance automatique jusqu'à 3 fois | MANQUANT | `agent/loop.ts:1073-1090` : relance seulement un tour muet | Voir écarts | M |
| Contrôle | Le bot finit par « je continue ? » / « je passe à la suite ? » → relancé automatiquement (2 fois max) | MANQUANT | — | Voir écarts | S |
| Contrôle | « Arrête » dit en n'importe quels mots : tout arrêter, y compris les coéquipiers qui ont une part | PARTIEL | bouton Stop, `agent/pause.ts` | Pas d'arrêt en cascade des coéquipiers sur un mot | S |
| Contrôle | Plan natif tenu à jour pour 3 étapes ou plus, sans le répéter en prose | FAIT | `task_add` / `task_update` (`agent/prompt.ts:163`) | — | — |
| Contrôle | Travail en arrière-plan fini pendant que l'utilisateur était parti : « donne le résultat et continue » | FAIT | tâches de fond (`agent/bgtasks.ts`), messages des assistants livrés au parent | — | — |
| Chat | Pièces jointes de tout type (100 Mo par fichier, 250 Mo par message, 10 fichiers) | PARTIEL | `uploads.ts`, `uploadlimits.ts` ; test : large-attachments | Limites et types à comparer | S |
| Chat | Fichiers renvoyés par l'agent (zip, etc.) | FAIT | `file_send` (`agent/tools.ts:356`) | — | — |
| Chat | SVG montré comme image mais donné à l'agent comme texte | NON VÉRIFIÉ | — | — | — |
| Chat | Réactions entre agents et sur les messages | FAIT | `message_react` (`agent/tools.ts:511`) | — | — |
| Chat | 15 langues dont arabe et hébreu (droite à gauche) | PARTIEL | français et anglais (`web/src/i18n`) | Autres langues | L |
| Chat | Thèmes en fichiers JSON suivis à chaud | NON REPRIS | — | Gadget bureau Linux | — |

### Fiabilité, contexte, limites d'abonnement

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Contexte | Suivi du contexte par agent et compactage automatique à 80 % | FAIT | `agent/context.ts:13` (80 %), entre tours `agent/memory.ts` | — | — |
| Contexte | Compactage **inefficace** détecté (2 fois de suite sans gagner assez) et arrêt des boucles de compactage ; délai de 120 s | PARTIEL | `agent/context.ts` | Pas de détection « compactage inutile » ni de délai | S |
| Contexte | Recherche dans l'historique (y compris ce qui a été perdu au compactage) avant la mémoire | FAIT | `conversation_search` (`agent/tools.ts:743`), `agent/prompt.ts:161` | — | — |
| Limites | Limite d'usage de l'abonnement : mise en attente, relecture toutes les 15 min, reprise à la réinitialisation | FAIT | `agent/sublimit.ts`, `holdForLimit` (`agent/loop.ts:57`) ; test : sublimit | — | — |
| Limites | **Réserve de plusieurs comptes** d'un même fournisseur : on prend le compte dont la fenêtre se réinitialise le plus tôt | MANQUANT | — | Voir « À faire » | M |
| Limites | Lecture de l'usage restant par fournisseur (Codex, Cursor, Kimi, Antigravity…) | PARTIEL | `sublimitview.ts`, `SubLimit.tsx` | Claude/Codex seulement | M |
| Limites | Panne fournisseur : attente 10 min ; identifiant refusé : attente jusqu'à 1 h | PARTIEL | disjoncteur par fournisseur (`agent/failures.ts`) ; test : failures | Durées différentes ; équivalent | — |
| Routines | Démarrage de routine raté : nouvel essai à 5, 15, 30 min | MANQUANT | `scheduler.ts:250-266` : échec compté, pas de nouvel essai | Voir écarts | S |
| Fiabilité | Reprise au démarrage (boot recovery) des tours et livraisons | FAIT | `recoverInterruptedTurns`, `index.ts:100-101` ; test : engine-queue, pause | — | — |
| Fiabilité | Idempotence des appels d'outils | PARTIEL | `agent/executions.ts` (actions à usage unique) ; test : wave5 | Pas de dédoublonnage d'un même changement dans un tour (voir audit CopilotKit) | S |
| Fiabilité | Arguments réparés : formes fautives fréquentes d'un modèle réécrites avant décodage (chaque refus coûte un tour) | MANQUANT | — | Voir écarts | S |
| Fiabilité | Arguments convertis au type du schéma | MANQUANT | — | — | S |
| Fiabilité | Diagnostics exportables sans données privées | PARTIEL | `health.ts`, `Incidents.tsx` | Export « diagnostics » d'un clic | S |
| Fiabilité | Page de statut publique + webhooks de statut | NON REPRIS | — | Service hébergé de l'éditeur | — |

### Mémoire et compétences

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Mémoire | Mémoires = préférences durables, suivies comme des consignes **sauf si la demande du jour dit autre chose** | PARTIEL | « What you remember » (`agent/prompt.ts:224`) | Règle de priorité absente | S |
| Mémoire | Mémoire liée à un site (note sur la façon d'utiliser ce site) | MANQUANT | — | Idée simple : mémoire par domaine, montrée quand le bot y va | S |
| Mémoire | **Revue de mémoire** périodique (tous les 20 tours, ou après 15 min de calme et 3 tours) sur les 200 derniers messages | PARTIEL | extraction après 10 min de calme (`agent/memory.ts:137`), consolidation (`config.ts:173`) | Pas de déclencheur « tous les N tours » pour les longues conversations sans pause | S |
| Mémoire | Mémoire coupée par l'utilisateur : le bot est prévenu que les anciennes notes ne valent plus | PARTIEL | rappel coupable (`agent/recall.ts:224`) | Message explicite au bot | S |
| Mémoire | Mémoire par espace de messagerie (un workspace Slack, un serveur Discord) | MANQUANT | — | Lié aux canaux | M |
| Mémoire | Contenu non fiable jamais enregistré en mémoire | FAIT | seulement ce que l'utilisateur a tapé (`agent/memory.ts:145`) ; test : memory-guard | — | — |
| Compétences | Bibliothèque locale de compétences partagée ; un agent crée une compétence depuis un travail réutilisable | FAIT | `skill_save`, `skill_propose` (`agent/tools.ts:761-785`), `skillslibrary.ts` ; test : skills-library | — | — |
| Compétences | Suggestion de compétence relue à partir des étapes réelles d'un travail | FAIT | `skill_propose` (anonymisé, relu) | — | — |
| Compétences | Révision d'une compétence apprise qui ne doit pas perdre plus d'un quart de son contenu | MANQUANT | — | Garde-fou contre une réécriture qui efface | S |
| Compétences | Place de marché (Agents, Compétences, Apps) avec versions approuvées | PARTIEL | bibliothèque (`skillslibrary.ts`), `skillsgithub.ts`, catalogue d'apps | Pas de place de marché publique avec publication | L |
| Compétences | « Essayer la compétence » : ajoute un exemple de demande au brouillon | MANQUANT | — | Champ `example` dans une compétence | S |
| Compétences | Scan de sécurité d'une compétence | FAIT | `skillscan.ts` ; test : skill-scan | — | — |

### Routines et automatisation

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Routines | Routine planifiée par agent | FAIT | `routine_create` (`agent/tools.ts:898`), `scheduler.ts` ; test : wave3 | — | — |
| Routines | Routine relue juste avant de partir (pause, suppression, horaire déplacé pris en compte) | FAIT | créneau réservé atomiquement (`routines.ts:177`) | — | — |
| Routines | Passage « rien de neuf » sans déranger (`routine_no_update`) | FAIT | `stay_quiet` (`agent/tools.ts:1279`), saut si entrées inchangées (`scheduler.ts:133`) | — | — |
| Routines | Outil pour déclarer l'échec d'une routine avec une raison courte | PARTIEL | statut « error » via fin de tour (`scheduler.ts:250`) | Le bot ne peut pas dire lui-même « échec : raison » si le tour finit normalement | S |
| Routines | Routine dans le chat de l'agent **ou** dans son propre fil | MANQUANT | `scheduler.ts:48` : toujours le chat principal | Voir écarts | M |
| Routines | Flux iCalendar des routines pour son agenda | MANQUANT | — | Petit plus utile | S |
| Routines | Chaînes de routines (la réponse d'une routine passe à d'autres agents) | PARTIEL | `bot_message` dans une routine | Pas de chaîne déclarée | M |
| Routines | Workflows en graphe (étapes, agents, conditions, approbations, sorties) sur un canevas | MANQUANT | — | Gros chantier ; utile pour les pros | L |
| Routines | Routine de canal (salon) | PARTIEL | salons (`agent/roomrouting.ts`) | Routine qui poste dans un salon | S |
| Webhooks | Routine déclenchée par webhook | FAIT | `routes.ts:400` (`/api/hooks/:token`), limites (`hardening.ts:132`) | — | — |
| Webhooks | Signature HMAC + horodatage, **ID de livraison** pour dédoublonner (7 jours), filtres sur le contenu, « envoyer un événement de test », format Standard Webhooks | PARTIEL | jeton dans l'URL seulement, pas de signature ni de dédoublonnage | Voir « À faire » | M |
| Webhooks | Historique des requêtes ignorées avec la raison | MANQUANT | — | — | S |
| Automatisation | API locale pour scripts (envoyer un message, lancer une routine, répondre aux questions et approbations) | FAIT | API des bots (`botapi.ts`, `docs/API-BOT.md`), serveur MCP de contrôle ; test : bot-api | — | — |
| Automatisation | Réponse à une approbation par l'API | PARTIEL | `botapi.ts` | À vérifier : approbation par API possible ? (Sklubot exige le propriétaire) | S |

### Plusieurs agents, salons, équipe

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Agents entre eux | Messages, réponses, réactions, images et fichiers entre agents | FAIT | `bot_message` (`agent/tools.ts:1085`), dossier `~/team` partagé (`agent/prompt.ts:113`) ; test : team-disk | — | — |
| Agents entre eux | Règle : un coéquipier ne voit pas ton chat : écris un message autonome (but, contexte, ce qui a été essayé, ce que l'utilisateur a approuvé) | MANQUANT | — | Une phrase de prompt | S |
| Agents entre eux | « Tu es responsable de ce que tu délègues » : finir soi-même la part manquante, marquer non vérifié ce qu'on relaie | MANQUANT | — | Idem | S |
| Agents entre eux | Choisir un coéquipier par son titre et sa description, d'abord dans la même section | PARTIEL | liste de l'équipe avec rôles (`agent/prompt.ts:199`), recruteur | Priorité « même section » | S |
| Agents entre eux | Échanges entre coéquipiers internes par défaut, sans narration ; pas de boucle d'accusés de réception | PARTIEL | `MAX_HOPS = 3` (`agent/team.ts:8`) | Consigne « pas d'accusé de réception » | S |
| Salons | Salon partagé : un objet, des agents, un **responsable** de la tâche, délégation explicite, Stop / Reprendre / Réassigner / Archiver / Restaurer | PARTIEL | salons multi-bots (`agent/roomrouting.ts`, `tools-room.ts`) ; test : room-routing | Pas de « responsable » ni de Réassigner | M |
| Salons | Paquet de contexte du salon borné (120 000 caractères) | FAIT | budget de salon (`agent/roombudget.ts`) ; test : roombudget | — | — |
| Salons | En groupe : parler quand on est adressé ou utile, ne pas répéter les autres | FAIT | routage + `stay_quiet` | — | — |
| Équipe | Publier son ordinateur comme serveur d'équipe (WebRTC, relais TURN), membres invités, rôles | DIFFÉRENT | serveur web multi-comptes (`hosted.ts`), espaces partagés (`workspaces.ts`) | — | — |
| Équipe | CRM expérimental (prospects, clients, paiements) | NON REPRIS | — | Hors cœur | — |
| Équipe | Sites hébergés publiés par un agent | FAIT | pages publiées (`hostedpages.ts`, `pageroutes.ts`) ; test : pages-artifacts | — | — |

### Navigateur et ordinateur

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Navigateur | Navigateur intégré persistant que l'agent ouvre, lit et pilote | FAIT | navigateur de l'ordinateur du bot, `browser_open`, `page_read`, éléments (`agent/elements.ts`) ; test : elements | — | — |
| Navigateur | **Plusieurs actions en un seul appel** (script qui enchaîne naviguer, cliquer, taper, puis un seul instantané final) | MANQUANT | une action par appel | Voir écarts | M |
| Navigateur | Remplir jusqu'à 16 champs texte d'un coup depuis un instantané frais, sans valider | MANQUANT | `element_type` un champ à la fois | Voir écarts | S |
| Navigateur | Boîtes `alert` / `confirm` ouvertes par une action de l'agent envoyées à l'agent ; les autres restent pour la personne | NON VÉRIFIÉ | — | À vérifier : que fait le bot face à une boîte native ? | S |
| Navigateur | Onglets qui survivent au tour ; l'agent ferme lui-même | FAIT | navigateur persistant | — | — |
| Navigateur | Profils de navigateur : partagé ou nommé, réutilisable entre agents | DIFFÉRENT | un navigateur par ordinateur de bot (sessions gardées) | Pas de profil partagé entre bots (choix de sécurité) | — |
| Navigateur | Saisie sécurisée d'un secret dans la page (le secret ne passe jamais par le modèle) | PARTIEL | `vault_type`, `totp_code`, `secret_request` | Pas de « tape cette valeur dans ce champ » pour un code reçu par SMS | M |
| Navigateur | Coffre : identifiants, cartes, **coordonnées** (adresse) ; utiliser l'élément qui colle, demander si plusieurs | PARTIEL | coffre (`VaultSection.tsx`), `card_fill` (`agent/prompt.ts:145`) | Pas de fiche « coordonnées » pour les formulaires d'adresse | S |
| Navigateur | Paiement par Stripe Link (approuvé dans Link) | NON REPRIS | — | Dépend d'un service tiers | — |
| Navigateur | Prévenir : adresse de centre de données → certains sites (X) refusent la connexion ; reconnaître ces messages | PARTIEL | consignes YouTube (`agent/prompt.ts:63`) | Consigne générale sur les refus de connexion depuis un serveur | S |
| Navigateur | Journal de navigation de l'utilisateur | NON REPRIS | vie privée | — | — |
| Ordinateur | Computer Use sur l'ordinateur de l'utilisateur (macOS, Windows, Linux) | FAIT | Sklubot Relais (`agent/mycomputer.ts`, `relay.ts`) ; test : relay | — | — |
| Ordinateur | Bureau à distance (Sunshine / Moonlight) vers l'ordinateur hôte, depuis le téléphone aussi | DIFFÉRENT | écran en direct de l'ordinateur du bot (`vnc.ts`, `LiveScreen.tsx`) | — | — |
| Ordinateur | Contrôles d'hôte : qui peut ouvrir une session, la personne devant l'écran doit accepter | FAIT | Relais : accord sur l'ordinateur (`agent/mycomputer.ts:12`) | — | — |
| Ordinateur | Agents en accès complet, sans approbation par action | NON REPRIS | Sklubot garde ses cartes (`agent/authorize.ts`) | Suppression de sécurité : à ne pas reprendre | — |
| Ordinateur | Bac à sable de l'espace de travail pour Claude (dossiers autorisés seulement) | DIFFÉRENT | conteneur par bot (`linux.ts`) | Sklubot isole mieux | — |

### Canaux, notifications, mobile

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Canaux | Slack (une app commune, un agent « orchestrateur » choisit le bon agent) | MANQUANT | Slack seulement comme app d'outils (`catalog.ts:141`) | Canal Slack | L |
| Canaux | Discord | MANQUANT | — | Canal Discord | L |
| Canaux | Telegram (groupes, fils de réponse, forums) | PARTIEL | `telegram.ts` (canal par bot) | À vérifier : groupes et sujets de forum | M |
| Canaux | WhatsApp par client non officiel | NON REPRIS | `telegram.ts:21` (refus documenté) | Risque de blocage du numéro, conditions de WhatsApp | — |
| Canaux | Réactions d'état sur le message : 👀 reçu, ✅ fini, ❌ échec, 🫡 arrêté ; « Je m'en occupe… » remplacé par la réponse | PARTIEL | Telegram : à vérifier | Accusés par réaction | S |
| Canaux | Un agent poste de lui-même dans un lieu connecté (« poste le résumé dans #annonces ») | MANQUANT | — | Lié aux canaux | M |
| Notifications | Notifications quand un tour finit, échoue, ne démarre pas, ou attend (question, approbation, étape navigateur) | FAIT | `push.ts:94` (types needs, reply, routine, computer…) | « Ne démarre pas » à vérifier | — |
| Notifications | Notifications sur le téléphone seulement après 30 s sans activité sur l'ordinateur | MANQUANT | — | Éviter le double bruit | S |
| Mobile | App iPhone avec Live Activity (île dynamique) | MANQUANT | `mobile/` (Expo) | Live Activity | M |
| Mobile | App Android avec FCM | PARTIEL | `mobile/`, `android/` | Push natif à vérifier | M |
| Mobile | Connexion du téléphone par QR | PARTIEL | à vérifier dans `mobile/` | — | S |
| Mobile | File de messages visible sur mobile | MANQUANT | — | Lié à la file visible | S |

### Voix

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Voix | Voix en direct : modèle temps réel qui pose ses questions à l'agent (`ask_agent`), relaie mot à mot les réponses courtes, résume les longues (150 mots) | DIFFÉRENT | pipeline maison qui fait parler le bot lui-même (`voice/session.ts`) ; test : wave6-voice | Idée : règle « réponse courte relayée telle quelle, longue résumée » (S) | S |
| Voix | Délai de réponse de l'agent pendant l'appel (20 s) | PARTIEL | `voice/session.ts` | À vérifier : ce que l'appelant entend pendant l'attente | S |

### Comptes, sécurité, hébergement

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Comptes | Comptes par code à usage unique par e-mail | FAIT | lien de connexion (`sign-in-link.ts`, `emaillink.ts`) ; test : email-link | — | — |
| Comptes | Sortie du téléphone : jeton gardé pour révoquer plus tard si le serveur est injoignable | MANQUANT | — | Petit détail de sécurité | S |
| Sécurité | Bac à sable Electron gardé (profil AppArmor fourni, jamais `--no-sandbox`) | NON REPRIS | Sklubot n'est pas une app Electron côté serveur | — | — |
| Sécurité | Clés de fournisseurs jamais écrites ni journalisées ; on réutilise la connexion CLI sans copier les identifiants | FAIT | engines via abonnement (`subscriptionconnect.ts`), secrets chiffrés (`datakey.ts`) ; test : data-key | — | — |
| Sécurité | Secrets des webhooks chiffrés par le stockage du système | DIFFÉRENT | jeton de hook en base | — | — |
| Hébergement | Serveur Linux sans écran (script d'installation, systemd) | FAIT | `deploy/`, `docs/INSTALLATION-VPS.md` | — | — |
| Hébergement | Image Docker avec profil seccomp | FAIT | `Dockerfile.production`, `docker-compose.*` | Profil seccomp à vérifier | S |
| Hébergement | Nix, Umbrel, AWS ECS | NON REPRIS | — | Non prioritaire | — |
| Hébergement | Hébergement multi-locataires | FAIT | mode hébergé (`hosted.ts`) ; test : hosted, isolation-hosted | — | — |
| Hébergement | Mises à jour des CLI de fournisseur vérifiées chaque heure | PARTIEL | image du bureau | Vérification périodique des versions | S |
| Analyse | Statistiques produit (OpenPanel) | NON REPRIS | choix de confidentialité | — | — |

### Prompt (thèmes des consignes, décrits avec nos mots)

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Prompt | Réponse la plus courte et complète d'abord ; pas de phrase d'ouverture, d'excuses ni de récapitulatif | PARTIEL | `agent/prompt.ts:180` | Interdiction des récapitulatifs | S |
| Prompt | Avant d'utiliser un outil, une ligne simple : ce qu'on a compris et ce qu'on vérifie d'abord | MANQUANT | — | Une ligne qui rassure l'utilisateur au début | S |
| Prompt | Écrire dans la langue des messages de l'utilisateur, pas celle des règles ni des résultats d'outils | FAIT | `agent/prompt.ts:184` | — | — |
| Prompt | Ne jamais inventer faits, chiffres, citations, sources, menus d'app ; étiqueter les données d'exemple | PARTIEL | `agent/prompt.ts:182` | « Étiqueter les exemples », « menus d'app » | S |
| Prompt | Finir toute la demande avant de terminer le tour, sauf attente / besoin de la personne / blocage | PARTIEL | rapport final (`agent/prompt.ts:165`) | Phrase explicite « finis tout » | S |
| Prompt | Rôle = mission ; une demande précise passe avant ; déléguer plutôt que refuser hors rôle | PARTIEL | recruteur (`agent/prompt.ts:77`) | « Ne refuse pas seulement parce que c'est hors de ton rôle » | S |
| Prompt | Un message à une autre personne part au nom de l'utilisateur et ne se reprend pas : brouillon sur une carte de confirmation | FAIT | `user_quote` + cartes (`agent/prompt.ts:157`) | — | — |
| Prompt | Utiliser d'abord l'outil MCP du service avant le navigateur | FAIT | `agent/prompt.ts:149` « Prefer them over driving a website by hand » | — | — |
| Prompt | Recherche d'outils : chercher par courte phrase de capacité, décrire, puis appeler | PARTIEL | `engine.ts:361` (moteurs) | Côté API (voir audit CopilotKit) | M |
| Prompt | Fil secondaire : d'autres fils peuvent changer les mêmes fichiers, relire juste avant d'écrire, ne pas changer de branche git | MANQUANT | — | Utile pour les bots codeurs | S |
| Prompt | Dans une routine : utiliser l'identifiant enregistré ; signaler une connexion requise au lieu de demander une prise en main | PARTIEL | `vault_list` d'abord (`agent/prompt.ts:133`) | « Dans une routine, pas de prise en main : signale » | S |

## Écarts de comportement, flux par flux

### 1. Premier message à un bot

- **nightly.** Un nouvel agent commence par un tour d'accueil qu'il lance lui-même : il pose une question avec trois premiers choix, dans la langue de l'app (`agent-welcome`). Le prompt commence par « réponse la plus courte et complète d'abord, pas de remplissage » et demande une ligne simple avant le premier outil (« ce que j'ai compris, ce que je vérifie d'abord »).
- **Sklubot.** Le bot attend le premier message. Le prompt (`agent/prompt.ts:83-250`) est long et très orienté outils ; la garde « premier mot » prévient après 20 s de silence (`agent/watch.ts`).
- **Différences.** (a) Un nouveau bot Sklubot ne se présente pas : l'utilisateur ne sait pas quoi lui demander. (b) Pas de ligne d'intention avant le travail : l'utilisateur voit des étapes sans phrase.
- **Corrections.** Tour d'accueil d'un bot neuf : une question courte avec 3 choix (avec `ask_user`) (S). Une consigne « avant ton premier outil, une ligne : ce que tu as compris et ce que tu regardes d'abord » (S).

### 2. Un bot qui utilise son ordinateur sur un lien

- **nightly.** Navigateur intégré dans l'app (Electron). L'agent peut enchaîner plusieurs actions dans **un seul appel** (un petit script qui appelle naviguer, cliquer, taper, puis rend un seul instantané), et remplir jusqu'à 16 champs d'un coup. Les formes d'arguments fautives qu'un modèle écrit souvent sont réparées avant décodage, parce que chaque refus coûte un tour complet (~27 000 jetons d'entrée d'après leur doc).
- **Sklubot.** Le bot ouvre le lien sur son écran sous les yeux de l'utilisateur (`agent/prompt.ts:57`), une action par appel, avec références d'éléments.
- **Où nightly est plus économe.** Un formulaire de 10 champs coûte 10 tours chez Sklubot. Un argument mal formé coûte un tour.
- **Corrections.** Outil `element_fill` : plusieurs champs d'un coup depuis le même instantané, sans valider (S). Réparation des formes d'arguments courantes (nombre écrit en texte, objet envoyé en chaîne JSON) avant de refuser (S). Plus tard : enchaînement de plusieurs actions en un appel (M).

### 3. Tâche longue qui échoue au milieu puis reprend

- **nightly.** Après chaque tour, un **contrôle de fin** séparé (un petit modèle, 30 s maximum) reçoit la demande, le contexte récent, les étapes (outil + extrait de résultat ou échec), le plan et la dernière réponse, et rend un verdict : fini / continuer (avec au plus 3 consignes de ce qui manque) / besoin de la personne / bloqué. « Continuer » relance l'agent, 3 fois maximum. Règles du juge : ne pas exiger plus que demandé, pas de relance pour du peaufinage ou une action risquée, en cas de doute « fini ». En plus, un agent qui finit par « je continue ? » est relancé (2 fois max). Les routines qui ne démarrent pas sont réessayées à 5, 15 et 30 min.
- **Sklubot.** Relance d'un tour muet seulement, passe « rapport final » (`agent/loop.ts:1073-1090`), coordinateur d'échecs (`agent/failures.ts`). Un tour qui fait 3 éléments sur 10 et s'arrête en disant « voilà les 3 premiers » est considéré comme réussi.
- **Corrections.** Contrôle de fin en option (petit modèle bon marché, verdict JSON, 3 relances max, jamais pour une action risquée), d'abord pour les tâches de fond et les routines (M). Relance automatique quand le bot demande « je continue ? » alors que la demande était claire (S). Nouvel essai d'une routine qui n'a pas pu démarrer (S).

### 4. Approbations

- **nightly.** Pas d'approbation par action : les agents tournent en accès complet après un accord au premier lancement. Seuls restent : brouillon de message à une personne sur une carte de confirmation, modifications hors dossiers autorisés qui demandent, paiement approuvé dans Stripe Link.
- **Sklubot.** Beaucoup plus sûr : plancher non négociable, citation des mots de l'utilisateur, empreinte d'action à usage unique, contenu extérieur qui durcit (`agent/authorize.ts`). Testé.
- **Différence.** Rien à reprendre ici, au contraire : ne pas affaiblir Sklubot.

### 5. Mémoire apprise puis rappelée

- **nightly.** Revue de mémoire tous les 20 tours, ou après 15 min de calme si au moins 3 tours, sur les 200 derniers messages. Mémoires présentées comme des préférences durables « sauf si la demande du jour ou les instructions disent autre chose ». Mémoire liée à un site. Le contenu non fiable n'est jamais mémorisé. Si l'utilisateur coupe la mémoire, le bot reçoit un message « les notes d'avant ne comptent plus ».
- **Sklubot.** Extraction après 10 min de calme (`agent/memory.ts:137`), preuve par extrait, filtre du contenu non fiable (testé : memory-guard). Pas de déclencheur par nombre de tours.
- **Différences.** (a) Une longue session sans pause de 10 min n'apprend rien jusqu'à la fin. (b) Pas de règle de priorité. (c) Pas de mémoire « comment utiliser ce site ».
- **Corrections.** Déclencheur supplémentaire : tous les 20 tours de l'utilisateur (S). Phrase de priorité (S). Notes liées à un domaine, montrées quand le bot ouvre ce site (S).

### 6. Une routine qui se déclenche

- **nightly.** La routine tourne dans le chat de l'agent **ou** dans son propre fil (réglage). Un passage « rien de neuf » se déclare par un outil dédié ; un échec se déclare par un outil avec une raison courte, même si le tour finit normalement. Webhooks : signature, horodatage, ID de livraison pour ne jamais lancer deux fois le même événement (reçus gardés 7 jours), filtres sur le contenu, événement de test, historique des requêtes ignorées. Flux iCalendar.
- **Sklubot.** Toujours dans le chat principal (`scheduler.ts:48`) ; « rien de neuf » par `stay_quiet` ou empreinte des entrées ; échecs comptés, pause après N, avis à chaque échec. Webhook par jeton secret dans l'URL, avec limites de débit (`routes.ts:400`) ; pas de signature, pas de dédoublonnage : un expéditeur qui réessaie (GitHub, Stripe le font) lance deux tours.
- **Corrections.** Dédoublonnage par en-tête d'ID de livraison (ou empreinte du corps sur 24 h) (S). Signature HMAC optionnelle + format Standard Webhooks (M). Outil « échec de routine : raison » (S). Option « exécuter dans un fil » (M). Flux iCal (S).

### 7. Conversation de groupe avec plusieurs bots

- **nightly.** Salon avec un **responsable** de la tâche, délégation explicite, boutons Réassigner / Archiver / Restaurer. Consignes : un coéquipier ne voit pas ton chat, donc message autonome (but, demande complète, contexte, ce qui a été essayé, ce qui a été approuvé) ; tu restes responsable de ce que tu délègues ; pas d'accusés de réception en boucle.
- **Sklubot.** Mention puis routage (`agent/roomrouting.ts`), 3 rebonds, budget, `stay_quiet`. Testé.
- **Différence.** Le routage de Sklubot est plus automatique ; ce qui manque est la **qualité du message de délégation**. Aujourd'hui `bot_message` peut envoyer « fais ça » sans contexte.
- **Corrections.** Deux phrases dans le prompt : message de délégation autonome, et responsabilité de ce qu'on délègue (S). Option « responsable » dans un salon (M) — ✅ fait le 2026-11-23 (L155 : Responsable, Réassigner, Archiver, Restaurer).

### 8. Appel vocal

- **nightly.** Modèle vocal temps réel qui pose la question à l'agent ; réponse courte relayée mot à mot, longue résumée en 150 mots environ ; délai de 20 s.
- **Sklubot.** Le bot lui-même parle (`voice/session.ts`), testé.
- **Correction.** Règle de lecture : une réponse longue (liste, tableau) est résumée à l'oral et donnée en entier dans le chat (S).

### 9. Livraison d'un fichier ou d'une page

- **nightly.** L'agent joint ses fichiers à la réponse avant la réponse finale (sauf une image déjà montrée) ; liens en chemin absolu.
- **Sklubot.** `file_send`, `file_save`, artefacts, pages. Au niveau.

### 10. Accueil d'un nouvel utilisateur

- **nightly.** L'app télécharge elle-même le CLI du fournisseur choisi (« Télécharger »), vérifie la connexion sans lancer de tour (« doctor »), puis crée un agent qui se présente.
- **Sklubot.** Accueil en étapes (`web/src/components/Onboarding.tsx`), connexion d'abonnement (`subscriptionconnect.ts`). Pas d'appel d'essai (déjà noté).
- **Correction.** Appel d'essai du cerveau en fin d'accueil (S), puis premier tour d'accueil du bot (S).

### 11. Erreur de moteur ou de fournisseur

- **nightly.** Réserve de comptes : quand un compte d'abonnement atteint sa limite, on prend celui dont la fenêtre se réinitialise le plus tôt ; attente de 10 min sur panne, jusqu'à 1 h sur identifiant refusé ; usage relu toutes les 15 min.
- **Sklubot.** Limite d'abonnement gérée avec heure de retour (`agent/sublimit.ts`, testé), modèles de secours, disjoncteur. Un seul compte par moteur.
- **Correction.** Plusieurs comptes Claude/Codex par utilisateur, bascule vers le prochain disponible (M). (À vérifier avec les conditions des abonnements.)

### 12. Redémarrage en plein travail

- **nightly.** Récupération au démarrage (`boot-recovery.ts`, 565 lignes) : livraisons reprises, routines gardent leur passage.
- **Sklubot.** `recoverInterruptedTurns`, actions incertaines jamais rejouées. Au niveau, testé.

### 13. Message tapé pendant le travail

- **nightly.** Trois choses distinctes : (a) mettre en file (visible, annulable, pause / reprise) ; (b) guider le travail en cours, avec une consigne au modèle : « ceci s'ajoute, n'annule pas ; s'il y a une question, réponds-y d'abord en une ligne ; s'il y a une correction, applique-la à partir de maintenant ; puis continue » ; (c) **question à côté** : réponse rapide à partir du chat (60 derniers messages), sans toucher la tâche.
- **Sklubot.** Tout est fondu dans le tour en cours, sans consigne (`agent/loop.ts:372`). Défaut déjà relevé : un message fondu dans un tour de routine hérite de ses droits.
- **Corrections.** Ajouter la consigne d'ajout au texte fondu (S). Question à côté (« /btw » ou bouton) qui répond sans entrer dans le tour (M). File visible (M).

### 14. Arrêt demandé en mots

- **nightly.** « Arrête » ou « annule », en n'importe quels mots : arrêt immédiat, interruption des coéquipiers qui ont une part, fermeture des attentes, pas de reprise.
- **Sklubot.** Bouton Stop ; un « stop » tapé est fondu dans le tour et dépend du modèle.
- **Correction.** Détecter un message court d'arrêt (FR/EN) pendant un tour et l'appliquer comme le bouton, y compris aux assistants et aux `bot_message` en attente (S).

## À faire, du plus utile au moins utile

1. **Contrôle de fin indépendant** (fini / continuer / besoin de toi / bloqué, 3 relances max, jamais pour une action risquée), d'abord pour les tâches de fond et les routines (M).
2. **Consigne sur les messages fondus dans le tour** (ça s'ajoute, réponds d'abord à la question, puis continue) (S).
3. **« Stop » tapé = bouton Stop**, en cascade sur les assistants et coéquipiers (S).
4. **Relance quand le bot demande « je continue ? »** sur une demande claire (S).
5. **Webhooks : dédoublonnage par ID de livraison**, puis signature HMAC et format Standard Webhooks, événement de test, historique des refus (S puis M).
6. **Nouvel essai d'une routine qui n'a pas pu démarrer** (5, 15, 30 min) (S).
7. **Messages de délégation autonomes** et « tu restes responsable de ce que tu délègues » dans le prompt (S).
8. **Remplir plusieurs champs d'un coup** (`element_fill`) et **réparer les formes d'arguments** courantes avant de refuser (S).
9. ✅ FAIT pour les 20 tours (L67, `learningDue`) ; la règle « la demande du jour passe avant » reste — **Revue de mémoire tous les 20 tours** en plus du calme de 10 min ; règle « la demande du jour passe avant la mémoire » (S).
10. **Question à côté** qui ne touche pas la tâche (M).
11. **Tour d'accueil d'un bot neuf** (une question, 3 choix) et **ligne d'intention** avant le premier outil (S).
12. **Outil « échec de routine : raison »** et option **routine dans un fil** (S / M).
13. **Réserve de plusieurs comptes d'abonnement** avec bascule (M) — à vérifier contre les conditions des fournisseurs.
14. **Détection d'un compactage inutile** et délai de 120 s sur le compactage (S).
15. **Mémoire liée à un site** (S).
16. **Fiche « coordonnées » dans le coffre** pour les formulaires d'adresse (S). — **FAIT (2026-11-23)**
17. **Flux iCalendar des routines** (S).
18. **Notifications téléphone seulement après 30 s d'inactivité sur l'ordinateur** (S).
19. **Supprimer / épingler un message** ; **dossiers à plusieurs niveaux** (S).
20. **Garde-fou de révision des compétences apprises** (pas plus d'un quart de contenu perdu) (S).
21. **Canaux Slack et Discord** par app commune et orchestrateur (L).
22. **Plusieurs actions de navigateur en un appel** (M).
23. **Workflows en graphe** (L).
24. **Live Activity iPhone** (M).

## Non vérifié

- Le code du dépôt est sous licence non commerciale : je n'ai lu que des noms, des constantes et quelques fonctions pour comprendre les mécanismes, sans rien recopier. Les chiffres (3 relances, 30 s, 5/15/30 min, 20 tours, 120 000 caractères) viennent de constantes lues et de la doc.
- Côté Sklubot : comportement face à une boîte `alert`/`confirm` native, groupes et forums Telegram, push natif mobile, profil seccomp de l'image, approbation possible par l'API des bots, effort de raisonnement par bot, limites exactes des pièces jointes, rendu des SVG.
- Aucun test Sklubot lancé pour ce dépôt (le test `conversation-grant` a été lancé pour l'audit CopilotKit : 11/11).
