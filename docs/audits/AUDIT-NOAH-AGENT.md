# Audit complet : smfcoder17/noah-agent comparé à Sklubot

Date : 22/11/2026. Dépôt lu : `smfcoder17/noah-agent`, commit `136b840` du 21/11/2026 (copie superficielle, 946 fichiers, lue sans rien exécuter, puis supprimée).
Sklubot lu dans `/home/user/grok-sklubs` en lecture seule (arbre modifié en parallèle : numéros de ligne approximatifs).

## Licence : à lire avant tout

**PolyForm Noncommercial 1.0.0** (`LICENSE`, « Required Notice: Copyright 2026 SmfCoder »). Usage, modification et partage permis **seulement à des fins non commerciales**. Sklubot est commercial : **aucun code, aucun texte, aucune constante n'est repris**. Ce fichier décrit des idées de fonctionnement avec nos propres mots, à réécrire de zéro. Noah est construit sur **Hermes Agent (MIT)** que Sklubot a déjà audité (`AUDIT-HERMES.md`) : pour une idée qui vient d'Hermes, mieux vaut repartir d'Hermes (MIT) que de Noah. Le client WhatsApp n'est pas utilisé ici.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 45 |
| PARTIEL | 32 |
| MANQUANT | 15 |
| DIFFÉRENT | 1 |
| NON REPRIS | 1 |
| Non vérifié | 8 |
| **Total** | **102 lignes** |

Lecture rapide : Noah est **le projet le plus proche de Sklubot** de toute la liste : en français, un conteneur et un navigateur par agent, un juge qui ne lit pas les pages, un coffre où le serveur pose les identifiants dans la page, des appareils reliés, et une comparaison explicite avec Grok Bot. Sklubot est en avance sur beaucoup de points (approbations par citation, actions à usage unique, salons, studio vidéo, recherche). Les idées fortes de Noah à reprendre sont : le **reçu** sous chaque réponse (ce que le bot dit avoir fait comparé à ce que ses outils ont fait, dans les deux sens, sans modèle), le **tri des messages tapés pendant le travail** (réponse rapide « Noté », précision transmise, ou mis à la suite, gardé en base), les **questions qui montent d'un cran** (agent qui a confié → chef d'équipe → personne), les **veilles où un petit modèle trie les nouveautés avant de réveiller le gros**, le **mode Auto** (petit modèle pour une demande simple), l'**apprentissage déclenché par un mot de correction**, et les **mises à jour automatiques signées pendant un créneau calme avec retour arrière**.

## Ce qui a été lu côté Noah

- `README.fr.md`, `docs/comportements.md` (grille de 20 comportements comparés à Grok Bot, Dots, Muse…), liste de `docs/`.
- Les docstrings des 81 modules de `server/noah/` (recu, pendant, questions, juge, proactif, watch, decision, complexite, rapide, apprentissage, coffre, sites, handoff, coordination, rappels, precall, notifications, updates, sortie, appareils, courriel, double_verification, recuperation, relay, modes, media, taches, session, tours, access, profiles, presets, connecteurs, mcp, publication, accounts, chauffe, nettoyage…).

## Tableau complet des fonctions

