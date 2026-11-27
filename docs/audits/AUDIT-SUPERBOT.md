# Audit complet : davidondrej/superbot comparé à Sklubot

Date : 22/11/2026. Lecture seule. Rien n'a été modifié dans Sklubot.
Dépôt lu : `davidondrej/superbot`, commit `652e100` (15/11/2026). Clone partiel **sans le dossier `grok-bot-internals/`** (exclu à la récupération, jamais téléchargé ni lu). Lus : README, AGENTS, `docs/backend.md`, `docs/computer.md`, `docs/architecture.md`, les 3 décisions d'architecture, tout le serveur Rust (~1 900 lignes : file d'attente, exécution, adaptateurs, routines, écrans, outil en ligne de commande des bots), l'appli web (~1 000 lignes). Les pages `docs/background/*` et `docs/grok-bot-reference.md` (suppositions sur le fonctionnement interne d'un produit tiers) ont seulement été repérées, pas utilisées. Rien n'a été exécuté.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 22 |
| PARTIEL | 8 |
| MANQUANT | 3 |
| DIFFÉRENT | 9 |
| NON REPRIS | 2 |
| **Total** | **44** |

Lecture rapide : projet **très jeune** (5 jours, statut « early ») : un seul binaire Rust qui fait tourner chaque bot sur un CLI de code (Claude Code, Codex, Pi) **avec les autorisations coupées**, mémoire en fichiers Markdown, routines cron, demande entre bots par une commande, un écran virtuel par bot. Pas d'accords, pas de coffre, pas de comptes. Sklubot couvre tout et beaucoup plus. Ce qui vaut d'être pris : (1) **après un redémarrage, un tour interrompu est signalé et pas rejoué** (pour ne pas renvoyer un e-mail) ; (2) **« handoff » humain explicite** : le bot demande « viens sur mon écran pour la connexion / le captcha », carte « Ouvrir l'écran » + « Fini », la commande du bot attend la réponse ; (3) **outils d'écran plus modernes** (navigation par références d'éléments en ligne de commande, lecture des applis par accessibilité, diffusion d'écran plus fluide que noVNC) à évaluer pour l'image du bureau.

---

## 1. Licence

**MIT License**, © 2026 David Ondrej (`LICENSE`). Copie autorisée avec la mention MIT. Le dossier `grok-bot-internals/` n'a pas été lu (consigne) : rien n'en provient. Le README dit lui-même ne pas utiliser la marque d'un produit tiers dans ses noms ; on fait de même.

Outils tiers installés par son script (`deploy/install-computer.sh`) : un pilote de navigateur en ligne de commande (v0.43.0), un lecteur d'applis par accessibilité (v1.3.1), un diffuseur d'écran ; versions épinglées, téléchargées depuis les publications GitHub. **Leurs licences n'ont pas été vérifiées** : à lire avant d'en installer un.

---

## 2. Tableau complet

