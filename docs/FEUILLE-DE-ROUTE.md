# Feuille de route technique de Sklubot

Mise à jour partielle le 18/11/2026 (tableau 1.6 des correctifs de sécurité, vérifications 1.5 et statuts des tickets, revérifiés dans le code). Relevé fait le 16/11/2026 sur la branche `claude/trusting-knuth-awqogb` (dernier commit `b3d4b03`), en lisant le code.
Objectif : passer de « techniquement riche » à « fiable, sûr, multi-clients, vendable », en partant de ce qui existe
vraiment, pas d'une liste théorique.

**Légende**
- **Vérifié** : lu dans le code (fichier:ligne cité). **Supposé** : déduit, pas vérifié en exécutant.
- États : **Existe** (utilisable aujourd'hui) · **Partiel** (une base existe, il manque des morceaux pour vendre) ·
  **Manque** · **En cours** (correctif de la revue de sécurité en train d'être fait dans une autre session).
- Numéros de ligne : relevés sur l'arbre de travail du 16/11. `routes.ts`, `auth.ts`, `agent/tools.ts`, `egress.ts`,
  `net.ts`, `relay.ts`, `linux.ts`, `computer.ts`, les fichiers Docker et `deploy/` sont modifiés en ce moment par
  une autre session : leurs numéros peuvent bouger de quelques lignes.
- Chemins : relatifs à la racine du dépôt (`server/src/…` sauf mention).

---

## 0. En bref

1. Sklubot est **beaucoup plus avancé** que ne le suppose l'évaluation sur la fiabilité des agents (validation humaine,
   actions irréversibles, journal non modifiable, file d'attente durable, reprise après coupure, garde anti-boucle,
   points d'arrêt de dépense) : ces points existent et sont testés.
2. Il est **en retard** sur ce qui rend un service vendable : pas de notion de « client » ni de plan, pas de compte
   opérateur, pas de MFA à la connexion, pas de récupération de compte, pas de surveillance ni d'alertes, pas de CI
   qui lance les tests du serveur, migrations de base non versionnées.
3. Un trou important n'est pas dans l'évaluation : **le coût IA n'est compté que pour 4 modèles Claude**. Les modèles
   Grok et GPT branchés sur les clés du serveur comptent 0 $ — budget mensuel et points d'arrêt ne s'appliquent donc
   pas à eux. C'est bloquant pour un plan gratuit sur les clés de l'opérateur.
4. Le passage à 4 VPS se heurte à un point de conception : les ordinateurs des bots montent la bibliothèque et le
   dossier d'équipe **depuis le disque du serveur central**. Il faut trancher ce point avant d'écrire le code.

---

## 1. État réel, point par point

### 1.1 Priorités P0 de l'évaluation

| Point de l'évaluation | État | Preuves (vérifié) | Ce qu'il faut corriger dans l'évaluation / ce qui manque |
|---|---|---|---|
| Isolation multi-utilisateurs | **Partiel** | Chaque ressource est rattachée à `user_id` (`db.ts:12-90`). Les routes passent par `ownBot` / `accessBot` qui répondent 404 sans révéler l'existence (`routes.ts:115-126`). Bots, volume personnel et conteneur séparés par bot (`linux.ts:38`, `linux.ts:256-271`). Dossier d'équipe par compte (`computer.ts:328`). Tests ponctuels : `test/security.test.ts:296` (le bot d'un autre compte ne peut pas être ajouté à un groupe). | Pas de suite de tests systématique « le compte B tente chaque route sur les ressources du compte A ». Les ordinateurs de **tous** les comptes sont sur le même réseau Docker que le serveur (`linux.ts:261`, `docker-compose.vps.yml` `DESKTOP_NETWORK`) → **H2, en cours**. |
| Isolation multi-entreprises | **Partiel** | Espaces d'équipe avec rôles (`workspaces.ts:10-55`, `shared.ts:740-745`), partage de bots (`db.ts:365`), journal d'équipe non modifiable (`db.ts:376-381`). | Un espace d'équipe n'est **pas** un client facturable : pas de plan, de quota, de budget, ni de données rattachées à l'espace (les bots restent la propriété d'un utilisateur). L'évaluation a raison sur le fond. |
| Sécurité des ordinateurs Linux | **Existe** (18/11 : H2, H3, M2, L10 corrigés ; H4 accepté) | Le serveur n'a pas le socket Docker : il passe par `docker-socket-proxy` (`docker-compose.vps.yml`, service `docker-proxy`). Serveur en lecture seule, `cap_drop: ALL`, `no-new-privileges`. Conteneurs des bots : capacités réduites (`linux.ts:136`, `linux.ts:266`), mémoire/CPU/pids limités (`linux.ts:262`). | Relevé du 16/11 : H2, H3, H4, M2, L10 ouverts. **18/11** : H2, H3, M2, L10 corrigés (voir 1.6) ; H4 accepté (Chromium en root dans le conteneur, gVisor facultatif). |
| Gestion des coûts IA | **Partiel** | Comptage par appel (table `usage`, `db.ts:81`), par bot et par personne (`usage.actor_id`). Budget mensuel par compte avec alerte à 80 % et arrêt (`usage.ts:57-101`, appliqué dans `agent/loop.ts:574` et `agent/goals.ts:193`). Points d'arrêt par tâche, 5 $ par défaut (`agent/spend.ts:8-17`). Plafond journalier des outils payants par bot (`bots.third_party_cap_usd`). Export CSV (`routes.ts:1222`). | **Prix connus pour 4 modèles seulement** (`usage.ts:19-24`) : `grok-4.7` et `gpt-5` (`llm/index.ts:15-19`) comptent 0 $ → budget et points d'arrêt inopérants pour eux. Usage des abonnements Claude Code / Codex gardé **en mémoire** (`usage.ts:11`), perdu au redémarrage. Pas de budget par espace d'équipe ni par client. |
| Sauvegardes et restauration | **Partiel** | `deploy/backup.sh` : copie le volume `sklubot_data` (base + bibliothèques) et chaque volume `sklubot-home-*` (ordinateurs des bots), Sklubot à l'arrêt pendant la copie. `deploy/restore.sh` restaure tout. `docs/SAUVEGARDE.md` : un essai manuel documenté (empreintes identiques, `integrity_check` ok). | Ne sauvegarde **pas** `.env` (donc ni `SESSION_SECRET` qui déchiffre le coffre, ni les clés) — seulement un rappel à l'écran. Pas de copie hors du VPS, pas de rotation, pas de chiffrement de l'archive, pas d'essai de restauration automatique, `deploy/update.sh` ne sauvegarde pas avant de mettre à jour, coupure de service pendant la copie. |
| Tests de bout en bout | **Partiel** | ~40 fichiers de tests serveur (`server/test/`), dont des scénarios complets avec un modèle scripté (`test/app.test.ts:94-191` : message, outils, validation, routines par webhook, bots qui se parlent). Mode démo sans modèle (`llm/demo.ts:3-6`). Test d'un vrai ordinateur de bot (`desktest.ts:9-18`, `npm run desk:test`). | Aucun test « un vrai modèle reçoit une tâche, agit, termine, rend compte ». **Aucune CI ne lance les tests du serveur** : le seul workflow (`.github/workflows/desktop.yml`) ne tourne que sur les tags `desktop-v*` et ne teste que l'appli de bureau. |

### 1.2 Priorités P1 de l'évaluation

| Point | État | Preuves | Écart |
|---|---|---|---|
| Supervision centralisée | **Partiel** | État en direct de chaque bot poussé par SSE (`bus.ts:43-71`). Vue des tâches de tout le compte (`routes.ts:1081`, `web/src/components/TasksView.tsx`). Rappels de travail bloqué (`agent/stuck.ts:7-10`). Santé des clés et connexions (`health.ts:15-30`). Arrêt d'un bot (`routes.ts:811`), d'une tâche, d'un job (`routes.ts:747`, `2275`). | Pas d'écran unique « tous les agents / missions / ordinateurs / consommation » ; pas de pause/reprise globale ; aucune vue opérateur sur tout le serveur. |
| Utilisateurs et rôles | **Partiel** | Rôles owner / admin / member / viewer par espace (`shared.ts:740-745`), invitations par lien à usage unique (`db.ts:360`). | Le rôle « manager » de l'évaluation correspond à « admin ». Il manque un **rôle opérateur du serveur** (aujourd'hui, aucune notion d'administrateur global : `grep isAdmin` ne trouve rien). |
| Facturation et abonnements | **Partiel** | Mode hébergé derrière `HOSTED_MODE=1` (`hosted.ts`, `docs/MODE-HEBERGE.md`) : offres, statuts, budget IA en €, paiement manuel. | Crédits prépayés payés par Paddle (`billing/paddle.ts`, `credits.ts`) ; abonnements payants encore en paiement manuel (`billing/provider.ts`). |
| Documentation et installation simple | **Existe** | Installateur double-clic (`deploy/Installer Sklubot sur mon VPS.*`, `deploy/install.sh`), `docs/INSTALLATION-VPS.md`, `docs/DEPLOIEMENT.md`, `docs/API.md`, mise à jour (`deploy/update.sh`), désinstallation. | `docs/API.md` n'est pas tenu à jour automatiquement (supposé : écrit à la main). Pas de doc « exploitant » (alertes, restauration, incident). |

### 1.3 Différenciants

| Point | État | Preuves | Écart |
|---|---|---|---|
| Centre de commande | **Partiel** | Briques : état live (`bus.ts`), tâches (`TasksView.tsx`), objectifs (`agent/goals.ts`, `routes.ts:735-742`), jobs (`jobs.ts`), consommation (`routes.ts:2045`), journal d'actions (`routes.ts:2149`), ordinateurs (`routes.ts:1266`, `computer.ts:69-81`). | Tout est éparpillé par bot ; pas de tableau unique ni d'actions groupées. |
| Multi-ordinateurs (4 VPS) | **Manque** | Tout tourne sur un Docker unique (`DOCKER_HOST: tcp://docker-proxy:2375`). Les « ordinateurs de l'utilisateur » via Sklubot Relais (`relay.ts:17-26`) sont autre chose : le PC personnel d'un utilisateur, pas un nœud de calcul. | À construire (phase 2). Prévu après les ordinateurs partagés. |
| Constructeur visuel de workflows | **Partiel** (moteur) / **Manque** (éditeur) | Déclencheurs : cron, une fois, webhook, surveillance, e-mail, Slack, agenda (`shared.ts:433`, `routes.ts:319`, `native/triggers.ts`). Validation humaine, reprise, essais avec repli (`agent/reliability.ts:8-38`), tâches de fond, objectifs à plusieurs tours, attente de la réponse d'un autre bot (`agent/team.ts:19-60`). | Pas de modèle « graphe d'étapes » ni d'éditeur ; les conditions et boucles sont aujourd'hui laissées au modèle. |
| Mémoire partagée intelligente | **Partiel** | Mémoire par bot avec source, statut contesté/confirmé, extraction sourcée mot pour mot (`agent/memory.ts:117-196`, `db.ts:55`), import/export (`routes.ts:2316`). Compétences partageables entre les bots d'un compte (`store.ts:513-552`, colonne `shared`). Historique des changements de règles avec annulation (`db.ts:343`), révisions de bot (`db.ts:246`). | Recherche par mots-clés uniquement (`agent/tools.ts:899-907`), pas sémantique. Pas de mémoire « par projet » ni de permissions par espace d'équipe. |
| Labo de test IA | **Manque** | Une seule évaluation manuelle (`docs/EVAL-PEPITES.md`). Liste ordonnée de modèles de secours (`agent/reliability.ts:13-16`). | Pas de banc de comparaison ni de choix automatique. |

### 1.4 Modules pro

| Module | État | Preuves |
|---|---|---|
| Créateur d'agents sans code | **Existe** | Création/réglage de bots dans l'interface (`routes.ts:525`), un bot peut créer des bots (`agent/tools-team.ts`), duplication (`web/src/components/DuplicateBotModal.tsx`). |
| Marketplace d'agents | **Manque** | — |
| Bibliothèque de compétences versionnée et partageable | **Partiel** | Compétences par bot, partage entre bots du compte, compétences apprises proposées puis relues (`agent/tools.ts:738-761`), import (`skillImportTools`), contrôle de sécurité du texte avant ajout et sur demande (`skillscan.ts`, docs/COMPETENCES.md §4). Pas de versions ni de partage entre comptes. |
| Gestionnaire de fichiers indexé | **Partiel** | Bibliothèque par bot (`routes.ts:1391`, `1501`), dossier d'équipe (`routes.ts:1399-1416`), « fichiers modifiés » avec retour arrière (`snapshots.ts:8-22`). Pas d'index ni de recherche plein texte. |
| Historique des actions | **Existe** | Journal par appel d'outil, non modifiable (`db.ts:432-438`, `journal.ts:5-9`), journal d'activité (`db.ts:149-154`, `routes.ts:1108`), export CSV. |
| Validation humaine | **Existe** | Cartes d'accord liées à l'action exacte, usage unique, résultat « incertain » jamais rejoué (`agent/executions.ts:8-17`) ; actions irréversibles toujours demandées une par une (`agent/irreversible.ts:5-17`). |
| Planificateur intelligent multi-agents/machines | **Partiel** | Planificateur de routines (`scheduler.ts:22-125`), file durable par bot, limite d'ordinateurs allumés avec attente (`linux.ts:185`, `MAX_DESKTOPS`). Rien entre machines. |
| Hors ligne / reprise | **Existe** | File durable `bot_queue` (`db.ts:490`, `store.ts:894`, `agent/loop.ts:234`), tours en cours retrouvés (`db.ts:193`), objectifs repris (`agent/goals.ts:11-18`). |
| API publique et webhooks | **Partiel** | Webhooks entrants (`routes.ts:319`). API documentée (`docs/API.md`) mais **par cookie de session seulement** : pas de clé d'API, pas de webhooks sortants. |
| Système de plugins | **Partiel** | Connecteurs MCP distants (`connectors.ts`, `catalog.ts`), serveurs d'outils lancés dans l'ordinateur du bot (`localtools.ts:13-25`), connecteurs HTTP proposés par un bot et approuvés (`db.ts:440`). C'est déjà un système d'extensions ; il manque un format de paquet et une distribution. |

### 1.5 Vérifications avant de vendre

| Vérification | État | Preuves / remarque |
|---|---|---|
| Isolation entre clients | **Partiel** | Voir 1.1. Pas de suite de tests dédiée. |
| Socket Docker / hôte | **Existe** (18/11) | Proxy filtrant à nous qui inspecte le corps des créations de conteneur (H3, `dockerproxy.ts`, `dockerproxy.test.ts`). |
| Secrets chiffrés, jamais dans le navigateur | **Existe / En cours** | AES-256-GCM avec clé dérivée de `SESSION_SECRET` (`auth.ts:80-104`), tag de 16 octets imposé (L2). Relais d'identifiants : la clé n'entre pas dans l'ordinateur du bot (`egress.ts:14-29`). Secrets collés masqués (`pastedsecrets.ts`). M1 corrigé (`d94b0c6`), M4 corrigé. **18/11** : clé de données séparée de `SESSION_SECRET` avec rotation (`datakey.ts`, `datakeyrotate.ts`, `rotatekey.ts`, `data-key.test.ts`). |
| Authentification : sessions | **Partiel** | Jeton haché en base, 30 jours (`auth.ts:6-38`), limite de tentatives (`routes.ts:205-219`), connexion Google (`googlelogin.ts`). **18/11** : lien de connexion par e-mail (`emaillink.ts`), « se déconnecter des autres appareils » (`twofactor.ts`). Pas encore de liste des appareils ni de révocation d'un appareil précis. |
| MFA | **Existe** (18/11) | Double authentification TOTP + 10 codes de secours à la connexion, pour toutes les façons d'entrer (`twofactor.ts`, `TwoFactor.tsx`, `totp.test.ts`). Pas encore imposée aux opérateurs. |
| Récupération de compte | **Fait (partiel)** | « Mot de passe oublié ? » par e-mail et changement d'adresse confirmé par lien (`accountmail.ts`, SMTP du serveur : Réglages → Compte ou `SMTP_*`). Sans SMTP : commande `reset-password.ts`. Restent : alerte « nouvelle connexion », MFA (SK-P0-09). |
| Premier compte sans code d'installation | **Existe** (M6 corrigé) | Installation neuve ouverte aux autres : refus de démarrer sans `SETUP_CODE` (`index.ts`, test « M6 » de `security-review.test.ts`). |
| Base : sauvegarde, migrations, restauration testées | **Partiel** | Sauvegarde : voir 1.1. Migrations : schéma idempotent + `ALTER TABLE ADD COLUMN` (`db.ts:10`, `db.ts:106`), **sans numéro de version** ni test de montée de version. |
| Détection de boucles / blocages | **Existe** | `LoopGuard` (`agent/reliability.ts:78-87`), limite de temps par tour des moteurs abonnement (`config.ts:86`, `agent/engine.ts:525`), rappels de travail bloqué (`agent/stuck.ts`), interblocage entre bots détecté (`agent/team.ts:47`). |
| Charge (dizaines d'agents) | **Manque** | Aucun test de charge. Un seul processus Node, SQLite, 4 ordinateurs allumés par défaut (`config.ts:60`). |
| Android réel et notifications | **Partiel** | Appli Expo avec tests unitaires (`mobile/__tests__/`), Web Push côté serveur (`push.ts:9-20`). L'appli native n'a **que des notifications locales** (`mobile/app.config.ts:54`, `enableRemoteNotifications: false`). Pas de test sur appareil réel automatisé (supposé). |
| Paiement, quotas, factures, suspension | **Partiel** | Mode hébergé : limites par offre côté serveur, suspension en lecture seule (`hosted.ts`) ; crédits prépayés par Paddle, cachés sans `PADDLE_*` (`credits.ts`, `billing/paddle.ts`). Reste : abonnements récurrents par Paddle, factures. |
| Surveillance (alertes, erreurs, disponibilité, consommation) | **Existe** (18/11) | `/api/health` vérifie base, Docker, disque, planificateur, sauvegarde, file (`monitor.ts`) ; Sentinelle (incidents, alertes push/e-mail, page Surveillance, `server/src/sentinel/`). Pas de `/metrics`. |
| Licences open source | **Partiel** | Projet sous MIT (`LICENSE`). Code inspiré de deepseek-harness (MIT) cité dans les fichiers (`jobs.ts:13`, `snapshots.ts:14`, `agent/goals.ts:20`). Aucun inventaire des licences des dépendances ni de l'image des ordinateurs (Chromium, polices, Piper/voix, whisper). |
| Conditions Claude Code / Codex pour un accès commercial partagé | **Manque** (vérification juridique) | La doc dit déjà « usage personnel, ne fais pas travailler les bots de quelqu'un d'autre sur ton abonnement » (`docs/INSTALLATION-VPS.md:235-245`). Non vérifié contre les conditions actuelles des fournisseurs. |

### 1.6 Correctifs de la revue de sécurité

| Réf. | Sujet | État |
|---|---|---|
| H1 | Liens publics SVG (XSS) | **Corrigé** (`d94b0c6`) |
| M1 | Connecteur proposé par un bot qui étend un secret à un nouvel hôte | **Corrigé** (`d94b0c6`) |
| H2 | Isolation réseau des ordinateurs des bots | **Corrigé** (`b8096fa`, vérifié le 18/11) — socket dédiée par ordinateur qui ne sert que l'outil de ses bots et le relais (`botlink.ts`), le port web ne les sert plus ; pare-feu `deploy/bots-firewall.sh`. Tests : `server/test/security-review.test.ts` « H2 », `botlink-live.test.ts` |
| H3 | Filtrage du corps des requêtes par le proxy Docker | **Corrigé** (`b8096fa`) — proxy filtrant à nous (`dockerproxy.ts`) : création de conteneur inspectée (montages, privilèges, réseaux refusés), routes limitées, listes réduites aux conteneurs de Sklubot, exec vérifiés. Tests : `dockerproxy.test.ts` (6) |
| H4 | Chromium en root / `--no-sandbox` | **Accepté, atténué** — toujours root + `--no-sandbox` (`docker/desktop/open-browser.sh`) : le bac à sable de Chromium demande setuid ou des espaces de noms que seccomp interdit. Frontière = le conteneur (aucune capacité dangereuse, réseau à part, `no-new-privileges`) ; gVisor (`SKLUBOT_DESKTOP_RUNTIME=runsc`) et userns-remap documentés (`docs/INSTALLATION-VPS.md`, « Renforcements facultatifs ») |
| M2 | Quota disque des ordinateurs | **Corrigé** (`b8096fa`) — `--storage-opt size` tenté là où Docker le permet (`linux.ts`, « M2 »), tailles lues par `docker ps`, surveillance `diskwatch.ts` + carte disque plein. Test : `server/test/security-review.test.ts` « M2 » |
| M3 | En-têtes CSP + images distantes dans le markdown | **Corrigé** (`b8096fa`) — CSP et en-têtes de sécurité sur chaque réponse (`hardening.ts`), pas d'images distantes (`web/src/lib/markdown.ts`). Tests : `server/test/security-review.test.ts` « M3 » (2) |
| M4 | Nettoyage de `secret_use` | **Corrigé** — secret renvoyé par une API masqué (texte) ou réponse refusée (binaire) (`apiconnectors.ts` `scrubSecret`, `egress.ts` `binaryHoldsSecret`). Test : `server/test/security-review.test.ts` « M4 » |
| M5 | Pas de vérification d'e-mail | **Corrigé** (`84df25b`, `0b15252`) — vérification obligatoire en inscription publique ou mode hébergé : 403 `email_unverified` sur toutes les routes sauf la vérification (`publicsignup.ts`, `routes.ts` `emailGateBlocks`), comptes non confirmés supprimés après 5 h, Google = vérifié. Tests : `public-signup.test.ts`, `public-signup-off.test.ts` |
| M6 | Premier visiteur qui prend le serveur sans `SETUP_CODE` | **Corrigé** (`b8096fa`) — une installation neuve ouverte aux autres refuse de démarrer sans `SETUP_CODE` (`auth.ts`, `index.ts`). Test : `server/test/security-review.test.ts` « M6 » |
| M7 | Limites de taille des corps de requête | **Corrigé** (`b8096fa`) — 1 Mo de JSON, 26 Mo pour les envois, avant tout traitement (`hardening.ts`). Test : `server/test/security-review.test.ts` « M7 » |
| L1 | `X-Forwarded-For` | **Corrigé** (`b8096fa`) — cru seulement depuis l'adresse du proxy inverse (`net.ts`). Test : `server/test/security-review.test.ts` « L1 » |
| L2 | Longueur du tag de scellement | **Corrigé** — tag de 16 octets exigé, anciennes valeurs lisibles, tag raccourci refusé (`datakey.ts`, `authTagLength: 16`). Test : `server/test/security-review.test.ts` « L2 » |
| L4 | Test du poste (desk test) | **Corrigé** (`b8096fa`) — réservé au propriétaire du serveur (le plus ancien compte) (`routes.ts`, `desktest.ts`). Test : `server/test/security-review.test.ts` « L4 » |
| L7 | Limite de fréquence des webhooks | **Corrigé** (`b8096fa`) — par adresse et par webhook (`routes.ts` `/hooks/:token`). Test : `server/test/security-review.test.ts` « L7 » |
| L10 | Swap mémoire | **Corrigé** (`03b9759`) — `deploy/memory-guard.sh` (fichier d'échange selon la mémoire, earlyoom qui épargne node/ssh/docker), lancé par `install.sh` sans bloquer. Tests : `memory-guard.test.ts` (7) |

---

## 2. Là où l'évaluation externe se trompe ou simplifie

| L'évaluation dit / suppose | En réalité (vérifié) |
|---|---|
| Il faut ajouter validation humaine, historique des actions, reprise hors ligne | Existent, avec des garanties fortes (action liée à son hash, usage unique, « incertain » jamais rejoué, journaux non modifiables par déclencheur SQL). |
| Il faut une détection de boucles | Existe : `LoopGuard`, limite de temps par tour, rappels de blocage, détection d'attente circulaire entre bots. |
| Il faut des rôles admin / manager / membre / lecture | Existent par espace d'équipe (owner/admin/member/viewer). Ce qui manque est le **rôle opérateur** du serveur et le lien rôle → client facturable. |
| Gestion des coûts « à créer » | Largement là (budget mensuel, points d'arrêt, plafonds d'outils payants, CSV). Le vrai trou est ailleurs : **prix manquants** pour Grok/GPT et usage des abonnements non persisté. |
| Créateur d'agents sans code « module pro » | Déjà le fonctionnement normal de Sklubot. |
| Système de plugins « à créer » | MCP distant + serveurs d'outils locaux + connecteurs HTTP approuvés = déjà un système d'extensions. |
| Ordre « phase 5 commercialisation en dernier » | Le propriétaire veut le mode hébergé **avant** le multi-VPS. C'est cohérent à condition de faire d'abord les prérequis (coûts comptés juste, compte opérateur, MFA/récupération, sauvegarde testée, CI). |
| Non mentionné | Aucune CI des tests serveur ; migrations sans version ; `/api/health` creux ; appli mobile sans notifications distantes ; montage de la bibliothèque depuis le disque central (bloque le multi-VPS tel quel). |

---

## 3. Tickets

Format : **ID** · titre · pourquoi · état actuel · modifications · tests de validation · effort (S ≤ 1 j, M 2–4 j,
L 1–2 sem., XL > 2 sem.) · dépendances.

Les phases suivent l'ordre voulu par le propriétaire : 1 fiabilité/sécurité → H mode hébergé → 2 multi-VPS →
3 intelligence → 4 expérience. La priorité P0/P1/P2 est indiquée dans l'ID.

### Phase 1 — Fiabilité et sécurité

#### SK-P0-01 · Terminer et verrouiller les correctifs de la revue de sécurité
- **Pourquoi** : sans eux, un bot (ou une page qu'il lit) pourrait atteindre le serveur, l'hôte ou les autres bots.
- **État** : en cours dans une autre session (H2, H3, H4, M2–M7, L1, L2, L4, L7, L10).
- **Modifications** : rien à ajouter ici ; ce ticket sert de **porte de sortie** : chaque correctif doit arriver avec
  son test dans `server/test/security-fixes.test.ts` (fichier existant).
- **Tests** : automatiques — un test par réf. (ex. H3 : `POST /containers/create` avec `Binds: ["/:/host"]` → 403 du
  proxy ; H2 : depuis un ordinateur de bot, `curl http://sklubot:3000/api/health` échoue, `/mcp/<son id>` répond ;
  M7 : corps de 10 Mo → 413). Manuel — `npm run desk:test` vert sur le VPS de test.
- **Statut (2026-11-18)** : fait (vérifié le 18/11) — H2, H3, M2–M7, L1, L2, L4, L7, L10 corrigés avec leurs tests (`server/test/security-review.test.ts`, `dockerproxy.test.ts`, `memory-guard.test.ts`, `public-signup.test.ts`) ; H4 accepté et atténué (voir 1.6). Reste manuel : `npm run desk:test` sur le VPS de test.
- **Effort** : L (déjà engagé). **Dépendances** : aucune.

#### SK-P0-02 · CI : lancer typecheck et tous les tests du serveur à chaque push
- **Pourquoi** : aujourd'hui une régression peut partir en production sans qu'aucun test ne tourne.
- **État** : `.github/workflows/desktop.yml` ne tourne que sur tags `desktop-v*` (`working-directory: companion`).
- **Modifications** : créer `.github/workflows/server.yml` (push + pull request) : Node 22, `npm ci`,
  `npm run typecheck`, `npm test -w server` (ou équivalent), tests web et `mobile/__tests__`. Job séparé, manuel,
  pour `desk:test` sur un runner avec Docker.
- **Tests** : une PR contenant une assertion volontairement fausse doit être rouge ; la même corrigée, verte.
- **Statut (2026-11-18)** : fait — `.github/workflows/ci.yml` (push + pull request : types, contrastes, tests web, taille des fichiers, build et bundle web, image des ordinateurs, `npm run test -w server`) ; `android.yml` (APK installée et essayée sur un émulateur) ; `desktop.yml`.
- **Effort** : S. **Dépendances** : aucune.

#### SK-P0-03 · Suite de tests d'isolation entre comptes
- **Pourquoi** : c'est la promesse n°1 d'un service multi-clients : le client B ne voit ni ne touche rien du client A.
- **État** : protection par `ownBot`/`accessBot` (`routes.ts:115-126`) ; tests ponctuels (`security.test.ts:296`).
- **Modifications** : nouveau `server/test/isolation.test.ts` : crée A (bot, routine, mémoire, compétence, coffre,
  connecteur, fichier, tâche, objectif, job, lien public, espace d'équipe) et B ; **parcourt automatiquement la table
  des routes de Hono** (`api.routes`) et appelle chaque route paramétrée avec les identifiants de A sous la session de
  B. Attendu : 404 (ou 403 pour un membre d'espace sans le droit), jamais 200 ni fuite de nom. Liste blanche explicite
  des routes publiques (`/health`, `/hooks/:token`, `/l/:token`, `/invites/:token`…). Côté SSE : B ne reçoit aucun
  événement de A (`bus.ts:43`).
- **Tests** : la suite elle-même ; une route ajoutée plus tard sans contrôle la fait échouer (car découverte
  automatiquement).
- **Statut (2026-11-16)** : fait — `server/test/isolation.test.ts` (routes découvertes dans `api.routes`/`site.routes`, comptes A, B et lecteur d'espace V, SSE). Correctif trouvé : `PATCH /workspaces/:wid` vide d'un lecteur répondait 200 (`workspaces.ts` update).
- **Effort** : M. **Dépendances** : SK-P0-02.

#### SK-P0-04 · Sauvegarde complète, hors du serveur, et restauration testée automatiquement
- **Pourquoi** : une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde ; et sans `SESSION_SECRET`,
  coffre et connexions sont perdus.
- **État** (vérifié dans `deploy/backup.sh`) : couvre le volume `sklubot_data` (base SQLite, bibliothèques, dossier
  d'équipe) et chaque `sklubot-home-*`. Ne couvre pas : `.env` (`SESSION_SECRET`, clés), `caddy_data` (certificats,
  réémis seuls : acceptable), `whisper_models` (retéléchargeables). Coupe le service pendant la copie. Pas de
  rotation, ni de copie distante, ni de chiffrement. `restore.sh` supprime tous les volumes `sklubot-home-*` puis
  restaure ceux de l'archive (correct, mais sans vérification après coup). `update.sh` ne sauvegarde pas avant.
- **Modifications** :
  1. `backup.sh` : ajouter `.env` **dans une archive chiffrée séparée** (`age` ou `openssl enc` avec une phrase de
     passe saisie à l'installation et non stockée sur le VPS) ; manifeste `SHA256SUMS` ; option `--keep N`
     (rotation) ; option `--remote` (rclone/S3/SFTP, cible dans `.env`).
  2. Base sans arrêt : copier la base avec `sqlite3 … ".backup"` / `VACUUM INTO` (cohérent en WAL) ; n'arrêter que
     les ordinateurs le temps de leur volume, un par un.
  3. `update.sh` : sauvegarde automatique avant `docker compose up --build`.
  4. Nouveau `deploy/restore-drill.sh` : restaure la dernière archive dans un **projet Compose isolé**
     (`-p sklubot-drill`, volumes préfixés, autre port), démarre, vérifie `PRAGMA integrity_check`, nombre de bots
     et d'utilisateurs identique au manifeste, déchiffrement d'un élément du coffre, `/api/health` vert ; puis détruit
     le projet. Rapport court par e-mail/push à l'opérateur.
  5. Mettre à jour `docs/SAUVEGARDE.md` (procédure et fréquence : sauvegarde chaque nuit, exercice chaque semaine).
- **Tests** : automatique — `server/test/deploy.test.ts` (existant) étendu : lancer backup puis restore-drill sur
  un Docker de CI avec 2 bots factices ; vérifier empreintes. Manuel — sur le VPS de test : supprimer volontairement
  `sklubot_data`, restaurer, se connecter, ouvrir un secret du coffre, réveiller un ordinateur de bot.
- **Statut (2026-11-16)** : fait (sauf rapport e-mail/push de l'exercice) — `backup.sh` (copie en ligne VACUUM INTO, ordinateurs en pause un par un, secrets chiffrés age/openssl, manifeste, SHA256SUMS, rotation, rclone/rsync), `restore-drill.sh` (projet isolé sans réseau), `update.sh` sauvegarde d'abord ; `docs/SAUVEGARDE.md` (VPS et Coolify) ; test `backup-drill.test.ts` (ignoré sans image serveur).
- **Effort** : M. **Dépendances** : SK-P0-01 (H3 change les appels Docker), SK-P0-08 (alertes).

#### SK-P0-05 · Migrations de base versionnées
- **Pourquoi** : avec des clients payants, une mise à jour qui casse la base est un incident grave ; il faut savoir
  dans quelle version est chaque base et tester le passage.
- **État** : schéma idempotent + `add()` de colonnes (`db.ts:10`, `db.ts:106`) ; pas de `user_version`.
- **Modifications** : `server/src/migrations/NNN-nom.ts` (fonction `up(db)`), table/`PRAGMA user_version`, exécution
  dans une transaction au démarrage, la migration 001 = le schéma actuel (ne change rien sur une base existante).
  Refus de démarrer si la base est plus récente que le code (retour arrière sans restauration).
- **Tests** : fixture `server/test/fixtures/db-<ancienne version>.sqlite` ; le test démarre dessus, vérifie
  `user_version` et l'intégrité ; test « base plus récente → refus clair ».
- **Statut (2026-11-16)** : fait — `server/src/migrations/` (001 = schéma b8096fa, 002 = coûts), copie avant migration, refus d'une base plus récente ; `migrations.test.ts` avec la base `fixtures/db-v0-b8096fa.sqlite.gz`.
- **Effort** : M. **Dépendances** : SK-P0-02.

#### SK-P0-06 · Coûts IA comptés juste pour tous les modèles
- **Pourquoi** : sans prix, un plan gratuit sur les clés de l'opérateur peut coûter sans limite : le budget et les
  points d'arrêt voient 0 $.
- **État** : table de prix codée en dur pour 4 modèles Claude (`usage.ts:19-24`) ; `grok-4.7`, `gpt-5`
  (`llm/index.ts:15-19`) sans prix ; usage des abonnements en mémoire (`usage.ts:11`).
- **Modifications** : table `model_prices` (modèle, fournisseur, prix entrée/sortie/cache, source, date) remplie par
  l'opérateur ; un modèle **serveur** sans prix est refusé (ou plafonné en tokens) tant qu'il n'est pas tarifé ;
  persister l'usage des abonnements (`subscription_usage`) ; budget mensuel en tokens en plus des dollars.
- **Tests** : un tour avec `grok-4.7` facturé > 0 ; budget à 0,01 $ → le tour suivant s'arrête avec la carte
  habituelle ; redémarrage → l'usage des abonnements est toujours affiché.
- **Statut (2026-11-16)** : fait autrement sur un point — un modèle sans prix n'est pas refusé : ses tokens sont comptés et le budget / les points d'arrêt le comptent au prix connu le plus élevé (« coût inconnu » à l'écran) ; prix officiels intégrés (Anthropic, xAI, OpenAI, sources dans `usage.ts`), prix fixés par le propriétaire (`model_prices`), `subscription_usage` persistant ; `costs.test.ts`. Reste : budget en tokens.
- **Effort** : M. **Dépendances** : aucune. **Prérequis du mode hébergé.**

#### SK-P0-07 · Scénarios de bout en bout : modèle démo (CI) et vrai modèle (sur demande, plafonné)
- **Pourquoi** : prouver qu'un agent reçoit une tâche, agit sur son ordinateur, termine et rend compte — pas seulement
  que chaque pièce marche seule.
- **État** : scénarios avec un modèle scripté (`test/app.test.ts`) ; mode démo (`llm/demo.ts`) ; test d'ordinateur
  sans modèle (`desktest.ts`).
- **Modifications** :
  1. `server/test/e2e-demo.test.ts` (en CI, gratuit) : inscription → bot → tâche « crée le fichier rapport.txt avec
     X puis dis-moi quand c'est fini » → carte d'accord → oui → fichier présent dans la bibliothèque → message final
     → ligne au journal d'actions et à l'usage. Variante routine webhook et objectif à 2 tours.
  2. `server/src/e2e-live.ts` + `npm run e2e:live` (jamais en CI par défaut) : `E2E_LIVE=1`, `E2E_MODEL=…`,
     `E2E_MAX_USD=0.50` obligatoires ; 5 missions fixes (fichier, lecture web d'une page locale, appel d'outil MCP de
     test, tâche de fond, refus d'une action irréversible). Coût réel mesuré avec SK-P0-06 ; arrêt si plafond atteint.
     Rapport JSON + Markdown (réussite, durée, coût, erreurs). Option ordinateur Linux réel.
- **Tests** : la CI fait passer (1) ; (2) lancé à la main avant chaque version : coût affiché < plafond, 5/5 réussies.
- **Effort** : M. **Dépendances** : SK-P0-02, SK-P0-06. Sert de base à SK-P2-03 (labo).

#### SK-P0-08 · Surveillance et alertes de base
- **Pourquoi** : savoir avant le client que le service est en panne, plein ou en erreur.
- **État** : `/api/health` ne vérifie rien (`routes.ts:194`) ; erreurs dans la console (`index.ts:71-72`) ;
  `memory-guard.sh` (swap/earlyoom).
- **Modifications** : `GET /api/health/deep` (jeton opérateur) : base accessible, proxy Docker joignable, disque de
  `/data` < seuil, file `bot_queue` sans élément bloqué > 30 min, dernier backup < 26 h, erreurs des 15 dernières
  min. `GET /metrics` au format Prometheus sur le réseau interne (tours, erreurs, coût, ordinateurs allumés, SSE
  ouverts). Journaux JSON avec rotation (Docker `max-size`). Alertes : e-mail/push à l'opérateur sur seuils ;
  documentation d'un moniteur externe (Uptime Kuma auto-hébergé ou service tiers) sur `/api/health`.
- **Tests** : unitaires sur chaque vérification (proxy coupé → `docker: down`) ; manuel : arrêter `docker-proxy`,
  recevoir l'alerte en < 5 min.
- **Statut (2026-11-18)** : fait en grande partie — `/api/health` vérifie base, Docker, disque, planificateur, sauvegarde, file (`monitor.ts`), détail pour le propriétaire (`GET /api/health/deep`) ; Sentinelle : analyse sans IA toutes les 10 min, incidents regroupés, alertes push/e-mail sans doublon, page Surveillance (`server/src/sentinel/`, `sentinel.test.ts`, `monitor.test.ts`). Reste : `/metrics` Prometheus, journaux JSON.
- **Effort** : M. **Dépendances** : SK-P1-01 (rôle opérateur) pour les alertes ciblées.

#### SK-P0-09 · MFA à la connexion (TOTP) et codes de secours
- **Pourquoi** : un compte client volé donne accès à ses bots, son coffre et ses ordinateurs.
- **État** : RFC 6238 déjà implémenté (`totp.ts`), utilisé seulement pour le coffre.
- **Modifications** : colonnes `users.totp_enc`, `users.totp_enabled_at`, table `recovery_codes` (hachés) ; routes
  `POST /auth/mfa/setup` (QR `otpauth://`), `/auth/mfa/enable` (vérifie un code), `/auth/mfa/disable` (mot de passe
  + code) ; connexion en 2 temps (jeton intermédiaire court, limite de tentatives existante `routes.ts:205`) ;
  reconnaissance de l'appareil 30 j facultative ; MFA imposable par l'owner d'un espace d'équipe. UI : Réglages →
  Compte. Connexion Google : MFA aussi demandée si activée.
- **Tests** : code juste/faux/rejoué (même pas de temps refusé deux fois) ; code de secours à usage unique ;
  10 essais → blocage ; test d'isolation : session intermédiaire inutilisable sur `/api/*`.
- **Statut (2026-11-18)** : fait — `twofactor.ts` : TOTP (RFC 6238, graine scellée), 10 codes de secours à usage unique (hachés), connexion en 2 temps pour toutes les entrées (mot de passe, Google, lien par e-mail, réinitialisation, appli mobile), jeton intermédiaire 5 min / 5 essais, Réglages → Compte (`web/src/components/TwoFactor.tsx`), désactivation en ligne de commande (`reset-password.js --disable-2fa`) ; `totp.test.ts`. Reste : MFA imposable par l'owner d'un espace, appareil reconnu 30 j.
- **Effort** : M. **Dépendances** : SK-P0-03.

#### SK-P0-10 · Récupération de compte et e-mails système
- **Pourquoi** : aujourd'hui, un mot de passe oublié exige l'accès SSH au serveur (`reset-password.ts`).
- **État** : pas d'e-mail système ; M5 (vérification d'adresse) en cours ; le serveur sait envoyer des e-mails via
  un relais SMTP par utilisateur (`db.ts:395`), pas pour lui-même.
- **Modifications** : réglage SMTP **opérateur** (`.env` : `SYSTEM_SMTP_*`) ; module `server/src/sysmail.ts` ; lien
  de réinitialisation (jeton haché, 30 min, usage unique, toutes sessions coupées) ; MFA active → code TOTP ou de
  secours exigé en plus ; e-mail d'alerte « nouvelle connexion » ; réutiliser le flux de M5 pour la vérification.
- **Tests** : jeton expiré/réutilisé refusé ; réponse identique que l'adresse existe ou non ; sessions supprimées
  après changement.
- **Statut (2026-11-18)** : fait en grande partie — SMTP du serveur réglable par le propriétaire ou repris du relais des bots (`accountmail.ts`, `1b2a72b`) ; « Mot de passe oublié ? » (jeton haché, 30 min, usage unique, toutes les sessions coupées, même réponse que l'adresse existe ou non) ; changement d'adresse confirmé ; vérification d'e-mail (M5) ; lien de connexion par e-mail (`emaillink.ts`) ; 2FA exigée après réinitialisation ; `account-mail.test.ts`, `email-link.test.ts`. Reste : e-mail « nouvelle connexion ».
- **Effort** : M. **Dépendances** : M5 (en cours), SK-P0-09.

#### SK-P1-01 · Rôle opérateur et page d'administration du serveur
- **Pourquoi** : pour vendre, quelqu'un doit voir et gérer tous les comptes (suspendre, quotas, état).
- **État** : aucune notion d'administrateur global.
- **Modifications** : `users.is_operator` (attribué en ligne de commande, jamais par l'interface) ; routes
  `/api/admin/*` (comptes, usage, ordinateurs, santé) avec MFA obligatoire ; page `web/src/components/Admin.tsx` ;
  chaque action d'opérateur dans un journal non modifiable.
- **Tests** : un non-opérateur reçoit 404 sur `/api/admin/*` (ajouté à SK-P0-03) ; opérateur sans MFA → refus.
- **Statut (2026-11-16)** : partiel, en mode hébergé — colonne `users.server_role` (la propriétaire est toujours opératrice), page Administration (clients, offres, invitations, réglages, journal non modifiable `admin_audit`), 404 pour les autres comptes, couvert par `isolation-hosted.test.ts`. Reste : MFA exigée des opérateurs (SK-P0-09), vue opérateur hors mode hébergé.
- **Statut (2026-11-18)** : toujours partiel — en plus : déconnexion d'un client partout par l'opérateur (`POST /api/admin/customers/:uid/sessions/revoke`, `twofactor.ts`). Reste : 2FA **exigée** des opérateurs (pas trouvée dans le code), vue opérateur hors mode hébergé.
- **Effort** : M. **Dépendances** : SK-P0-09. Prérequis du mode hébergé.

#### SK-P1-02 · Sessions : appareils connectés et révocation
- **Pourquoi** : pouvoir couper un téléphone perdu.
- **État** : sessions de 30 j hachées (`auth.ts:22-27`), pas de liste.
- **Modifications** : `sessions` + `user_agent`, `ip`, `last_seen_at` ; `GET/DELETE /api/sessions` ; « se
  déconnecter partout » ; ré-authentification récente exigée pour les actions sensibles (changer MFA, exporter,
  supprimer le compte).
- **Tests** : révoquer une session → 401 immédiat sur SSE et API.
- **Statut (2026-11-18)** : partiel — « Se déconnecter de tous les autres appareils » (`POST /api/account/sessions/revoke-others`, `twofactor.ts`) et nombre de sessions ; l'opérateur peut déconnecter un client partout. Reste : liste des appareils (navigateur, IP, dernière activité) et révocation d'un appareil précis, ré-authentification avant les actions sensibles.
- **Effort** : S. **Dépendances** : aucune.

#### SK-P1-03 · Tests de charge
- **Pourquoi** : savoir combien de clients un VPS supporte avant de les vendre.
- **État** : aucun ; un processus, SQLite WAL (`db.ts:8`), `MAX_DESKTOPS=4` par défaut.
- **Modifications** (plan repris de la revue de sécurité) : `server/load/` avec 4 scénarios :
  1. **N ordinateurs** : 4, 8, 16, 24 conteneurs allumés ; mesurer RAM/CPU, temps de réveil, OOM.
  2. **Tempête de réveil** : 50 routines à la même minute → file d'attente, aucun double déclenchement, attente
     annoncée (`linux.ts:185`).
  3. **SSE en éventail** : 200 connexions SSE, 20 bots qui écrivent → latence p95 des événements, mémoire.
  4. **Endurance** : 12 h avec modèle démo, 20 bots, routines toutes les 5 min → fuite mémoire, taille base/WAL,
     descripteurs de fichiers.
  Outils : script Node (pas de dépendance lourde) + `docker stats`. Résultat : `docs/CAPACITE.md` (ordinateurs par
  Go de RAM, comptes par VPS).
- **Tests** : seuils écrits (p95 SSE < 1 s, 0 double déclenchement, RAM stable ± 10 % sur 12 h).
- **Effort** : L. **Dépendances** : SK-P0-01 (H2/H4/M2 changent la consommation), SK-P0-08 (métriques).

#### SK-P1-04 · Inventaire des licences
- **Pourquoi** : vendre un service qui embarque du code et des modèles tiers impose de respecter leurs licences.
- **État** : MIT pour Sklubot ; attributions DeepSeek présentes dans le code ; pas d'inventaire.
- **Modifications** : `scripts/licences.mjs` (lit `node_modules/*/package.json` de server, web, companion, mobile)
  → `THIRD_PARTY_NOTICES.md` ; échec si GPL/AGPL/SSPL/licence inconnue dans le code servi ; inventaire des paquets
  de l'image `docker/desktop` (`dpkg-query`) et des voix Piper / modèles whisper (licences propres à chaque voix) ;
  vérifier la licence d'Agent Reach et de `docker-socket-proxy`. Page « Licences » dans l'appli.
- **Tests** : étape de CI ; une dépendance AGPL ajoutée volontairement → rouge.
- **Effort** : S–M. **Dépendances** : SK-P0-02.

#### SK-P1-05 · Conditions des fournisseurs (vérification à faire, pas de code d'abord)
- **Pourquoi** : utiliser des abonnements Claude/ChatGPT pour les bots de **clients** pourrait être interdit ;
  revendre l'accès aux clés API de l'opérateur a aussi des règles.
- **État** : la doc limite déjà à l'usage personnel (`docs/INSTALLATION-VPS.md:240-241`). **Non vérifié** contre
  les conditions en vigueur.
- **Modifications** : note `docs/CONDITIONS-FOURNISSEURS.md` qui cite les textes officiels (conditions
  commerciales et grand public d'Anthropic et d'OpenAI, conditions xAI, Google OAuth — vérification d'appli et
  audit de sécurité pour les portées Gmail restreintes) avec date de lecture ; décision écrite. Dans le code, en
  mode hébergé : moteurs « abonnement » réservés au BYO (le client se connecte lui-même sur l'ordinateur de son
  bot) et désactivables par l'opérateur (`HOSTED_ALLOW_SUBSCRIPTION_ENGINES=0`).
- **Tests** : en mode hébergé avec le drapeau à 0, la liste des modèles ne propose plus Claude Code/Codex.
- **Effort** : S (code) + temps de lecture/juridique. **Dépendances** : aucune ; à faire **avant** l'ouverture.

#### SK-P1-06 · Notifications distantes de l'appli mobile et tests sur appareil réel
- **Pourquoi** : un client attend d'être prévenu sur son téléphone quand un bot a besoin de lui.
- **État** : Web Push côté serveur (`push.ts`) ; appli Expo en notifications **locales** seulement
  (`mobile/app.config.ts:54,70`).
- **Modifications** : `enableRemoteNotifications: true`, enregistrement du jeton FCM (Android) / APNs (iOS) vers une
  nouvelle table `native_push_tokens`, envoi depuis `push.ts` ; procédure de test manuelle sur 2 appareils Android
  réels (Android 13+ autorisation de notification, appli tuée, mode économie).
- **Tests** : unitaires sur l'envoi (faux FCM local) ; manuel : carte d'accord → notification en < 10 s, appli fermée.
- **Statut (2026-11-18)** : inchangé — notifications locales seulement (`mobile/app.config.ts` : `enableRemoteNotifications: false`) ; test automatique sur émulateur Android fait en CI (`.github/workflows/android.yml`). Bloqué par un compte Firebase (FCM) / APNs.
- **Effort** : M. **Dépendances** : SK-P1-05 (conditions Google/Apple).

### Phase H — Mode hébergé (commercialisation, avant le multi-VPS)

Prérequis : SK-P0-01, -03, -04, -06, -09, -10, SK-P1-01, SK-P1-05.

#### SK-P0-11 · Comptes clients, plans et statuts
- **Pourquoi** : savoir qui paie quoi et ce qu'il a le droit d'utiliser.
- **État** : rien (vérifié).
- **Modifications** : tables `plans` (id, nom, prix, bots max, ordinateurs simultanés max, disque, budget IA mensuel,
  modèles autorisés, clés opérateur oui/non, places d'équipe) et `subscriptions` (compte ou espace payeur, plan,
  statut `trial | active | past_due | suspended | canceled`, dates, fournisseur de paiement, référence externe).
  `HOSTED_MODE=1` active tout ; sans lui, comportement actuel inchangé (auto-hébergé). Décider : le payeur est
  **l'utilisateur** (simple) ou **l'espace d'équipe** (multi-entreprises) — recommandation : l'espace, avec un espace
  personnel créé d'office.
- **Tests** : transitions de statut (tableau de cas) ; `HOSTED_MODE=0` → toute la suite existante reste verte.
- **Statut (2026-11-16)** : fait — tables `plans`, `subscriptions` (migration 4), payeur = l'utilisateur (simple ; l'espace d'équipe reste possible plus tard), statuts trial → active → past_due → suspended avancés par le planificateur, `hosted.test.ts` + `hosted-off.test.ts`. Voir `docs/MODE-HEBERGE.md`.
- **Effort** : L. **Dépendances** : SK-P0-05.

#### SK-P0-12 · Quotas appliqués côté serveur
- **Pourquoi** : un plan ne vaut que s'il est respecté par le code, pas par l'interface.
- **État** : `MAX_BOTS` global (`config.ts:148`), `MAX_DESKTOPS` global, budget mensuel par compte (`usage.ts:97`).
- **Modifications** : un module `server/src/quotas.ts` appelé à la création de bot, au réveil d'ordinateur
  (`linux.ts`), avant chaque tour (`agent/loop.ts` à côté de `overBudget`), à l'écriture de fichiers (avec M2) ;
  carte « limite du plan » avec remède (changer de plan) ; suspension → bots en pause, ordinateurs endormis, données
  gardées.
- **Tests** : un test par quota ; compte suspendu → aucun tour ne démarre, routine sautée et notée.
- **Statut (2026-11-16)** : fait dans `hosted.ts` (bots, routines actives, ordinateurs allumés, stockage ; suspendu = lecture seule ; carte avec la façon d'avancer). La vérification d'e-mail avant le premier tour (anti-abus) reste à faire. — **2026-11-18** : faite (M5 : accès bloqué côté serveur tant que l'adresse n'est pas confirmée, premier bot après confirmation, `publicsignup.ts`).
- **Effort** : M. **Dépendances** : SK-P0-11, SK-P0-06.

#### SK-P0-13 · Clés opérateur (plan gratuit) et BYOK
- **Pourquoi** : le plan gratuit consomme les clés de l'opérateur ; les autres plans peuvent apporter leurs clés.
- **État** : fournisseurs d'API par compte existent (`db.ts:508`, `providers` par utilisateur) ; clés serveur dans
  `.env`.
- **Modifications** : le plan dit quels modèles serveur sont permis et avec quel budget ; les clés du client
  (existant) ne comptent pas dans le budget opérateur mais restent mesurées ; plafond dur par jour sur les clés
  opérateur ; anti-abus : vérification d'e-mail obligatoire (M5) avant le premier tour.
- **Tests** : compte gratuit au budget atteint → refus ; même compte avec sa propre clé → passe.
- **Statut (2026-11-16)** : fait autrement sur un point — un budget mensuel en € par offre (plus recharges) au lieu d'un plafond par jour ; coupure nette au budget atteint, y compris au milieu d'un tour ; « J'apporte ma clé » ne retombe jamais sur les clés du service ; fournisseurs de l'opérateur prêtables aux comptes hébergés.
- **Effort** : M. **Dépendances** : SK-P0-06, SK-P0-12.

#### SK-P1-07 · Paiement : manuel d'abord, puis Paddle
- **Pourquoi** : encaisser, facturer, relancer, suspendre.
- **Modifications** : interface `PaymentProvider` (`server/src/billing/`), implémentation « manuelle » (l'opérateur
  marque payé dans la page admin, facture PDF numérotée) ; puis Paddle (webhooks signés, idempotence par
  identifiant d'événement, statut `past_due` → délai de grâce → `suspended`). Paddle (vendeur officiel) gère la TVA
  européenne. Ne pas inventer d'API : citer la doc officielle dans le code, comme le reste du dépôt.
- **Tests** : webhooks rejoués (même événement deux fois → un seul effet), signature fausse → 400.
- **Statut (2026-11-16)** : partiel — interface `billing/provider.ts`, fournisseur « manuel » (l'opérateur marque payé), table `billing_events` prête pour l'idempotence, `POST /api/billing/webhook/stripe|paddle` → 501. Fournisseur à choisir ; pas encore de factures PDF.
- **Statut (2026-11-18)** : fournisseur choisi : **Paddle** (vendeur officiel). Les **crédits prépayés** se paient par Paddle (`billing/paddle.ts`, `credits.ts` : transaction créée par le serveur, page `/paiement`, webhook signé `POST /api/billing/paddle/webhook`, remboursements) ; l'adaptateur Stripe écrit auparavant est retiré sans avoir servi. Les abonnements payants restent manuels.
- **Effort** : L. **Dépendances** : SK-P0-11, SK-P1-01.

#### SK-P1-08 · Pages publiques : tarifs, mentions légales, CGV, confidentialité
- **Modifications** : page tarifs générée depuis la table `plans` ; modèles de CGV/CGU, DPA (sous-traitant RGPD),
  mentions ; la page de confidentialité existe (`privacy.ts`) et doit être étendue au mode hébergé (sous-traitants :
  fournisseurs de modèles, hébergeur, paiement).
- **Tests** : pages servies sans session ; liens présents à l'inscription.
- **Statut (2026-11-16)** : fait — `/tarifs` et `/pricing` générés depuis les offres, modèles `/cgu` (+ `/terms`) et `/mentions-legales` (+ `/legal-notice`) marqués « Brouillon — à faire valider par un professionnel », case CGU obligatoire à l'inscription. Reste : DPA, extension de `/confidentialite` au service, relecture juridique.
- **Effort** : M. **Dépendances** : SK-P0-11. Relecture juridique hors code.

### Phase 2 — Infrastructure répartie (4 VPS)

À démarrer **après** les ordinateurs partagés (en cours) et le mode hébergé.

#### SK-P0-14 · Décision d'architecture : stockage des bibliothèques sur plusieurs machines
- **Pourquoi** : aujourd'hui l'ordinateur d'un bot monte sa bibliothèque et le dossier d'équipe depuis le disque du
  serveur central (`linux.ts:54`, `linux.ts:269-270`). Sur une autre machine, ce montage n'existe pas.
- **Options** : (a) la bibliothèque vit sur le nœud du bot, le serveur y accède par l'agent du nœud (simple, pas de
  système de fichiers réseau, mais le dossier d'équipe partagé entre bots de nœuds différents devient difficile) ;
  (b) NFS/SSHFS à travers WireGuard (transparent, mais lent et fragile si le lien tombe) ; (c) synchronisation
  (lourd). Recommandation : (a), avec la règle « tous les bots d'un même compte sur le même nœud » tant que le dossier
  d'équipe est actif.
- **Livrable** : `docs/adr/multi-vps.md` (décision, conséquences sur sauvegarde, placement, panne).
- **Effort** : S. **Dépendances** : ordinateurs partagés terminés.

#### SK-P0-15 · Réseau privé WireGuard entre les 4 VPS
- **Modifications** : `deploy/node-install.sh` (installe Docker, WireGuard, le proxy Docker filtrant, l'agent du
  nœud) ; clés WireGuard générées sur chaque nœud, seule la clé publique échangée ; pare-feu : le proxy Docker et
  l'agent n'écoutent **que** sur l'interface `wg0`, jamais sur l'IP publique.
- **Tests** : depuis Internet, port du proxy fermé (scan) ; depuis le central, `docker version` via `wg0` répond ;
  depuis un ordinateur de bot sur un nœud, le réseau WireGuard est inaccessible (même règle que H2).
- **Effort** : M. **Dépendances** : SK-P0-14, SK-P0-01 (H2/H3).

#### SK-P0-16 · Docker distant par nœud à travers le proxy filtrant
- **Modifications** : table `nodes` (id, nom, IP wg, CPU, RAM, GPU, disque, `max_desktops`, statut, `last_seen_at`,
  version) ; `linux.ts` reçoit un `DOCKER_HOST` **par machine** au lieu d'un global ; colonne `bots.node_id` ;
  chaque nœud a son propre proxy avec le filtrage du corps (H3) — jamais le socket exposé. `ENGINE_BASE_URL` et le
  relais d'identifiants (`egress.ts`) joignables depuis les nœuds par WireGuard, avec les mêmes jetons par
  ordinateur.
- **Tests** : intégration avec 2 démons Docker (dind en CI) : créer/réveiller/endormir un ordinateur sur le nœud 2 ;
  l'outil MCP du bot répond ; `desk:test` sur un nœud choisi.
- **Effort** : L. **Dépendances** : SK-P0-15.

#### SK-P1-09 · Placement et répartition de charge
- **Modifications** : `server/src/placement.ts` : au premier réveil, choisir le nœud (contrainte « même compte même
  nœud » si dossier d'équipe, besoin GPU, RAM libre réelle remontée par l'agent, `max_desktops`) ; ensuite
  **collant** (le volume est local) ; déplacement manuel par l'opérateur = sauvegarde du volume → copie →
  restauration (réutilise SK-P0-04). File d'attente par nœud au lieu de globale (`linux.ts:185`).
- **Tests** : unitaires sur la fonction de choix (cas : nœud plein, nœud hors ligne, GPU requis) ; déplacement d'un
  bot entre 2 nœuds dind → fichiers identiques.
- **Effort** : L. **Dépendances** : SK-P0-16.

#### SK-P1-10 · Panne d'un nœud
- **Modifications** : battement de cœur de l'agent (30 s) ; nœud muet 2 min → statut `down`, les bots concernés
  reçoivent une carte « ordinateur indisponible » (jamais d'impasse : remèdes « attendre », « continuer sans
  ordinateur », « déplacer depuis la dernière sauvegarde ») ; tours en cours marqués « incertain » (mécanisme
  existant `agent/executions.ts`) ; alerte opérateur (SK-P0-08) ; sauvegarde par nœud.
- **Tests** : couper le démon d'un nœud en plein tour → carte affichée, aucun rejeu automatique d'action.
- **Effort** : M. **Dépendances** : SK-P1-09, SK-P0-08.

### Phase 3 — Intelligence des agents

#### SK-P1-11 · Mémoire de projet avec permissions et recherche plein texte
- **Pourquoi** : plusieurs bots et personnes d'une équipe doivent partager des connaissances, sans tout partager.
- **État** : mémoire par bot (`db.ts:55`) avec source et statut ; recherche par mots (`agent/tools.ts:899-907`).
- **Modifications** : table `memory_spaces` (portée : bot, compte, espace d'équipe, projet) + droits par rôle
  (lecture / écriture / validation) ; `memories.space_id`, `source_url`, `decided_by`, historique des versions ;
  index **FTS5** SQLite (sans dépendance) ; outils `memory_search` étendus à la portée ; page d'édition dans
  l'interface. Recherche sémantique (embeddings) en P2, seulement après mesure du besoin.
- **Tests** : un viewer ne peut pas écrire ; un bot d'un autre espace ne trouve rien (ajout à SK-P0-03) ; FTS
  trouve « facturation » pour « factures ».
- **Effort** : L. **Dépendances** : SK-P0-03, SK-P0-05.

#### SK-P2-01 · Compétences versionnées et partageables entre comptes
- **Modifications** : `skill_versions` (historique, retour à une version), export/import d'un paquet de compétence
  signé (base d'une future place de marché).
- **Effort** : M. **Dépendances** : SK-P1-11.

#### SK-P2-02 · Labo d'évaluation des modèles
- **Pourquoi** : choisir le modèle le moins cher qui réussit une mission, avec des chiffres.
- **Modifications** : réutilise le moteur de SK-P0-07 (missions fixes, bac à sable, plafond de coût) ; table
  `eval_runs` (modèle, mission, réussite, durée, coût, erreurs, note d'un relecteur automatique + note humaine) ;
  page de comparaison ; jamais sur des données de clients.
- **Tests** : un run sur 2 modèles produit un tableau complet ; plafond respecté.
- **Effort** : L. **Dépendances** : SK-P0-07, SK-P0-06.

#### SK-P2-03 · Choix automatique du modèle par type de mission
- **Modifications** : à partir des résultats du labo, proposer (pas imposer) un modèle par type de tâche ; la liste
  de secours existante (`agent/reliability.ts:13`) reste le filet.
- **Effort** : M. **Dépendances** : SK-P2-02.

### Phase 4 — Expérience

#### SK-P1-12 · Centre de commande
- **Pourquoi** : voir d'un coup d'œil ce que font tous les bots et agir sur plusieurs à la fois.
- **État** : les données existent (live, tâches, objectifs, jobs, usage, journal, ordinateurs) mais dispersées.
- **Modifications** : `GET /api/overview` (une réponse agrégée par compte/espace : bots et état, ce qu'ils attendent,
  objectifs, jobs, ordinateurs et nœud, coût du jour/mois, dernières erreurs) mise à jour par SSE ; page
  `web/src/components/CommandCenter.tsx` ; actions groupées : pause, reprise, arrêt (réutilise `interrupt`,
  `pauseGoalsOf`, `stopJob`) ; vue opérateur (tous les comptes) dans la page admin.
- **Tests** : unitaires sur l'agrégat ; e2e démo : lancer 3 bots, « tout mettre en pause » → aucun nouveau tour.
- **Effort** : L. **Dépendances** : SK-P1-01 (vue opérateur), SK-P1-09 (nœud affiché, plus tard).

#### SK-P1-13 · API publique avec clés d'API et webhooks sortants
- **Pourquoi** : les clients veulent brancher Sklubot à leurs outils.
- **État** : API par cookie seulement (`docs/API.md:3-5`) ; webhooks entrants (`routes.ts:319`).
- **Modifications** : table `api_keys` (hachée, préfixe visible, portées : lire, parler, gérer ; espace ; date
  d'expiration ; dernière utilisation) ; en-tête `Authorization: Bearer` accepté sur une liste blanche de routes
  `/api/v1/*` stables ; limite de fréquence par clé ; webhooks sortants signés (HMAC, horodatage, nouvelles tentatives)
  sur événements (tâche finie, accord demandé, objectif terminé) ; `docs/API.md` généré depuis les routes.
- **Tests** : clé sans portée « gérer » → 403 ; clé révoquée → 401 ; signature vérifiable ; isolation (SK-P0-03).
- **Statut (2026-11-18)** : partiel — clés d'API par bot (hachées, portées `read` / `write` / `tasks`), API REST `/api/v1` et serveur MCP de pilotage (`botapi.ts`, `botmcp.ts`, `docs/API-BOT.md`, `bot-api.test.ts`). Reste : webhooks sortants, clés au niveau du compte.
- **Effort** : L. **Dépendances** : SK-P0-03, SK-P1-01.

#### SK-P2-04 · Constructeur visuel de workflows (sur les routines et objectifs existants)
- **Pourquoi** : enchaîner déclencheur → agent → navigateur → outil → validation humaine → résultat sans tout
  confier au modèle.
- **État** : déclencheurs, validation, reprise, attente entre bots déjà là.
- **Modifications** : modèle `workflows` / `workflow_steps` (type d'étape, entrée, condition, nombre d'essais, étape
  en cas d'erreur) stocké en JSON versionné ; exécuteur qui s'appuie sur `bot_queue` (une étape = un tour ou un
  appel d'outil) et sur le journal d'actions ; boucles bornées ; carte « bloqué » avec remède à chaque arrêt ; éditeur
  graphique (React Flow, licence MIT — à vérifier avec SK-P1-04). Commencer par un éditeur en liste (plus simple),
  graphique ensuite.
- **Tests** : workflow de 4 étapes avec condition et échec simulé → la branche d'erreur s'exécute ; redémarrage au
  milieu → reprise à la bonne étape.
- **Effort** : XL. **Dépendances** : SK-P0-07, SK-P1-12.

#### SK-P2-05 · Recherche dans les fichiers (bibliothèque et dossier d'équipe)
- **Modifications** : index FTS5 des textes extraits (PDF, Office : `office.ts` existe), mis à jour à l'écriture ;
  respect des droits de l'espace.
- **Effort** : M. **Dépendances** : SK-P1-11.

#### SK-P2-06 · Place de marché d'agents et de compétences ; format de plugin
- **Modifications** : paquet signé (bot + compétences + connecteurs requis, **sans secrets**), revue par l'opérateur,
  installation en un clic ; avertissement « contenu extérieur » appliqué aux compétences importées (mécanisme
  `outside` existant).
- **Effort** : XL. **Dépendances** : SK-P2-01, SK-P1-13.

---

## 4. Tableau récapitulatif

| ID | Titre | Phase | Effort | Dépend de |
|---|---|---|---|---|
| SK-P0-01 | Correctifs revue de sécurité (**fait**, H4 accepté) | 1 | L | — |
| SK-P0-02 | CI des tests serveur (**fait**) | 1 | S | — |
| SK-P0-03 | Tests d'isolation entre comptes (**fait**) | 1 | M | 02 |
| SK-P0-04 | Sauvegarde complète + restauration testée (**fait** ; + sauvegarde S3 automatique) | 1 | M | 01, 08 |
| SK-P0-05 | Migrations versionnées (**fait**) | 1 | M | 02 |
| SK-P0-06 | Coûts IA justes pour tous les modèles (**fait** ; plafonds en jetons : `usagecaps.ts`) | 1 | M | — |
| SK-P0-07 | Bout en bout démo + vrai modèle | 1 | M | 02, 06 |
| SK-P0-08 | Surveillance et alertes (**fait**, sauf `/metrics`) | 1 | M | P1-01 |
| SK-P0-09 | MFA TOTP + codes de secours (**fait**) | 1 | M | 03 |
| SK-P0-10 | Récupération de compte, e-mails système (**fait**, sauf alerte « nouvelle connexion ») | 1 | M | 09, M5 |
| SK-P1-01 | Rôle opérateur, page admin (partiel : 2FA des opérateurs non exigée) | 1 | M | 09 |
| SK-P1-02 | Appareils connectés, révocation (partiel : « déconnecter les autres », pas de liste) | 1 | S | — |
| SK-P1-03 | Tests de charge | 1 | L | 01, 08 |
| SK-P1-04 | Inventaire des licences | 1 | S–M | 02 |
| SK-P1-05 | Conditions des fournisseurs | 1 | S + lecture | — |
| SK-P1-06 | Notifications mobiles distantes (bloqué : compte FCM/APNs) | 1 | M | P1-05 |
| SK-P0-11 | Plans et statuts (**fait**) | H | L | 05 |
| SK-P0-12 | Quotas côté serveur (**fait**) | H | M | 11, 06 |
| SK-P0-13 | Clés opérateur / BYOK (**fait**) | H | M | 06, 12 |
| SK-P1-07 | Paiement manuel puis Paddle (crédits par Paddle **faits**, cachés sans `PADDLE_*` ; abonnements manuels) | H | L | 11, P1-01 |
| SK-P1-08 | Tarifs et pages légales (**fait**, relecture juridique à faire) | H | M | 11 |
| SK-P0-14 | Décision stockage multi-VPS | 2 | S | ordinateurs partagés |
| SK-P0-15 | WireGuard entre VPS | 2 | M | 14, 01 |
| SK-P0-16 | Docker distant par nœud | 2 | L | 15 |
| SK-P1-09 | Placement / répartition | 2 | L | 16 |
| SK-P1-10 | Panne d'un nœud | 2 | M | P1-09, 08 |
| SK-P1-11 | Mémoire de projet avec droits + FTS | 3 | L | 03, 05 |
| SK-P2-01 | Compétences versionnées | 3 | M | P1-11 |
| SK-P2-02 | Labo d'évaluation | 3 | L | 07, 06 |
| SK-P2-03 | Choix auto du modèle | 3 | M | P2-02 |
| SK-P1-12 | Centre de commande | 4 | L | P1-01 |
| SK-P1-13 | API publique + webhooks sortants (partiel : API par bot faite) | 4 | L | 03, P1-01 |
| SK-P2-04 | Constructeur de workflows | 4 | XL | 07, P1-12 |
| SK-P2-05 | Recherche dans les fichiers | 4 | M | P1-11 |
| SK-P2-06 | Place de marché / plugins | 4 | XL | P2-01, P1-13 |

---

## 5. Ordre recommandé pour les 4 à 6 prochaines sessions

1. **Session 1 (maintenant, en parallèle de la sécurité)** — SK-P0-02 (CI) puis SK-P0-06 (prix des modèles).
   Pourquoi : petits, sans conflit avec les fichiers en cours de modification (`usage.ts` et `llm/index.ts` ne sont
   pas touchés par l'autre session), et ils protègent tout le reste. Ne pas toucher `routes.ts`/`linux.ts` tant que
   l'autre session n'a pas fini.
2. **Session 2** — fin de SK-P0-01 et des ordinateurs partagés (session en cours) ; ajouter SK-P0-03 (isolation)
   juste après, car les ordinateurs partagés créent justement de nouveaux chemins d'accès entre bots.
3. **Session 3** — SK-P0-04 (sauvegarde + exercice de restauration) et SK-P0-05 (migrations). Avant d'avoir le
   premier client, pas après.
4. **Session 4** — SK-P0-09, SK-P0-10, SK-P1-01, SK-P1-02 (comptes sûrs + opérateur), SK-P0-08 (surveillance) et
   SK-P0-07 (bout en bout). En parallèle, hors code : SK-P1-05 (conditions des fournisseurs) et SK-P1-04 (licences).
5. **Session 5** — mode hébergé : SK-P0-11, SK-P0-12, SK-P0-13, paiement manuel (début de SK-P1-07), SK-P1-08.
   Ouverture possible à quelques clients pilotes, sur un seul VPS, avec SK-P1-03 (charge) pour fixer les limites
   des plans sur des chiffres mesurés.
6. **Session 6** — SK-P0-14 (décision écrite), puis SK-P0-15 et SK-P0-16 : premier nœud supplémentaire. Le centre de
   commande (SK-P1-12) peut démarrer ensuite, quand l'information « sur quelle machine » existe.

Ce qui peut attendre sans risque : labo d'évaluation, constructeur de workflows, place de marché, recherche
sémantique. Ils font vendre, mais ne protègent ni les clients ni l'opérateur.