Taille : S (moins d'un jour), M (quelques jours), L (une semaine ou plus). Chemins Sklubot depuis `server/src/` ; « test : x » = `server/test/x.test.ts`.

### Agents et conversation

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Agents | Plusieurs agents isolés, chacun sa machine, sa mémoire, ses fichiers, son navigateur | FAIT | `linux.ts`, réseau des bots sans contact entre eux (`linux.ts:155`) ; test : isolation | — | — |
| Agents | 9 modèles d'agent prêts (assistant, veille, recherche, contenu, achats, finances du foyer, voyages, coach, apps) ; un modèle ne donne aucun droit ni routine active | FAIT | modèles d'équipe (`teamtemplates`, `docs/MODELES-EQUIPE.md`), routines proposées en pause (recruteur `agent/prompt.ts:77`) ; test : team-templates | — | — |
| Agents | Nouvel agent : « Que doit faire X ? » et 4 demandes à toucher adaptées au rôle | PARTIEL | idées de premières tâches (`ideas.ts`) | Demandes à toucher propres à chaque nouveau bot | S |
| Agents | Nom, visage, première proposition au premier contact | PARTIEL | personnages animés (`Character.tsx`), accueil | Première proposition du bot | S |
| Agents | Profils sur un même serveur, partage d'un agent avec droit lecture / usage | FAIT | espaces partagés (`workspaces.ts`) ; test : wave6-workspaces | Droits lecture / usage à comparer | — |
| Agents | Supprimer un profil : la demande dit quoi faire des agents | NON VÉRIFIÉ | — | — | — |
| Chat | Conversations : créer, lister, archiver, réagir, supprimer, partager | PARTIEL | fils, réactions (`message_react`) | Archiver / supprimer / partager un fil | S |
| Chat | Réponses à toucher proposées sous une réponse (par le modèle rapide) | PARTIEL | `ask_user` avec 6 réponses (`agent/tools.ts:1206`) | Suggestions automatiques sans question | S |
| Chat | Nettoyage de ce qui s'affiche : marques internes, caractères invisibles, séquences ANSI retirés | NON VÉRIFIÉ | — | À vérifier : caractères invisibles et ANSI dans les réponses | S |
| Chat | Aperçu des liens | PARTIEL | `chat-sources` (test : chat-sources) | Aperçu riche d'un lien collé | S |
| Chat | Lire un .docx / .xlsx / .pptx / .odt sans conversion | FAIT | `office.ts`, `attachmentpreviews.ts` | — | — |
| Chat | **Barre de session** : ce que l'agent fait en ce moment (travaux, demandes à d'autres agents, tâches sur l'ordinateur, routines), relue toutes les 2 s | FAIT | centre de commandement (`command.ts`), état live (`bus.ts`), `WorkContext.tsx` | — | — |
| Chat | **« À toi »** : boîte unique des accords et propositions à trancher | PARTIEL | vue « besoin de toi » (push `needs`), `TodayView.tsx`, cartes dans les chats | Une seule boîte qui réunit toutes les cartes de tous les bots | M |
| Chat | Tâches = source de vérité de ce que l'écran montre ; titre écrit par le modèle rapide ; un redémarrage ferme les tâches coupées | FAIT | `task_add` / tâches de fond (`agent/bgtasks.ts`), reprise au démarrage | Titre auto des tâches | S |

### Travail en cours, questions, reçu

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Pendant | Message tapé pendant le travail : **tri** en réponse rapide, précision transmise, ou à la suite | PARTIEL | fondu dans le tour (`agent/loop.ts:372`) | Tri + accusé « Noté » | M |
| Pendant | Messages en attente écrits en base avant l'accusé, dédoublonnés par identifiant client, partent dans l'ordre | PARTIEL | file sur disque (`enqueue`) ; test : engine-queue | Dédoublonnage par identifiant client à vérifier | S |
| Pendant | Accusé immédiat (« Noté ») par le modèle rapide, sans outil | MANQUANT | — | Voir écarts | S |
| Questions | Une question d'un agent monte d'un cran : l'agent qui a confié la tâche, puis le chef d'équipe, puis la personne | MANQUANT | `ask_user` va toujours à la personne ; `bot_message` attend une réponse | Voir écarts | M |
| Questions | Sujets réservés (payer, supprimer pour toujours, secrets et droits, première publication) vont directement à la personne | FAIT | plancher (`agent/authorize.ts:25`) | — | — |
| Questions | Réponse d'un agent = « décision prise pour toi », corrigeable ; la correction devient une règle | MANQUANT | `rule_propose` existe (`agent/prompt.ts:146`) | Lien « corriger cette décision → règle » | M |
| Questions | Échange qui tourne en rond : on saute les agents | PARTIEL | `MAX_HOPS = 3` (`agent/team.ts:8`) | — | — |
| Reçu | **Reçu** sous chaque réponse : « dit et pas fait » (j'ai envoyé… sans outil d'envoi réussi) et « fait et pas dit » (un outil a envoyé, publié, supprimé, payé sans que la réponse en parle) ; sans modèle ; se tait en cas de doute | MANQUANT | règle de prompt seulement (`agent/prompt.ts:182`), journal (`journal.ts`) | Voir écarts | M |
| Handoff | Appel à la personne pour une étape à elle (connexion, 2FA, CAPTCHA) : bandeau avec l'écran, l'agent attend « C'est fait » / « Je ne peux pas » au lieu d'oublier | FAIT | `ask_takeover` (`agent/tools.ts:1221`), `takeover.ts` ; test : wave3 | Bouton « Je ne peux pas » à vérifier | — |
| Coordination | « Demande à Rita le compte rendu et rappelle-moi quand c'est fini » | FAIT | `bot_message` avec `wait` (`agent/tools.ts:1085`) ; push à la fin | — | — |
| Rappel | L'agent **fait sonner** l'appareil et donne un compte rendu oral (appel sur Android si autorisé) ; le compte rendu reste écrit | PARTIEL | appels vocaux (`voice/`), push | Appel sortant qui sonne | M |
| Rappel | Pré-contexte d'appel : un modèle rapide choisit ce qui servira, la voix répond tout de suite | MANQUANT | — | — | M |

### Juge, accords, sécurité

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Juge | Second modèle qui relit l'action **sans lire les pages ni le raisonnement** : seulement les messages de la personne, la consigne, l'appel | FAIT | relecteur (`agent/authorize.ts:237` `review` : règles, action, mots récents de l'utilisateur, citation, « a lu du contenu extérieur ? ») ; test : floor-autonomy | — | — |
| Juge | Tri de ce qui vient d'être lu (motif fort → signal sans demander au modèle) | PARTIEL | marquage `tainted` (`agent/loop.ts`) | Détection de motifs d'injection dans les résultats | S |
| Juge | Sans personne, aucun accord ne passe | FAIT | routines : cartes en attente, jamais d'accord implicite (`agent/authorize.ts`) | — | — |
| Accords | Trois modes d'autonomie : Prudent, Auto, Agir | FAIT | « careful » / normal / « auto » (`agent/authorize.ts:28-32`) | — | — |
| Accords | Par outil connecté : lire / demander / agir | FAIT | politiques par outil d'app (`policies`, `judgeNative` `agent/loop.ts:1363`) | — | — |
| Accords | Portée : une fois, toujours, par site | FAIT | une fois, conversation, toujours (`agent/conversationgrants.ts`) ; test : conversation-grant | Par site : à vérifier | — |
| Accords | La base fait foi pour chaque accord, jamais l'état d'un écran | FAIT | approbations en base, usage unique (`agent/executions.ts`) | — | — |
| Accords | Confirmation pendant la voix : à l'écran, jamais à l'oral | NON VÉRIFIÉ | `voice/session.ts` | — | — |
| Sécurité | **Code par e-mail** pour les actions critiques (une fois, 10 min, 5 essais) | MANQUANT | 2FA à la connexion (`totp.ts`) | Second facteur sur action critique | M |
| Sécurité | Double vérification (TOTP) à la connexion, codes de secours en empreinte | FAIT | `totp.ts`, `twofactor.ts` ; test : totp | — | — |
| Sécurité | **Nouvel appareil** : alerte « C'est moi / Ce n'est pas moi » sur les autres appareils | MANQUANT | `sentinel` (connexions ratées, `sentinel/texts.ts:126`) | Alerte nouvel appareil connecté | S |
| Sécurité | Relier un appareil avec un nombre à 3 chiffres à recopier (jamais de mot de passe dans l'app) | FAIT | appairage du Relais par code (`relay.ts:98`) ; test : relay | — | — |
| Sécurité | Mot de passe oublié sans e-mail : code lu dans les journaux du serveur | PARTIEL | `reset-password.ts`, récupération de compte (`AccountRecovery.tsx`) | Code par la console du serveur | S |
| Sécurité | En-têtes de sécurité posés par le serveur sur toutes les réponses | FAIT | `hardening.ts` ; test : security | — | — |
| Sécurité | X-Forwarded-For cru seulement du proxy d'entrée | NON VÉRIFIÉ | `net.ts` | À vérifier | S |
| Sécurité | Lecture publique bornée, IP vérifiée à chaque redirection (anti-SSRF), DNS épinglé | FAIT | `guardedFetch` (`scheduler.ts:168`), `net.ts` ; test : security-fixes | — | — |
| Sécurité | Clé du modèle jamais dans la machine de l'agent : relais avec jeton par agent | FAIT | moteurs par lien du bot (`botlink.ts`), relais de secrets (`egress.ts`) ; test : botlink-live | — | — |
| Sécurité | Lanceur seul à parler à Docker, clé renouvelable | FAIT | `dockerproxy.ts` ; test : dockerproxy | — | — |
| Sécurité | Aucune télémétrie | FAIT | — | — | — |

### Coffre, connexions, sites

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Coffre | La personne saisit ses identifiants dans une carte ; le serveur les pose dans la page ; l'origine montrée vient du serveur, jamais d'un texte de l'agent | PARTIEL | coffre + `vault_type` (`agent/tools.ts:552`) ; connexion d'un site par l'utilisateur sur l'écran (`SignInSite.tsx`) | Carte de saisie dans le chat avec origine lue par le serveur : à vérifier | S |
| Coffre | Coffre à la personne, droit par agent (allumé pour un agent non partagé, éteint pour un agent partagé) | PARTIEL | coffre par utilisateur | Droit par bot | S |
| Sites | **Registre vérifié des sites connectés** : « connecté » seulement après contrôle (vraie page, plus de champ mot de passe) ; une page de connexion qui revient → « à reconnecter » | MANQUANT | sessions de navigateur gardées, rien de listé | Liste « sites où ton bot est connecté » | M |
| Connexions | Google (courriel, agenda, Drive, contacts) avec le propre projet Google Cloud de l'utilisateur, que l'agent crée en suivant une recette | DIFFÉRENT | apps natives Google (connexion Google gérée, `googlelogin.ts`, `native/`) | Sklubot plus simple pour l'utilisateur | — |
| Connexions | **Connecteurs globaux** : une connexion faite sur un agent vaut pour tous, sauf ceux qu'on décoche | PARTIEL | comptes natifs par utilisateur ; connecteurs MCP par bot | Choix « pour tous mes bots » | S |
| Connexions | MCP par adresse ; jeton gardé chiffré sur le serveur, l'agent ne le reçoit jamais (relais) | FAIT | `connectors.ts` (jeton côté serveur) ; test : connector-errors | — | — |
| Connexions | Connecteurs prêts avec une clé (GitHub, Airtable, Stripe en lecture, Apify) testée avant enregistrement | FAIT | catalogue (`catalog.ts`), test de connexion | — | — |
| Connexions | OAuth fini sans adresse à copier | FAIT | `connectors/oauth/callback` (`routes.ts`) ; test : oauth | — | — |
| Connexions | Logos réels des apps récupérés par le serveur (le navigateur ne parle à aucun tiers) | NON VÉRIFIÉ | `connectorcatalogroutes.ts` | — | — |
| Publication | Publier par l'API de la plateforme (Instagram, X) avec lire / confirmer / agir | PARTIEL | x_search (lecture), apps du catalogue | Publication X/Instagram par API | M |
| Sortie | **Sortie réseau des navigateurs** par la maison (nœud Tailscale sur le PC), un VPN, ou le serveur | MANQUANT | — | Voir « À faire » (sites qui refusent les IP de serveur) | M |

### Proactivité, veilles, routines

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Veilles | Relevé des sources **sans modèle** (page, flux, Gmail, agenda, outil) ; rien de neuf → aucun coût | FAIT | `checkWatch` (`scheduler.ts:164`), déclencheurs natifs (`native/triggers.ts:167`), saut si entrées inchangées (`scheduler.ts:133`) | — | — |
| Veilles | Du neuf → **petit modèle de décision** qui juge si ça correspond à ce que la personne cherche, avant de réveiller le gros modèle | MANQUANT | tout changement réveille le bot (`scheduler.ts:179`) | Voir écarts | S |
| Veilles | Veille qui prévient seulement (résumé du petit modèle) vs routine à condition qui réveille l'agent une fois | PARTIEL | check-ins (`agent/nudges.ts`), routines | Mode « prévenir seulement » pour une surveillance | S |
| Proactif | Passage proactif à l'intervalle choisi : relevé, tri, vrai tour dans un fil, compte rendu court, notification seulement s'il y a quelque chose | FAIT | check-ins (`agent/nudges.ts:96-108`, plafond, budget, heures calmes) ; test : wave5 | Tour dans un fil séparé : non | — |
| Proactif | Une proposition concrète par jour au plus, à accepter d'un geste | FAIT | nudges avec « Fais-le / Plus tard / Jamais » (`agent/nudges.ts:162`) | — | — |
| Proactif | Objectifs de la personne gardés en tête | FAIT | `agent/goals.ts` | — | — |
| Routines | Tâches à heure fixe ; programmer à la voix | FAIT | `routine_create` ; voix → tour normal | — | — |
| Routines | Un tour proactif coupé se reprend une fois | PARTIEL | reprise au démarrage | — | — |
| Notifications | Fin de tâche notifiée seulement si personne ne regarde **et** si le travail a pris du temps | PARTIEL | push si aucune fenêtre visible (`push.ts:148`) | Condition « a pris du temps » | S |
| Notifications | Heures calmes et fréquence des alertes | FAIT | `push.ts:94-162` | — | — |
| Notifications | Alerte quand le crédit OpenRouter baisse, avant que les agents s'arrêtent | PARTIEL | erreur « plus de crédit » classée (`agent/failures.ts:59`) | Alerte **avant** la panne | S |
| Notifications | Web Push sans service tiers (VAPID, chiffrement aes128gcm) | FAIT | `push.ts:28` ; test : non trouvé | Test dédié | S |

### Modèles, coûts, vitesse

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Modèles | Fournisseurs : Ollama local/Cloud, OpenRouter, Anthropic, OpenAI, Gemini, Mistral, DeepSeek, compatible OpenAI | FAIT | `providers.ts`, `openrouter.ts` ; test : openrouter | — | — |
| Modèles | Modes Rapide / Équilibré / Le plus fort / Gratuit / Custom ; Gratuit et Custom = chaînes de secours | PARTIEL | chaîne de secours (`agent/reliability.ts:18`) | Modes nommés pour l'utilisateur | S |
| Modèles | **Mode Auto** : la demande est classée une fois (simple / moyen / complexe) et toutes les étapes de la tâche prennent le modèle du niveau | MANQUANT | — | Voir écarts | M |
| Modèles | **Modèle de décision** choisi chaque semaine selon ce que la clé offre et les prix | PARTIEL | petit modèle pour mémoire et routage (`agent/roomrouting.ts`), modèle du relecteur (`agent/authorize.ts:229`) | Choix automatique selon prix | S |
| Modèles | Modèle rapide pour l'instantané (accusé, suggestions, résumé d'une phrase), jamais pour agir | MANQUANT | — | — | S |
| Modèles | Catalogue des modèles avec prix et groupes recommandés calculés (le plus récent de chaque gamme) | PARTIEL | `apimodels.ts`, `TeamModels.tsx` | Groupes recommandés calculés | S |
| Coûts | Chaque appel mesuré ; budget mensuel et plafond du jour par agent, prévenu sur le téléphone | FAIT | `usage.ts`, `usagecaps.ts` ; test : usage-caps | — | — |
| Vitesse | **Chauffe** : après un redémarrage d'agent, un premier tour caché pour que le vrai premier message soit rapide | MANQUANT | — | Utile pour les moteurs Claude Code / Codex qui démarrent lentement | S |
| Vitesse | Banc de mesure de la réactivité (chat et voix, depuis la fin de la parole) | PARTIEL | `desktest.ts` | Banc de réactivité vocale | S |
| Médias | Images, vidéos, musique, voix, transcription, avec « Automatique » qui choisit le meilleur modèle du catalogue | FAIT | `images.ts`, `video.ts`, `videostudio.ts`, `voice/` ; test : media-tools | Musique : non | — |

### Apprentissage et mémoire

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Apprentissage | **Un mot de correction, une préférence, un refus ou une réaction déclenche tout de suite une relecture courte, à part** (repérée sans modèle) | PARTIEL | extraction après 10 min de calme (`agent/memory.ts:137`), réactions transmises au bot (`agent/prompt.ts:132`) | Déclencheur immédiat sur correction | S |
| Apprentissage | Relecture cachée qui ne reçoit que les mots de la personne et la réponse (aucun résultat d'outil), ne touche qu'à la mémoire et aux compétences, plafonnée par heure, seulement pour le propriétaire | FAIT | extraction des seuls messages tapés (`agent/memory.ts:145`) ; test : memory-guard | Plafond par heure à vérifier | — |
| Apprentissage | Une réaction n'autorise jamais rien | FAIT | réactions = retour, pas d'accord | — | — |
| Mémoire | Hermes relit tous les 10 messages et après une longue tâche | PARTIEL | calme de 10 min | Déclencheur par nombre de messages (voir audit nightly) | S |

### Ordinateur, appareils, hébergement

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Ordinateur | Prendre la main sur l'écran de l'agent | FAIT | `takeover.ts`, `LiveScreen.tsx` | — | — |
| Ordinateur | Détails de la machine : disque, logiciels, mémoire, routines, connexions | FAIT | `MyComputer.tsx`, `DiskAndTeamFolder.tsx`, `disk.ts` | — | — |
| Ordinateur | Actions sur l'ordinateur de l'utilisateur via l'app Windows (droits, confirmation locale, autonomie) | FAIT | Sklubot Relais + compagnon (`agent/mycomputer.ts`, `companion/`) ; test : relay | — | — |
| Appareils | App Windows, app Android, iPhone par l'écran d'accueil | FAIT | compagnon Electron, `mobile/`, `android/`, PWA | — | — |
| Hébergement | Installation en une commande (Docker installé si absent), HTTPS automatique, sslip.io sans domaine | PARTIEL | `deploy/`, `docs/INSTALLATION-VPS.md` | sslip.io automatique à vérifier | S |
| Hébergement | « Installe Noah sur mon VPS » à coller dans un agent de code (`AGENTS.md` d'installation) | MANQUANT | `docs/MISE-EN-ROUTE.md` | Fichier d'installation pour agent de code | S |
| Hébergement | Hostinger Docker Manager (Compose depuis une URL) | NON REPRIS | — | Spécifique à un hébergeur | — |
| Hébergement | Derrière un Traefik existant | NON VÉRIFIÉ | `docker-compose.coolify.yml` | — | — |
| Mises à jour | **Mise à jour automatique** : manifeste signé (Ed25519), images par empreinte, préchargement, installation dans le créneau calme (jamais pendant une tâche, une validation, un écran ouvert ou avant une routine), majeure attendue 7 jours, migration = clic, sauvegarde + contrôle de santé + retour arrière | MANQUANT | `deploy/` (mise à jour manuelle), sauvegardes (`autobackup.ts`) | Voir « À faire » | L |
| Diagnostics | Erreurs récentes du serveur lisibles depuis l'app, masquées | FAIT | `Incidents.tsx`, `health.ts`, `monitor.ts` ; test : monitor | — | — |
| Admin | Confirmation par e-mail optionnelle (SMTP réglé par le propriétaire) | PARTIEL | e-mails de compte (`accountmail.ts`) ; test : account-mail | Usage pour les actions critiques | S |
| Admin | Préférences d'interface par compte, jamais par appareil | NON VÉRIFIÉ | `ui` dans `settings` | — | — |

### Voix (grille de comportements de Noah)

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Voix | Démarrer un appel, première réplique rapide | FAIT | `calls.ts:13` (`callStarted`), `voice/session.ts` ; test : wave6-voice | — | — |
| Voix | Couper la parole | FAIT | interruption à la voix (`voice/session.ts`) | — | — |
| Voix | Accusé oral immédiat, travail en arrière-plan | PARTIEL | le bot parle quand son tour avance | Accusé immédiat avant le travail | S |
| Voix | Ce qu'on **entend** pendant qu'un outil travaille (Noah : absent) | PARTIEL | `progress_update` lu ? à vérifier | Petites phrases d'attente | S |
| Voix | L'appel survit à la navigation et au téléphone verrouillé | NON VÉRIFIÉ | `CallBar.tsx` | — | — |
| Voix | Fin d'appel : le travail continue, une trace reste | FAIT | résumé d'appel (`calls.ts:36`) | — | — |
| Voix | Demander où ça en est et obtenir un état vrai | PARTIEL | état live (`bus.ts`) | Le bot vocal lit-il l'état des tâches ? | S |
| Voix | Corriger le travail en cours à la voix | PARTIEL | steering | — | — |

## Écarts de comportement, flux par flux

### 1. Premier message à un bot

- **Noah.** Un nouvel agent s'ouvre sur « Que doit faire Rita ? » et 4 demandes à toucher adaptées à son rôle ; après un redémarrage, un **tour de chauffe** caché évite que le premier vrai message paie 3 à 8 s de démarrage (mesures de leur doc).
- **Sklubot.** Idées de premières tâches (`ideas.ts`), pas de demandes propres au rôle du bot neuf ; les moteurs Claude Code / Codex démarrent à froid au premier message.
- **Corrections.** Demandes à toucher générées à la création du bot, selon son rôle (S). Tour de chauffe des moteurs d'abonnement après redémarrage de l'ordinateur du bot (S).

### 2. Un bot qui utilise son ordinateur sur un lien

- **Noah.** Navigateur par agent (Camofox) ; registre **vérifié** des sites connectés (« connecté » seulement si la vraie page n'a plus de champ mot de passe ; revient à « à reconnecter » quand la page de connexion revient) ; sortie réseau par la maison (nœud Tailscale sur le PC de la personne) ou un VPN, pour les sites qui refusent les IP de serveur.
- **Sklubot.** Ouvre le lien sur son écran (`agent/prompt.ts:57`), consignes YouTube, Relais vers l'ordinateur de l'utilisateur en dernier recours.
- **Différences.** (a) L'utilisateur ne voit pas **où** son bot est connecté. (b) Pour un site qui refuse l'IP du serveur, Sklubot passe par le Relais (tout l'ordinateur de l'utilisateur) ; Noah ne fait passer que la sortie réseau du navigateur par la maison.
- **Corrections.** Liste « sites connectés » vérifiée par le serveur, dans Connexions (M). Option « sortie par la maison » pour le navigateur du bot (Tailscale exit node ou proxy du Relais) (M).

### 3. Tâche longue qui échoue au milieu puis reprend

- **Noah.** Tâches en base, titre par le modèle rapide, un redémarrage ferme en échec les tâches coupées ; un tour proactif coupé se reprend une fois. Le **reçu** sous chaque réponse signale « dit et pas fait » et « fait et pas dit ».
- **Sklubot.** Plus solide sur la reprise (`agent/failures.ts`, `agent/executions.ts`, testés : failures 16/16 aujourd'hui). Mais rien ne compare ce que le bot **affirme** à ce qu'il a fait : seule la règle du prompt « ne dis jamais que c'est fait sans résultat » (`agent/prompt.ts:182`).
- **Correction.** Reçu sans modèle : à la fin d'un tour, repérer les phrases au passé à la première personne qui annoncent un envoi, une publication, une suppression, un paiement, une création de routine (FR/EN), et les comparer aux exécutions `done` du tour (`agent/executions.ts`) ; dans l'autre sens, toute exécution sensible `done` non mentionnée. Afficher une petite ligne sous la réponse, se taire en cas de doute (M).

### 4. Approbations

- **Noah.** Accords en base, juge qui ne lit pas les pages, trois modes d'autonomie, droits par outil (lire / demander / agir), portée une fois / toujours / par site, code par e-mail pour les actions critiques, coffre où la personne tape dans une carte.
- **Sklubot.** Au même niveau et plus fin (citation des mots de l'utilisateur, empreinte à usage unique, plancher non négociable). Testé (conversation-grant 11/11, floor-autonomy).
- **Différences.** (a) Pas de second facteur sur une action critique (un vol de session suffit pour tout approuver). (b) Pas de « boîte unique » des accords de tous les bots.
- **Corrections.** Code par e-mail (ou TOTP) optionnel avant une action du plancher (paiement, suppression définitive, nouveau destinataire) (M). Boîte « À toi » qui réunit toutes les cartes en attente (M).

### 5. Mémoire apprise puis rappelée

- **Noah.** En plus de la relecture d'Hermes (tous les 10 messages, après une longue tâche), un **mot de correction, une préférence, un refus ou une réaction** déclenche tout de suite une relecture cachée, sans résultat d'outil, limitée à la mémoire et aux compétences, plafonnée par heure.
- **Sklubot.** Extraction après 10 min de calme, preuve par extrait (`agent/memory.ts:137-201`), testée (memory-recall 12/12 aujourd'hui, memory-guard).
- **Différence.** Une correction (« non, je t'ai dit le vendredi ») n'est apprise qu'après 10 min de calme ; si l'utilisateur continue, le bot peut refaire l'erreur dans la même session.
- **Correction.** Repérer sans modèle les marques de correction (FR : « non, je t'ai dit », « pas comme ça », « arrête de », « toujours », « jamais » ; EN équivalents) et lancer l'extraction sur ce seul échange, avec un plafond par heure (S).

### 6. Une routine qui se déclenche

- **Noah.** Veilles : relevé sans modèle ; du neuf → **petit modèle de décision** qui juge si ça correspond à la demande ; seulement alors un vrai tour, dans un fil ; compte rendu court dans la conversation principale ; « des centaines de fois moins cher » que réveiller l'agent à chaque passage.
- **Sklubot.** Relevé sans modèle et empreinte des entrées (`scheduler.ts:133`, `:164`) : très bien. Mais **tout** changement réveille le bot complet (`scheduler.ts:179`) : une page qui change un compteur de vues fait tourner un tour entier.
- **Corrections.** Pour une surveillance avec condition (« préviens-moi si le prix passe sous 50 € »), un petit modèle lit la nouveauté et répond oui / non avant de réveiller le bot (S). Le tour réveillé tourne dans un fil, seul le compte rendu va dans le chat (M, voir audit Agent Zero).

### 7. Conversation de groupe avec plusieurs bots

- **Noah.** Une question d'un agent **monte d'un cran** : l'agent qui a confié la tâche répond d'abord, puis le chef d'équipe, puis la personne ; un sujet réservé va directement à la personne ; la réponse d'un agent est une « décision prise pour toi » que la personne peut corriger, et la correction devient une règle.
- **Sklubot.** Salons, routage, 3 rebonds, `bot_message` avec attente. Mais un assistant ou un coéquipier qui a une question appelle `ask_user` : la personne est dérangée pour des choses que le bot principal savait.
- **Correction.** Quand un bot travaille pour un autre bot (`bot_message` wait, assistant), router `ask_user` d'abord vers le bot demandeur, sauf sujet du plancher ; afficher la réponse comme « décidé pour toi par X » avec « Corriger » qui propose une règle (M).

### 8. Appel vocal

- **Noah.** Pré-contexte : avant que la voix parle, un modèle rapide choisit ce qui servira ; accusé oral immédiat ; rappel où l'agent fait sonner le téléphone. Leur propre grille note comme manquants : silence pendant le travail, correction qui attend, état qui n'arrive qu'à la fin.
- **Sklubot.** Appel complet (`voice/session.ts`), interruption, résumé de fin (`calls.ts`). Testé (wave6-voice).
- **Corrections.** Accusé oral immédiat (« je regarde ») avant un tour long (S). Petites phrases d'attente pendant un outil long, tirées des étapes (S). Appel sortant « le bot te rappelle » quand une tâche longue finit, si la personne l'a demandé (M).

### 9. Livraison d'un fichier ou d'une page

- **Noah.** Lecture des fichiers bureautiques sans conversion ; médias avec choix « Automatique ».
- **Sklubot.** Au niveau ou mieux (artefacts, pages, studio vidéo, instantanés de fichiers).

### 10. Accueil d'un nouvel utilisateur

- **Noah.** Une commande, lien à usage unique pour créer le compte, choix du modèle et clé, puis premier agent depuis un modèle ; fichier `AGENTS.md` pour qu'un agent de code fasse l'installation à la place de la personne.
- **Sklubot.** Installation VPS documentée, accueil en étapes.
- **Correction.** Fichier d'installation destiné aux agents de code (Claude Code, Codex) (S).

### 11. Erreur de moteur ou de fournisseur

- **Noah.** Alerte **avant** que le crédit OpenRouter soit épuisé ; chaînes de secours Gratuit / Custom.
- **Sklubot.** Classement de l'erreur « plus de crédit » (`agent/failures.ts:59`) une fois la panne arrivée ; secours et carte de remèdes.
- **Correction.** Lire le solde OpenRouter (quand la clé a un plafond) une fois par jour et prévenir sous un seuil (S).

### 12. Redémarrage en plein travail

- **Noah.** Tâches coupées fermées en échec au démarrage ; messages en attente gardés en base.
- **Sklubot.** Reprise des tours, actions incertaines jamais rejouées. Mieux.

### 13. Message tapé pendant le travail

- **Noah.** Tri en trois : réponse rapide par le modèle rapide (« Noté », ou réponse à une question simple sans toucher la tâche), précision transmise à l'agent, ou message mis à la suite ; écrit en base avant l'accusé ; dédoublonné.
- **Sklubot.** Tout est fondu dans le tour en cours, sans accusé ; défaut d'héritage des droits d'une routine (déjà relevé).
- **Correction.** Accusé immédiat « Noté » sous le message (sans modèle, ou par un petit modèle) et tri simple : question courte → réponse à côté ; correction → fondue avec consigne ; nouvelle demande → à la suite (M).

### 14. Mise à jour du serveur

- **Noah.** Toutes les heures, manifeste signé ; préchargement ; installation dans le créneau calme du fuseau de la personne, jamais pendant une tâche, une validation, un écran ouvert ou juste avant une routine ; sauvegarde, contrôle de santé, retour arrière.
- **Sklubot.** Mise à jour manuelle (`deploy/`), sauvegardes automatiques (`autobackup.ts`, testé).
- **Correction.** Mises à jour automatiques signées avec créneau calme et retour arrière, d'abord pour les installations auto-hébergées (L).

## À faire, du plus utile au moins utile

1. **Reçu sans modèle** sous chaque réponse : « dit et pas fait » / « fait et pas dit », à partir des exécutions du tour (M).
2. **Accusé « Noté » et tri des messages tapés pendant le travail** (question courte à côté, correction fondue, nouvelle demande à la suite) (M).
3. **Questions d'un assistant ou coéquipier routées d'abord vers le bot demandeur**, sauf plancher ; « décidé pour toi » corrigeable en règle (M).
4. **Petit modèle de décision avant de réveiller le bot** sur une surveillance avec condition (S).
5. ✅ FAIT (L67, `isCorrection` / `learningDue` : dans la minute, sans modèle pour le repérer ; un passage au plus par lot de messages) — **Apprentissage immédiat sur un mot de correction** (repéré sans modèle, plafond par heure) (S).
6. **Mode Auto** : classer la demande une fois (simple / moyen / complexe) et choisir le modèle pour toute la tâche (M).
7. **Second facteur (e-mail ou TOTP) avant une action du plancher**, en option (M).
8. **Alerte nouvel appareil** (« C'est moi / Ce n'est pas moi ») (S).
9. **Registre vérifié des sites connectés** dans Connexions (M). — **FAIT (2026-11-23)**
10. **Boîte « À toi »** : toutes les cartes en attente de tous les bots (M).
11. **Demandes à toucher propres au rôle** d'un bot neuf ; **tour de chauffe** des moteurs après redémarrage (S).
12. **Alerte de crédit OpenRouter avant la panne** (S).
13. **Notification de fin seulement si le travail a pris du temps** (en plus de « aucune fenêtre visible ») (S).
14. **Sortie réseau du navigateur par la maison** (Tailscale / proxy du Relais) (M).
15. **Voix : accusé oral immédiat, phrases d'attente, rappel sortant** (S / M).
16. **Connecteurs « pour tous mes bots »** ; **droit au coffre par bot** (S). — **FAIT (2026-11-23)**
17. **Fichier d'installation pour agent de code** (S).
18. **Mises à jour automatiques signées avec créneau calme et retour arrière** (L).
19. **Modes de modèle nommés** (Rapide / Équilibré / Le plus fort / Gratuit) au-dessus de la chaîne de secours (S).
20. **Publication X / Instagram par API** avec lire / confirmer / agir (M).

## Non vérifié

- Je n'ai lu que les docstrings des modules et deux documents (le code est sous licence non commerciale : rien n'a été recopié). Les chiffres (3 à 8 s de démarrage, 10 min, 5 essais, 7 jours) viennent de ces textes.
- Côté Sklubot : portée « par site » des accords, confirmation à l'écran pendant un appel, nettoyage des caractères invisibles et ANSI dans les réponses, X-Forwarded-For, préférences d'interface par compte, appel qui survit au téléphone verrouillé, déploiement derrière Traefik, plafond horaire de l'extraction mémoire, bouton « Je ne peux pas » sur la prise en main.
- Tests Sklubot lancés aujourd'hui (pour l'ensemble des audits) : `conversation-grant` 11/11, `failures` 16/16, `memory-recall` 12/12.