| # | Zone | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 1 | Bots | Équipe de bots nommés, un métier, une discussion, une mémoire chacun | FAIT | `server/src/routes.ts` (`/bots`), `web/src/components/Sidebar.tsx` ; `server/test/team-templates.test.ts` | — | — |
| 2 | Bots | Bot principal qui aide à répartir les métiers | FAIT | `bot.primary` (`server/src/routes.ts:687`), recruteur (`server/src/agent/recruit.ts`) ; `server/test/recruiter.test.ts` | — | — |
| 3 | Bots | Avatar robot : 12 formes × 11 couleurs | FAIT | Personnage (forme, couleur) (`web/src/components/CharacterEditor.tsx`, `server/src/shared.ts`) | — | — |
| 4 | Bots | Masquer un bot ; compteur de non-lus ; marquer lu | FAIT | `Sidebar.tsx:69,80,264-269` | — | — |
| 5 | Bots | Supprimer un bot | FAIT | `server/src/routes.ts:685` | Ni l'un ni l'autre n'a de corbeille (voir audit Timon T50). | — |
| 6 | Moteurs | Chaque bot tourne sur le **CLI de son choix** (Claude Code, Codex, Pi) par un petit adaptateur par CLI (5 événements : session, morceau de texte, texte, outil, erreur) | FAIT | `server/src/agent/engine.ts` (Claude Code, Codex dans l'ordinateur du bot) + boucle maison (`loop.ts`) ; `server/test/codex-retry.test.ts`, `engine-finish.test.ts` | Pas de Pi. | — |
| 7 | Moteurs | CLI lancés **avec les autorisations coupées** (le serveur est l'ordinateur) | NON REPRIS | Accords et relecteur (`loop.ts:1803`, `server/src/agent/authorize.ts`) | Supprime le garde-fou ; contraire aux règles de Sklubot. | — |
| 8 | Moteurs | Modèle et effort **par bot**, sélecteur discret au-dessus de la saisie, liste des modèles lue auprès de chaque CLI ; effort gardé seulement si le nouveau modèle le permet | PARTIEL | Modèle et effort par bot (`web/src/components/BotSettings.tsx:31-54`, `Brain.tsx`) | Pas de sélecteur au-dessus de la saisie ; liste lue auprès du CLI non vérifiée. | S |
| 9 | Moteurs | Session du CLI perdue (fichiers effacés) → **repartir une fois** sur une session neuve | PARTIEL | `server/src/agent/engine.ts` | Comportement exact non vérifié. | S |
| 10 | Moteurs | Consignes envoyées **fraîches à chaque exécution** (sauf Codex, qui ne les lit qu'au début : les changements passent par le fichier mémoire) | FAIT | Prompt reconstruit à chaque tour (`server/src/agent/prompt.ts`) | — | — |
| 11 | File | **Une tâche à la fois par bot**, dans l'ordre ; bots différents en parallèle | FAIT | `inQueue` (`server/src/routes.ts:1168`), `loop.ts` ; `server/test/engine-queue.test.ts` | — | — |
| 12 | File | « Arrêter » coupe la tâche en cours **et vide la file** | DIFFÉRENT | Interruption (`loop.ts:391`), pause (`server/src/pauses.ts`) ; `server/test/pause.test.ts` | Vérifier si l'arrêt vide aussi les messages en attente. | S |
| 13 | Reprise | Après un redémarrage, **les messages en file repartent** ; **un tour qui tournait est signalé « interrompu », pas rejoué** (il pourrait renvoyer un e-mail) | DIFFÉRENT | Reprise automatique (`server/src/agent/loop.ts:1678-1730`), actions extérieures protégées (`server/src/agent/executions.ts`) ; `server/test/security-review.test.ts` | Même conclusion que l'audit Timon : Sklubot rejoue, sûr seulement pour les outils enregistrés « une fois ». | S |
| 14 | Reprise | Arrêt propre sur signal d'arrêt ; « enregistrer avant d'afficher » ; le travail continue si le navigateur se déconnecte | FAIT | `server/src/index.ts`, bus d'événements (`server/src/bus.ts`) | — | — |
| 15 | Chat | Flux en direct (texte qui s'écrit, « en train de : ls ») par un seul flux d'événements ; resynchronisation | FAIT | `/events` (`server/src/bus.ts`), étapes (`Transcript.tsx:58-96`) | — | — |
| 16 | Chat | **Chaque bloc de texte = une bulle** ; consigne « avant un long travail, un message d'une ligne » | PARTIEL | Messages et étapes (`Transcript.tsx`) | Consigne « préviens d'une ligne avant un long travail » non vérifiée dans `prompt.ts`. | S |
| 17 | Chat | **Cartes à choix multiple** : la réponse se termine par un bloc structuré qui devient une carte ; la réponse revient au bot | FAIT | `ask_user` (`server/src/agent/tools.ts:1205-1211`, 6 choix) ; `server/test/ask-wait.test.ts` | — | — |
| 18 | Chat | Style : court, simple, comme un collègue ; **demander avant tout ce qui est irréversible** (envoyer, publier, supprimer, payer) | FAIT (par le code) | Plancher déterministe (`server/src/agent/irreversible.ts`, COUVERTURE spec 07 A1) ; `server/test/irreversible-skills-localtools.test.ts` | Chez la source, c'est seulement une consigne au modèle ; chez Sklubot, c'est imposé. | — |
| 19 | Mémoire | Mémoire = **fichiers Markdown** que le bot modifie lui-même, renvoyés dans le prompt à chaque exécution : un fichier par bot (métier, règles, journal daté) + un fichier **commun** de faits sur l'utilisateur | DIFFÉRENT | Notes en base avec confiance et rappel (`server/src/agent/memory.ts`, `prompt.ts:17-45`), profil commun (`prompt.ts:187-192`, `profile_update`) ; `server/test/memory-guard.test.ts` | Sklubot est plus sûr (mots de l'utilisateur seulement, secrets filtrés). La source n'a aucune limite de taille. | — |
| 20 | Mémoire | « Qu'est-ce que tu sais de moi ? » | FAIT | Profil et notes (`tools.ts`, Telegram `/memoire` `server/src/telegram.ts:104`) | — | — |
| 21 | Mémoire | Consigne : ne jamais garder mots de passe, clés, numéros de carte | FAIT (par le code) | Analyse avant de garder (`server/src/agent/sensitive.ts:68-71`) | — | — |
| 22 | Routines | Routines **cron** (nom, horaire, consigne), en pause / reprise ; **créées par les bots eux-mêmes** par une commande | FAIT | `server/src/routines.ts:143`, `server/src/cron.ts`, outil routine du bot ; `server/test/features.test.ts` | — | — |
| 23 | Routines | Fuseau horaire unique de la machine | DIFFÉRENT | Fuseau par routine (`server/src/routines.ts:32-44`) | Sklubot mieux. | — |
| 24 | Entre bots | **Demander à un autre bot** par une commande : il répond dans sa propre discussion, la réponse revient ; au-delà de 9 min, elle arrive plus tard comme nouveau message | FAIT | Délégation entre bots (`server/src/agent/team.ts`), tâches de fond (`bgtasks.ts`) ; `server/test/room-routing.test.ts` | — | — |
| 25 | Entre bots | « Ne sollicite jamais le bot qui te sollicite » ; seulement si l'utilisateur le demande ou si ça aide clairement | PARTIEL | Garde-boucle (`server/src/agent/roombudget.ts`, `team.ts` 3 rebonds) ; `server/test/roombudget.test.ts` | Consigne au modèle seulement chez la source ; Sklubot a une borne, mais en mémoire vive. | S |
| 26 | Ordinateur | **Un écran virtuel par bot** (affichage virtuel + gestionnaire de fenêtres + bus de session), démarré au premier besoin, **arrêté après N minutes d'inactivité** | FAIT | Bureau Linux par bot (`docker/desktop/Dockerfile` : Xvfb, openbox, x11vnc), réveil à la demande (`server/src/computer.ts`) ; `server/test/linux.test.ts` | — | — |
| 27 | Ordinateur | Au plus N écrans à la fois ; si tout est pris, l'écran **le moins récemment utilisé d'un bot inactif** est arrêté | FAIT | Navigateurs : le moins récemment utilisé et inactif est fermé, jamais un en usage (`server/src/computer.ts:103-112`) | — | — |
| 28 | Ordinateur | **Un seul ordinateur partagé** par tous les bots, un seul utilisateur Linux (« les écrans ne sont pas des frontières de sécurité ») | DIFFÉRENT | Un conteneur par bot, réseau isolé (`docker/desktop`, `deploy/bots-firewall.sh`) ; `server/test/isolation.test.ts` | Sklubot bien plus sûr. | — |
| 29 | Ordinateur | Navigateur piloté par un **CLI qui désigne les éléments par références** ; profil Chrome par bot (connexions gardées) ; Chrome **garde son bac à sable** (profil AppArmor au lieu de le désactiver) | PARTIEL | Éléments de page (`server/src/agent/elements.ts`, `screen-elements.ts`), profil par bot ; `server/test/elements.test.ts` | Vérifier que le Chromium du bureau Sklubot ne tourne pas sans bac à sable. | S |
| 30 | Ordinateur | Applis de bureau lues par le **bus d'accessibilité** | MANQUANT | Pixels + éléments du navigateur seulement | Utile pour les applis non web du bureau (tableur, éditeur). | M |
| 31 | Ordinateur | **Diffusion d'écran** plus fluide que noVNC, presque sans processeur quand l'écran est immobile ; vue en lecture seule jusqu'à « Prendre la main » ; jeton propre à la diffusion | DIFFÉRENT | noVNC / x11vnc (`server/src/vnc.ts`, `server/src/rfb.ts`), prise de main (`ComputerViewer.tsx`) ; `server/test/live.test.ts` | À évaluer pour le mobile et les petits serveurs (§ 3). | M |
| 32 | Ordinateur | **Passage à l'humain** : le bot demande « viens sur mon écran » (connexion, double facteur, captcha) ; carte **Ouvrir l'écran** + **Fini** ; la commande du bot attend la réponse, sinon elle arrive plus tard comme message | PARTIEL | Demande de prise de main par le bot (`server/src/takeover.ts`), retour au bot (`loop.ts:388,649`) | Vérifier qu'une carte avec « ouvrir l'écran » et « fini » existe et que le bot attend (sinon : à faire, S). | S |
| 33 | Ordinateur | Mémoire : 4 Go d'échange + tueur préventif qui tue le plus gros Chrome avant que le serveur manque de mémoire | PARTIEL | Surveillance disque (`server/src/diskwatch.ts`) ; limites des conteneurs (`server/src/dockerproxy.ts`) | Pas de garde mémoire équivalente vérifiée. | S |
| 34 | Ordinateur | Dimensionnement documenté (un bot + Chrome ≈ 0,5-1 Go ; 2 processeurs / 8 Go ≈ 3 écrans) | PARTIEL | `docs/ORDINATEUR.md`, `docs/INSTALLATION-VPS.md` | Chiffres non comparés. | S |
| 35 | Ordinateur | Outils de l'ordinateur = **CLI simples** expliqués dans le prompt, identiques pour tous les moteurs (pas de MCP) | DIFFÉRENT | Outils natifs de la boucle + `desk-cli` (`server/src/desk-cli.ts`) pour les moteurs CLI ; `server/test/desk.test.ts` | Même idée côté moteurs CLI. | — |
| 36 | Fichiers | Dossier de travail partagé par tous les bots | DIFFÉRENT | Disque de l'équipe (`server/src/disk.ts`, `teamfile.ts`) ; `server/test/team-disk.test.ts` | — | — |
| 37 | Accès | Mot de passe unique en authentification HTTP de base ; `/healthz` sans authentification | DIFFÉRENT | Comptes, 2FA, mode hébergé (`server/src/auth.ts`, `twofactor.ts`) ; `server/test/totp.test.ts` | Sklubot bien plus complet. | — |
| 38 | Accès | Déploiement : service systemd avec relance, HTTPS devant (Caddy), proxy sans tampon pour le flux d'événements, fuseau horaire, sauvegarde du dossier de données | FAIT | `docs/INSTALLATION-VPS.md`, `docker-compose.vps.yml`, sauvegardes (`server/src/autobackup.ts`) ; `server/test/deploy.test.ts` | — | — |
| 39 | Dév | Règles de dépôt public : jamais d'IP, de domaine, d'e-mail, de jeton dans le code ; notes privées dans un dossier ignoré ; décisions dans des ADR | FAIT | `CLAUDE.md` / docs de Sklubot | — | — |
| 40 | Prévu | Accords avant les actions risquées | FAIT (chez Sklubot) | `loop.ts:1803` ; `server/test/security.test.ts` | Prévu chez la source. | — |
| 41 | Prévu | Coffre à secrets | FAIT (chez Sklubot) | `VaultSection.tsx`, `server/src/egress.ts` ; `server/test/security-fixes.test.ts` | Prévu chez la source. | — |
| 42 | Prévu | Limites de ressources par bot | MANQUANT | — | Ni l'un ni l'autre ne borne la mémoire vive par bot (non vérifié côté Sklubot : `dockerproxy.ts`). | S |
| 43 | Prévu | Slack comme canal | MANQUANT | Slack = appli lue (`server/src/native/vendors.ts:14-15`) | Déjà noté (COUVERTURE). | L |
| 44 | Prévu | Moteurs supplémentaires (deux CLI tiers annoncés) | NON REPRIS | — | Hors périmètre pour l'instant ; un adaptateur par CLI est une bonne forme si un jour on en ajoute. | — |

NON REPRIS supplémentaires : utilisation de la marque d'un produit tiers (le projet l'évite lui-même), installation par script root depuis Internet, et tout le contenu du dossier `grok-bot-internals/` (non lu, consigne).

---

## 3. Écarts de comportement et outils

1. **Redémarrage pendant un tour** — Source (`server/src/runner.rs`, fonction de reprise) : la file repart, le tour en cours est **signalé interrompu, jamais rejoué**, parce qu'il pourrait renvoyer un e-mail. Sklubot (`loop.ts:1678-1730`) rejoue. **Correctif** (déjà proposé dans l'audit Timon) : à la reprise, consigne « vérifie avant de refaire une action visible » + ligne dans le chat ; pour un tour qui avait commencé une action non enregistrée dans `executions.ts`, signaler plutôt que rejouer. S.
2. **Connexion, double facteur, captcha** — Source : commande du bot qui pose une carte « Ouvrir l'écran / Fini » et attend. Sklubot : prise de main existe (`takeover.ts`) ; s'assurer que le bot peut la demander explicitement et attendre, et que la carte ouvre l'écran en un clic. S.
3. **Arrêter** — Source : « arrêter » coupe et **vide la file**. Sklubot : vérifier ce que deviennent les messages en attente après un arrêt (audit Timon T24). S.
4. **Autorisations** — Source : tout permis, la prudence est une phrase du prompt. Sklubot impose accords, plancher et relecteur. Sklubot nettement en avance ; ne rien reprendre ici.

**Outils (pour l'image `docker/desktop/Dockerfile`)** :

| Outil de la source | Ce qu'il apporte | Équivalent Sklubot et ce qu'il renvoie | Installable sans risque ? |
|---|---|---|---|
| Pilote de navigateur en ligne de commande par références d'éléments (v0.43.0) | Le bot lit une page en liste d'éléments numérotés et clique par numéro, depuis n'importe quel moteur CLI | `elements.ts` / `screen-elements.ts` : éléments de la page lus par le bureau, clics par élément ; renvoie libellé + rôle + position | Possible (binaire unique, version épinglée), **après lecture de sa licence** ; vérifier la somme de contrôle ; inutile si `desk-cli` couvre déjà les moteurs CLI. Priorité basse. |
| Lecteur d'applis par accessibilité (v1.3.1) | Lire et piloter les applis non web du bureau par boutons et champs | Rien : pixels + capture | Intéressant pour les applis bureautiques du bureau ; à tester dans le conteneur (bus d'accessibilité à activer). Licence à vérifier. Priorité moyenne. |
| Diffuseur d'écran (remplace noVNC) | Image plus fluide, quasi 0 % de processeur sur écran immobile, jeton propre | x11vnc + noVNC (`server/src/vnc.ts`) ; renvoie un flux RFB | À essayer sur un bot de test : gain probable sur mobile et petits VPS. Change le chemin de la vue en direct (proxy, jetons) : M. Licence à vérifier. |
| 4 Go d'échange + tueur préventif | Évite que Chrome fasse tomber le serveur | Rien de vérifié | À faire côté hôte (VPS), pas dans l'image. S. |

---

## 4. À faire (classé)

1. Reprise après redémarrage : signaler au lieu de rejouer un tour qui avait commencé une action non protégée ; consigne « vérifie avant de refaire ». S.
2. Carte « viens sur mon écran » (ouvrir l'écran + fini) demandable par le bot, qui attend la réponse. S.
3. Garde mémoire de l'hôte (échange + tueur préventif) dans le guide VPS ; limites mémoire par conteneur vérifiées. S.
4. Évaluer le lecteur d'applis par accessibilité dans l'image du bureau. M.
5. ✅ **Évalué (2026-11-23, L182).** Diffuseur d'écran plus léger que noVNC : mesuré, noVNC + x11vnc reste le plus léger de ce qui est dans l'image (`docs/ORDINATEUR.md` § « Diffusion de l'écran »). M.
6. « Arrêter » qui vide aussi la file des messages en attente (ou le dit). S.
7. Consigne « préviens d'une ligne avant un long travail ». S.
8. Vérifier que le Chromium du bureau garde son bac à sable. S.

---

## 5. Non vérifié

- Licences des trois outils tiers du script d'installation.
- Ce que Sklubot fait des messages en file après un arrêt (12), redémarrage de session CLI perdue (9), carte de prise de main demandée par le bot (32), bac à sable de Chromium (29), limites mémoire des conteneurs (33, 42).
- Le dossier `grok-bot-internals/` : volontairement non lu.
- Aucun test Sklubot relancé ; le code de la source n'a pas été exécuté.
