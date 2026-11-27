# Audit complet : code-with-antonio/ai-teammates comparé à Sklubot

Date : 22/11/2026. Lecture seule. Rien n'a été modifié dans Sklubot.
Dépôt lu : `code-with-antonio/ai-teammates`, commit `de32f46` (11/10/2026), 712 fichiers dont ~3 300 lignes de code propre (le reste : composants d'interface génériques et 29 compétences de développement pour l'agent qui a écrit le projet). Tout le code propre a été lu : tour de discussion, outils de la machine, passage de relais, mémoire, comptage de l'usage, schéma de base, actions serveur, écrans. Rien n'a été exécuté.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 26 |
| PARTIEL | 6 |
| MANQUANT | 2 |
| DIFFÉRENT | 7 |
| NON REPRIS | 3 |
| Non vérifié (voir § 5) | 1 |
| **Total** | **45** |

Lecture rapide : c'est un **petit projet de démonstration** (tutoriel vidéo) qui imite le concept « coéquipier IA avec son propre ordinateur ». Il s'appuie entièrement sur des services payants (machines en nuage, authentification et facturation, tâches durables, base serverless, passerelle de modèle). Sklubot couvre déjà presque tout, souvent plus solidement. Trois petites idées valent le coup : (1) séparer **« regarder l'écran pour soi »** de **« montrer l'écran à l'utilisateur »** ; (2) arrêter un tour **dès que l'allocation restante est dépensée**, calculé pas à pas ; (3) **découper une réponse** en plusieurs bulles signées quand un relais change d'auteur en plein tour.

---

## 1. Licence

**Aucun fichier LICENSE**, aucun champ de licence dans `package.json`. Par défaut, tous droits réservés : **rien ne peut être copié**, idées seulement. Le README se présente comme « alternative libre » à des produits fermés, mais sans licence ce n'est pas juridiquement libre. Les 29 compétences du dossier `.agents/skills` viennent d'éditeurs tiers (authentification, tâches durables, interface) ; leurs licences propres n'ont pas été vérifiées et elles ne servent qu'au développement.

---

## 2. Tableau complet

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 1 | Bots | Créer un bot : nom, métier, consignes, avatar généré | FAIT | `POST /bots` (`server/src/routes.ts`), `web/src/components/Modals.tsx` ; `server/test/team-templates.test.ts` | Avatar généré par motif : Sklubot a un personnage dessiné (`CharacterEditor.tsx`). | — |
| 2 | Bots | Création **tout ou rien** : la machine, le bot et sa discussion directe ; la machine est détruite si la suite échoue (pour ne pas payer une machine orpheline) | FAIT | `retireBot` et création d'ordinateur (`server/src/computer.ts`) ; `server/test/linux.test.ts` | Nettoyage d'un conteneur orphelin à la création non vérifié. | S |
| 3 | Bots | Supprimer : machine d'abord (si elle échoue, le bot reste et on peut réessayer), puis discussions et appartenances | DIFFÉRENT | `server/src/routes.ts:685-691` → `retireBot`, chaque échec journalisé sans bloquer | Ordre inverse : Sklubot supprime le bot même si la machine résiste (orphelin possible, mais signalé). | S |
| 4 | Bots | Consignes relues **à chaque tour** (une modification vaut au message suivant) | FAIT | Prompt reconstruit à chaque tour (`server/src/agent/prompt.ts`) | — | — |
| 5 | Bots | Le bot reste dans son rôle et répond « en tant que lui-même » | FAIT | `prompt.ts` (identité du bot) | — | — |
| 6 | Ordinateur | Une machine Linux **persistante par bot** (shell, fichiers, bureau graphique 1024×768) | FAIT | `docker/desktop`, `server/src/computer.ts`, `server/src/linux.ts` ; `server/test/linux.test.ts`, `wave10-linux.test.ts` | — | — |
| 7 | Ordinateur | Machine inactive arrêtée seule, **réveillée au besoin** ; ses fichiers restent | FAIT | Ordinateurs réveillés à la demande (`server/src/computer.ts`), pool gratuit (`server/src/freecomputers.ts`) ; `server/test/free-computers.test.ts` | — | — |
| 8 | Ordinateur | Commande shell avec dossier et délai (1 à 600 s, 60 par défaut), sortie tronquée | FAIT | Outil de commande du bureau (`server/src/linux.ts`, `server/src/agent/tools.ts`) | — | — |
| 9 | Ordinateur | Lire, écrire, lister des fichiers | FAIT | `server/src/agent/tools.ts` (`file_*`) ; `server/test/wave5b-files.test.ts` | — | — |
| 10 | Ordinateur | Souris (clic, déplacement, glisser, molette) et clavier (taper, touches) | FAIT | `screen_click`, `screen_drag`, `screen_scroll`, `screen_type`, `screen_key` (`server/src/agent/tools.ts`) ; `server/test/elements.test.ts` | Sklubot ajoute la désignation par éléments (`server/src/agent/elements.ts`). | — |
| 11 | Ordinateur | **Deux outils d'écran distincts** : « regarder » (image pour le modèle seul) et « montrer » (image publiée dans la discussion, seulement si l'utilisateur le demande) ; les captures du bot restent hors du chat | PARTIEL | `screen_view` (`server/src/agent/tools.ts`), captures dans les étapes repliées | Vérifier que les captures de travail ne polluent pas le chat et qu'un geste explicite existe pour « montre-moi ton écran » (sinon le bot doit utiliser `file_send`). | S |
| 12 | Ordinateur | Consigne : préférer shell et fichiers au bureau ; regarder avant et après chaque clic | FAIT | `server/src/agent/prompt.ts` (ordinateur), guides | — | — |
| 13 | Ordinateur | Vue du bureau **en direct** dans la discussion (noVNC), adresse signée valable 1 h | FAIT | `web/src/components/LiveScreen.tsx`, `server/src/vnc.ts`, `server/src/rfb.ts` ; `server/test/live.test.ts` | — | — |
| 14 | Ordinateur | Panneau du bureau **déplaçable entre le côté et une grande fenêtre sans reconnexion** ; mode « regarder » ou « prendre la main » ; Échap appartient au bureau, seul le bouton ferme | PARTIEL | `ComputerViewer.tsx`, prise de main avec bail (`ComputerViewer.tsx:172-178`) | Passage côté ↔ plein écran sans reconnexion non vérifié. | S |
| 15 | Ordinateur | Seule la discussion **directe** a un bureau à montrer (pas les groupes) | DIFFÉRENT | Écran de chaque bot accessible partout | Rien de perdu. | — |
| 16 | Mémoire | Notes du bot dans un **fichier de sa machine**, ajoutées ligne à ligne (encodées pour ne pas casser la commande, ajout atomique depuis deux discussions à la fois), modifiables avec les outils de fichiers | DIFFÉRENT | Notes en base avec confiance, oubli et rappel (`server/src/agent/memory.ts`, `prompt.ts:17-45`) ; `server/test/memory-guard.test.ts`, `memory-recall.test.ts` | Sklubot est plus riche. L'idée « la mémoire est un fichier lisible » rejoint l'export existant. | — |
| 17 | Mémoire | Outils `recall` / `remember` ; consigne forte : **rappeler avant de dire qu'on ne sait pas** ou de redemander, enregistrer **dans le même tour** (dire « je retiens » ne suffit pas) | PARTIEL | Rappel automatique avant chaque tour (BM25), `memory_save` (`server/src/agent/tools.ts:862`) | Vérifier que le prompt interdit « je ne sais pas » / « redis-moi » sans recherche, et « je retiens » sans enregistrement. | S |
| 18 | Mémoire | Mémoire **partagée entre toutes les discussions** du bot (directe et groupes) | FAIT | Notes par bot, quel que soit le fil (`memory.ts`) | — | — |
| 19 | Groupes | Discussion de groupe : nom, membres choisis, ajout / retrait (les restants gardent leur place) | FAIT | Salons (`server/src/agent/roomroutes.ts`) ; `server/test/room-routing.test.ts` | — | — |
| 20 | Groupes | L'utilisateur **choisit à quel bot** s'adresse chaque message ; sinon le premier membre répond | DIFFÉRENT | Routage automatique (`server/src/agent/roomrouting.ts:13-32`), mentions | Sklubot choisit seul qui répond ; l'utilisateur peut nommer. Rien de perdu. | — |
| 21 | Groupes | Chaque bot sait **qui sont les autres** (nom, métier) et que les réponses précédentes peuvent venir d'eux (ne pas s'attribuer leur travail) | PARTIEL | Liste des membres dans le salon (`server/src/agent/tools-room.ts`) | Consigne « ne présente pas le travail d'un autre comme le tien » non vérifiée. | S |
| 22 | Groupes | **Passage de relais** : outil qui donne la suite du tour à un coéquipier, avec une note ; refus si le coéquipier a **déjà eu** la demande (pas de ping-pong) ; « ne passe pas ce que tu sais bien faire » | FAIT | `room_handoff` (`server/src/agent/tools-room.ts:23-25`), garde-boucle (`server/src/agent/roombudget.ts`, `team.ts` 3 rebonds) ; `server/test/roombudget.test.ts` | Sklubot borne le nombre de rebonds (3), la source interdit tout retour vers un bot déjà passé : plus strict, utile. | S |
| 23 | Groupes | Après un relais, **le même tour continue** avec les consignes du nouveau bot ; dans l'interface, la réponse est **coupée à chaque relais**, chaque morceau sous le visage de son auteur | DIFFÉRENT | `room_handoff` termine le tour, le destinataire répond dans un nouveau tour | Sklubot paie un tour de plus mais garde des réponses séparées. Rien de grave. | — |
| 24 | Groupes | Avatar de groupe composé des visages des membres | FAIT | `web/src/components/Avatar.tsx`, `Sidebar.tsx` ; pas de test | — | — |
| 25 | Tour | Tour **durable** : survit au rafraîchissement, au redéploiement, à l'onglet fermé | FAIT | Reprise au démarrage (`server/src/agent/loop.ts:1678-1730`), flux `/events` (`server/src/bus.ts`) ; `server/test/engine-queue.test.ts` | — | — |
| 26 | Tour | Plafond de **50 pas** par tour (le bureau = une petite action par pas) | DIFFÉRENT | 60 pas puis « Continuer » (`server/src/config.ts:67`, `loop.ts:1143-1157`) | — | — |
| 27 | Tour | Le tour **s'arrête dès que l'allocation restante est dépensée**, calculé pas à pas | FAIT | Point d'étape de dépense (`server/src/agent/spend.ts:9-14`) ; `server/test/wave5b.test.ts` | Sklubot s'arrête avec une carte « continuer / relever / arrêter » : mieux. | — |
| 28 | Tour | Tour refusé d'avance si l'allocation de modèle est épuisée ; outils de la machine refusés si les heures de machine sont épuisées (vérifié au plus une fois par minute) | PARTIEL | Plafonds d'usage (`server/src/usagecaps.ts`), limites d'offre (`server/src/sublimit.ts`) ; `server/test/usage-caps.test.ts`, `sublimit.test.ts` | Pas de plafond séparé « heures d'ordinateur » visible pour l'utilisateur (non vérifié). | S |
| 29 | Tour | Un tour arrêté ou échoué **compte quand même** ses jetons | FAIT | `server/src/usage.ts` ; `server/test/costs.test.ts` | — | — |
| 30 | Usage | Registre d'usage en **ajout seul** avec **clé d'idempotence** (un nouvel essai ne compte pas deux fois) | NON VÉRIFIÉ → § 5 | `server/src/usage.ts`, `credits.ts` ; `server/test/credits.test.ts` | — | S |
| 31 | Usage | Comptage du temps de machine : toutes les 5 min, chaque machine allumée est facturée à son propriétaire ; celles des propriétaires à court sont **arrêtées** | MANQUANT | — | Sklubot héberge ses propres conteneurs : pas de facturation au temps, mais aucun arrêt automatique d'un ordinateur inactif depuis longtemps en mode hébergé (non vérifié). | S |
| 32 | Usage | Machines en marche **sans bot connu** : laissées de côté (personne à facturer) | MANQUANT | — | Idée : détecter et arrêter les conteneurs orphelins (Sentinelle). | S |
| 33 | Usage | Page « Usage » : modèle et heures de machine consommés sur la période | FAIT | `web/src/components/UsageCaps.tsx`, `server/src/usage.ts` ; `server/test/usage-caps.test.ts` | — | — |
| 34 | Offre | Page des offres et **mur de paiement** sur les actions facturables | DIFFÉRENT | Crédits prépayés Paddle cachés sans configuration (`server/src/billing/paddle.ts`), offres hébergées (`server/src/hosted.ts`) ; `server/test/credits.test.ts`, `hosted.test.ts` | Paiements hors périmètre côté recommandations. | — |
| 35 | Compte | Connexion et inscription par un service tiers | NON REPRIS | Comptes maison, Google, 2FA (`server/src/auth.ts`, `googlelogin.ts`, `twofactor.ts`) | Service payant tiers. | — |
| 36 | Interface | Barre latérale des bots et discussions, aperçu du dernier message, menu de création | FAIT | `web/src/components/Sidebar.tsx` | — | — |
| 37 | Interface | **Recherche rapide** (palette de commandes) des bots et discussions | FAIT | `web/src/components/CommandPalette.tsx`, `server/src/search.ts` | — | — |
| 38 | Interface | Thème clair / sombre | FAIT | `web/src/store.ts:76` | — | — |
| 39 | Interface | Résultat de l'outil « montrer l'écran » affiché en image, l'appel lui-même masqué ; une ligne pour un relais | FAIT | Étapes repliées (`Transcript.tsx:58-96`) | — | — |
| 40 | Interface | Message clair quand l'allocation est épuisée | FAIT | Carte de plafond (`web/src/components/SubLimit.tsx`) ; `server/test/sublimit.test.ts` | — | — |
| 41 | Fiabilité | Une ligne de journal par tour : qui, coût, issue (fini, échoué, limite d'usage) ; erreurs des tours envoyées à un service de suivi | PARTIEL | Journal (`server/src/journal.ts`), Sentinelle (`server/src/sentinel/`) ; `server/test/sentinel.test.ts` | Pas de service tiers (choix de confidentialité). | — |
| 42 | Fiabilité | Point de santé `/api/health` | FAIT | `server/src/health.ts` ; `server/test/monitor.test.ts` | — | — |
| 43 | Sécurité | Les identifiants venant du navigateur (bot, membres) sont toujours vérifiés comme appartenant à l'utilisateur | FAIT | `ownBot` (`server/src/routes.ts:686`) ; `server/test/isolation-hosted.test.ts` | — | — |
| 44 | Déploiement | Modèle de déploiement en un clic sur un hébergeur | NON REPRIS | `docker-compose.coolify.yml`, `docs/DEPLOIEMENT.md` | Hébergeur tiers ; Sklubot a déjà Coolify et VPS. | — |
| 45 | Dév | 29 compétences pour l'agent de développement (authentification, tâches durables, interface, migrations) | NON REPRIS | — | Sans rapport avec les bots ; liées à des services tiers payants. | — |

Lignes NON REPRIS supplémentaires vues : machines en nuage payantes, tâches durables hébergées, base serverless, passerelle de modèle, scraping web d'un tiers pour l'agent de développement (non comptées).

---

## 3. Écarts de comportement

1. **Premier message à un bot** — Source : prompt court (nom, métier, consignes, machine, mémoire), modèle unique, outils de la machine. Sklubot : prompt riche, choix du modèle, rappel automatique. Sklubot en avance.
2. **Bot qui utilise son ordinateur sans qu'on le dise** — Source : consigne « fais le travail plutôt que de le décrire », « regarde avant et après chaque clic », « préfère le shell ». Sklubot a des consignes équivalentes et les éléments de page. Différence utile : la source **sépare** « regarder pour soi » et « montrer à l'utilisateur » ; chez Sklubot, vérifier qu'un « montre-moi » publie bien une image dans le chat (ligne 11) et que l'écran s'ouvre de lui-même (déjà noté par l'audit Hermes l. 72).
3. **Tâche longue qui échoue** — Source : aucun nouvel essai, aucune carte ; l'erreur est envoyée au suivi, le tour s'arrête. Sklubot : essais, secours, carte d'échec. Sklubot en avance.
4. **Groupes** — Source : l'utilisateur choisit le destinataire, relais dans le même tour, **interdiction de rendre une demande à un bot qui l'a déjà eue** (ensemble des bots déjà passés). Sklubot : borne à 3 rebonds en mémoire vive. **Correctif** : garder l'ensemble des bots déjà passés pour une même demande et refuser un retour, en plus de la borne ; stocker en base. S.
5. **Mémoire** — Source : consigne très ferme « ne dis jamais que tu ne sais pas sans avoir cherché ; enregistre dans le même tour ». Sklubot : rappel automatique avant le tour (mieux), mais vérifier la consigne « dire je retiens sans enregistrer est interdit ». S.
6. **Usage** — Source : arrêt du tour quand l'allocation est dépensée, sans choix. Sklubot : carte « continuer / relever / arrêter » (`spend.ts`). Sklubot en avance.
7. **Redémarrage** — Les deux reprennent ; la source s'appuie sur un service de tâches durables payant.

---

## 4. À faire (classé)

1. Groupes : interdire de rendre une demande à un bot qui l'a déjà eue, en plus de la borne de rebonds, compteur en base. S.
2. Écran : geste explicite « montre-moi ton écran » qui publie une capture dans le chat ; captures de travail hors du chat. S.
3. Consigne mémoire : chercher avant « je ne sais pas » / « redis-moi », enregistrer dans le même tour. S.
4. Groupes : consigne « ne présente pas le travail d'un coéquipier comme le tien ». S.
5. Sentinelle : repérer et arrêter les conteneurs sans bot ; arrêter les ordinateurs inactifs longtemps en mode hébergé. S. — **FAIT EN PARTIE (2026-11-23)** : conteneurs sans bot arrêtés (jamais supprimés), au démarrage et toutes les heures (L95, `computerhours.ts`)
6. Plafond « heures d'ordinateur » visible séparément du plafond de modèle. S. — **FAIT (2026-11-23)** : Réglages → Consommation, `COMPUTER_HOURS_MONTH` en hébergé (L95)

---

## 5. Non vérifié

- Clé d'idempotence du registre d'usage Sklubot (ligne 30).
- Nettoyage d'un conteneur orphelin si la création d'un bot échoue à mi-chemin (ligne 2).
- Bascule côté ↔ plein écran du bureau sans reconnexion (ligne 14).
- Consignes exactes du prompt Sklubot sur la mémoire et les groupes (lignes 17, 21).
- Aucun test Sklubot relancé ; le code de la source n'a pas été exécuté.
