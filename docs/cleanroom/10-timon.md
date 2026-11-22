# 10 — Atelier d'agents sur abonnements : cahier des charges fonctionnel issu de l'étude

## Source étudiée

| Élément | Valeur |
|---|---|
| Dépôt | dépôt public GitHub `ai-timon/timon` |
| Commit étudié | `7ace147` (21/11/2026) ; relecture complète sur `7b9d665` (22/11/2026) |
| Date du commit | 22/11/2026 |
| Licence | **GNU Affero General Public License v3** (AGPL-3.0-only) pour le serveur, l'interface, l'appli de bureau, la documentation et les modules livrés ; MIT pour le kit de développement de modules et les exemples ; nom, logo et mascotte déposés. |
| Statut annoncé | produit publié (versions signées pour Windows, macOS, Linux), offre gratuite + offre payante « équipe » |

**Ce que la licence implique pour nous.** L'AGPL oblige toute copie, même offerte comme service en ligne, à publier tout son code sous AGPL. Sklubot est hébergé et n'est pas sous AGPL : **aucun code, aucun texte, aucun nom d'écran, aucun libellé, aucune consigne n'est repris**. Ce cahier décrit uniquement des comportements observables (écrans, parcours, états, limites, erreurs), avec nos mots. Les noms proposés sont des suggestions.

Méthode : lecture seule de la documentation publique livrée dans le dépôt (pages d'usage, d'installation, de modules), du fichier de présentation et des commentaires d'en-tête des modules de fiabilité, pour comprendre le *pourquoi* de chaque garde-fou. Rien n'a été installé ni exécuté. **Version 2 (22/11/2026)** : relecture de tout le dépôt (serveur, interface, appli de bureau, ligne de commande, modules livrés, configuration, migrations, tests), avec une carte de couverture en fin de document ; les exigences T91 à T145 ont été ajoutées et les exigences existantes précisées par une ligne « Valeurs relevées (v2) » (bornes, délais et contrôles chiffrés). Les valeurs numériques sont des faits relevés ; aucun texte, identifiant ni libellé n'est repris. Le tableau d'écarts détaillé, avec preuves dans le code de Sklubot, est dans `AUDIT-TIMON.md` (même dossier).

Conventions :
- Chaque exigence : **Comportement**, **Pourquoi** (ce que l'utilisateur y gagne), **Contrôle** (comment vérifier que c'est fait), **Sklubot** (FAIT avec fichier:ligne / PARTIEL / MANQUANT / DIFFÉRENT / NE PAS REPRENDRE).
- « Agent » = un bot. « Mission » = une conversation ou un travail lancé pour un bot. « Chef » = le bot qui planifie et répartit le travail. « Tâche » = une carte du tableau de travail.

## Ce qu'est le produit étudié, en bref

Une **équipe d'agents qui tourne sur l'ordinateur de l'utilisateur** et qui pense à travers **les abonnements en ligne de commande qu'il paie déjà** (pas de clé d'API facturée au jeton). Un service tourne en fond et garde tout l'état ; les clients (bureau, navigateur, téléphone, messagerie, ligne de commande) n'en gardent aucun. Le cœur : un **chef** découpe un travail en tâches sur un **tableau**, chaque tâche de code a **sa copie de travail isolée**, une **relecture par un autre modèle** la renvoie si elle n'est pas bonne, puis une **fusion** l'intègre. Autour : mémoire qui s'enrichit chaque nuit, compétences, routines et déclencheurs, navigateur intégré qui apprend par démonstration, cartes d'accord très précises, bascule automatique quand un abonnement est épuisé, modules signés.

Comparé à Sklubot : Sklubot a déjà un ordinateur Linux par bot, des accords avec relecteur, un coordinateur d'échecs, des modèles de secours, des routines, une mémoire avec rappel. Le produit étudié va **plus loin sur la conduite d'un travail long à plusieurs** (tableau, dépendances, relecture bornée, retours), **sur la fiabilité sans témoin** (relances, délais, disjoncteurs persistants, quota revérifié) et **sur la transparence** (ce que le bot reçoit, journal réseau, contenu des scripts approuvés).

---

## A) Exigences

### A.1 Tableau de travail (tâches durables)

**T1. Tâche durable avec dossier complet** — importance : haute
- **Comportement.** Une tâche porte un titre, une description longue (mise en forme, avec aperçu « tel que le bot la lira »), un responsable, un type (code, relecture, fusion, recherche, documentation, corvée), une priorité de 1 à 5, une date de début facultative, des **dépendances**, des **pièces jointes** (images, documents bureautiques, texte ; jusqu'à 20 fichiers, 15 Mo chacun, 100 Mo au total ; pages web, scripts, archives et programmes refusés, avec la raison). Quatre états : en attente, en cours, bloquée, faite. Un état inconnu laissé par une ancienne version s'affiche dans « faite » sans être réécrit.
- **Pourquoi.** Le travail survit à la fermeture de l'appli, au redémarrage, et peut être repris par un autre bot.
- **Contrôle.** Créer une tâche avec 2 fichiers et une dépendance ; redémarrer ; la tâche, ses fichiers et son lien sont intacts ; le bot qui la prend reçoit l'emplacement des fichiers.
- **Valeurs relevées (v2).** Une date de début s'exprime en temps absolu ; une date donnée dans une unité ambiguë (secondes, texte libre) est refusée plutôt que d'entraîner un lancement immédiat ; une date à plus de 18 h donne un avertissement, jamais un refus. Un fichier déposé avant la création de la tâche part une fois la tâche créée ; un type refusé ne quitte jamais le navigateur. Le contenu d'un fichier doit correspondre à son type déclaré. Contrôle ajouté : programmer une tâche avec une date en secondes : refus explicite, aucune exécution.
- **Sklubot.** PARTIEL : tâches de fond (`server/src/agent/bgtasks.ts:54-106`, test `server/test/wave9.test.ts`), objectifs (`server/src/agent/goals.ts`), vue `web/src/components/TasksView.tsx`. Manquent dépendances, pièces jointes, priorité, date de début.

**T2. Carte de tâche lisible** — importance : moyenne
- **Comportement.** Chaque carte montre le bot qui travaille (visage, nom, rôle), un point et un chronomètre si elle tourne, le modèle utilisé (modifiable sur une tâche en attente ou bloquée en un clic), la date prévue, « attend N tâches » et « débloque N tâches » (clic = liste), le nombre de fichiers, la priorité (les plus basses mises en évidence). Filtres combinables par projet, bot et recherche, mémorisés dans le navigateur, avec « tout remettre ».
- **Pourquoi.** Savoir d'un coup d'œil qui fait quoi et ce qui bloque quoi.
- **Contrôle.** Deux tâches liées : la première affiche « débloque 1 », la seconde « attend 1 » ; changer le modèle depuis la carte prend effet au prochain lancement.
- **Sklubot.** MANQUANT (pas de tableau à colonnes).

**T3. Dépendances qui attendent le vrai résultat** — importance : haute
- **Comportement.** Une tâche dépendante ne démarre que quand ce dont elle dépend est **réellement intégré** (pour du code : relu *et* fusionné, pas seulement écrit). Si la fusion n'arrive jamais, la dépendance attend et la carte le dit ; l'utilisateur peut retirer le lien ou déclarer « fusionné ailleurs » (T13).
- **Pourquoi.** Éviter qu'un bot construise sur un travail refusé.
- **Contrôle.** A (code) → B ; A est relu « à corriger » ; B ne démarre pas.
- **Sklubot.** MANQUANT.

**T4. Carnet d'idées séparé du travail** — importance : moyenne
- **Comportement.** Une colonne « idées » où ajouter n'ordonne rien. Chaque idée a un numéro, un auteur, une urgence (critique, bogue, mineur, idée), un avancement (à faire, analysé, partiel, à tester, fait), des fichiers (capture collée dans la fenêtre). Une idée peut être **envoyée au chef** (qui en discute avant de créer une tâche) ou **promue** en tâche (une seule fois ; la tâche garde une copie des fichiers). Quand toutes les tâches qui la réalisent sont intégrées, l'idée **se coche toute seule** ; tant qu'il en reste, elle passe « partielle » avec un compteur (1/7). Une idée faite n'est jamais rouverte.
- **Pourquoi.** Noter vite sans lancer de travail payant ; ne pas oublier de fermer.
- **Contrôle.** Promouvoir deux fois la même idée : refus qui nomme la tâche existante. Intégrer la dernière tâche liée : l'idée passe « faite ».
- **Valeurs relevées (v2).** Fichiers d'idée : mêmes plafonds que les tâches, plus un quota par compte ; la promotion copie les fichiers. Une issue « recherche » ne fait passer l'idée qu'à « analysée », jamais à « faite ». Une sous-tâche bloquée garde l'idée ouverte ; une sous-tâche supprimée ne compte plus. Liste par défaut : 200 idées, 1 000 au plus par page.
- **Sklubot.** PARTIEL : idées (`server/src/ideas.ts`), pépites (`server/src/shared.ts:47`). Pas de promotion, pas de fermeture automatique.

**T5. Issue d'une idée et note publique** — importance : basse
- **Comportement.** Option : chaque idée reçoit une issue (corrigé, refusé, doublon de…, besoin d'infos, en cours, prévu) et une courte note publique (500 caractères) destinée à la personne qui l'a signalée ; changer l'issue émet un événement qu'un déclencheur peut renvoyer vers le canal d'origine. Ré-enregistrer la même issue n'envoie rien et un avertissement le dit.
- **Pourquoi.** Répondre aux testeurs ou clients sans quitter l'outil.
- **Contrôle.** Passer une idée à « corrigé » : un déclencheur reçoit l'issue et la note, une seule fois.
- **Sklubot.** MANQUANT.

**T6. Retours de tâches dans la discussion du chef** — importance : haute
- **Comportement.** Quand une tâche finit, son retour arrive dans la discussion de celui qui l'a lancée, **sous le nom et le visage du bot qui a travaillé**, à l'heure de fin : titre, type, issue (faite, bloquée, approuvée, à corriger), résumé en une ou deux phrases pour l'humain, ce qui demande une décision (raison du blocage, ce que la relecture a trouvé) toujours visible ; le compte rendu complet pour le chef derrière « Détails ». Le chef reçoit les retours d'un lot **ensemble**, une fois les relectures et fusions terminées.
- **Pourquoi.** Suivre un travail à plusieurs sans lire des pavés techniques ; le chef ne se réveille pas dix fois.
- **Contrôle.** Lancer 3 tâches : 3 cartes de retour distinctes pour l'humain, un seul réveil du chef après la dernière fusion.
- **Sklubot.** PARTIEL : fils de tâches et carte de tâche (`web/src/components/ThreadPanel.tsx`, `bgtasks.ts`). Pas de regroupement par lot ni de résumé humain séparé.

**T7. Récapitulatif des retours mis en forme pour le chef** — importance : moyenne
- **Comportement.** Le message de réveil du chef trie les retours par priorité (blocages et demandes de correction d'abord) et lit les bons champs de chaque retour ; un retour sans contenu lisible est signalé, pas transmis vide.
- **Pourquoi.** Incident observé chez la source : le chef ne recevait que des titres vides et prenait de mauvaises décisions.
- **Contrôle.** Simuler 10 retours dont 1 bloqué : il apparaît en tête, aucun retour vide.
- **Sklubot.** PARTIEL (pas de regroupement, voir T6).

**T8. Suppression sûre d'une tâche** — importance : basse
- **Comportement.** Une tâche en attente ou bloquée se supprime si rien n'en dépend ; sinon le refus nomme ce qui gêne (mission en cours, tâches dépendantes, copie de travail). Une tâche de code avec sa chaîne de relectures ne se supprime qu'avec toute la chaîne, sur proposition. Supprimer une tâche supprime ses fichiers.
- **Pourquoi.** Ne jamais laisser une dépendance orpheline.
- **Contrôle.** Supprimer une tâche dont une autre dépend : refus qui la nomme.
- **Sklubot.** MANQUANT.

### A.2 Planification et choix des modèles

**T9. Le chef planifie dans un formulaire** — importance : haute
- **Comportement.** Demander au bot « planifie ce travail » ouvre dans la discussion un formulaire où l'utilisateur choisit **comment** le travail s'exécute (dans la conversation actuelle, dans une nouvelle, ou en tâches du tableau avec tel enchaînement), et **quel modèle et quel secours** pour chaque rôle (chef, nouveau travail, codeur, relecteur, intégrateur, documentaliste). Si le chef range les parties en groupes (simple, complexe…), chaque groupe a ses propres modèles. Les choix restent cochés si le formulaire expire et revient, et après un rechargement, jusqu'au lancement.
- **Pourquoi.** L'utilisateur garde la main sur le coût : modèle léger pour les parties simples, fort pour les complexes.
- **Contrôle.** Plan à 2 groupes ; groupe « simple » sur un petit modèle ; les tâches de ce groupe tournent sur ce modèle.
- **Sklubot.** MANQUANT (pas de plan à valider ; `ask_user` = une question, `server/src/agent/tools.ts:1205-1211`).

**T10. Ordre de résolution du modèle d'une tâche** — importance : moyenne
- **Comportement.** Le modèle d'une tâche se lit, du plus précis au plus général : celui de la tâche, celui du groupe dans le plan, celui de la série, celui du rôle dans le projet, celui du bot. Chaque niveau ne remplit que ce que le niveau au-dessus a laissé vide. Un bot créé automatiquement pour un rôle prend le fournisseur du chef qui l'a créé.
- **Pourquoi.** Prévisible : on sait toujours pourquoi un travail tourne sur tel modèle.
- **Contrôle.** Fixer un modèle au niveau du rôle et un autre sur une tâche : la tâche utilise le sien, les autres celui du rôle.
- **Sklubot.** PARTIEL : modèle par bot et chaîne de secours (`server/src/agent/reliability.ts:18-26`). Pas de modèle par tâche ou par rôle.

**T11. Jeux de modèles enregistrés** — importance : basse
- **Comportement.** Un « jeu » = un modèle par rôle, nommé, appliqué en un clic comme principal ou comme secours ; les rôles non couverts gardent leur choix ; un modèle disparu est sauté et la raison affichée. Jusqu'à 50 jeux par compte, suivent l'utilisateur sur tous ses appareils.
- **Pourquoi.** Ne pas refaire les mêmes choix à chaque plan.
- **Contrôle.** Appliquer un jeu dont un modèle n'existe plus : les autres rôles sont remplis, le rôle sauté est nommé.
- **Sklubot.** MANQUANT.

**T12. Qui exécute vraiment une tâche** — importance : moyenne
- **Comportement.** Une tâche va au bot nommé s'il appartient au projet et n'est ni le chef ni titulaire d'un autre rôle ; sinon au bot qui tient le rôle correspondant au type ; sinon un bot de ce rôle est créé. Un bot « épinglé » sur un rôle prend toutes les tâches de ce type. La carte affiche « exécutée par X » et la raison au survol.
- **Pourquoi.** Pas de tâche perdue parce qu'elle vise un bot inadapté ; transparence.
- **Contrôle.** Assigner une tâche de relecture au chef : elle part au relecteur et la carte dit pourquoi.
- **Sklubot.** MANQUANT (pas de rôles de projet).

### A.3 Relecture, copies isolées, intégration

**T13. Enchaînement écrire → relire → corriger → intégrer → documenter** — importance : haute (pour le travail de production)
- **Comportement.** Après chaque tâche de production qui a modifié quelque chose, une relecture est créée automatiquement pour un relecteur **sur un autre modèle**. « À corriger » renvoie au producteur ; **trois tours au maximum**, ensuite blocage pour décision humaine (aussi si le verdict est illisible). « Accepté » crée l'intégration, puis une note de documentation si un bot tient ce rôle. Deux variantes sans relecture : le producteur intègre lui-même ; plusieurs productions intégrées ensemble à la fin. L'enchaînement part de la **clôture** de la tâche, pas de la fin du processus (sinon on attend 10 minutes pour rien).
- **Pourquoi.** Un seul modèle se trompe en silence ; un second modèle qui relit attrape l'erreur, et la borne de 3 tours évite de boucler en payant.
- **Contrôle.** Un relecteur qui refuse 3 fois : la tâche se bloque avec la raison, pas de 4e tour.
- **Valeurs relevées (v2).** Un enchaînement interrompu par un redémarrage est rejoué (fenêtre de 6 h), jamais doublé ; un enchaînement qui échoue en boucle est abandonné explicitement après un plafond, compteur remis à zéro par un nouveau lancement. Pas de note de documentation pour une recherche liée à une idée, une recherche née d'un déclencheur, ou une corvée lancée par une routine. Une correction reprend le modèle, le secours et le niveau d'autorisation du tour relu.
- **Sklubot.** DIFFÉRENT : relecture par un autre bot à la demande (`server/src/peerreview.ts`, test `server/test/security-review.test.ts`). Pas d'enchaînement automatique ni de borne. À adapter aux livrables non-code (page, e-mail long, rapport).

**T14. Copie de travail isolée par tâche** — importance : moyenne
- **Comportement.** Chaque tâche de production travaille dans sa propre copie (branche + dossier), jamais dans le dossier partagé. L'intégration avance la branche de base sans toucher au dossier ouvert par l'utilisateur. Une copie se « détache » (dossier supprimé, branche gardée) si la tâche est en attente ; refus si elle tourne ou a des changements non enregistrés. Après intégration, la branche est supprimée. Des dossiers ignorés mais nécessaires (dépendances installées, notes) peuvent être reliés dans chaque copie par une liste.
- **Pourquoi.** Deux bots ne se marchent jamais dessus ; un travail raté ne salit pas l'original.
- **Contrôle.** Deux tâches simultanées sur le même projet : deux dossiers, aucun conflit de fichiers.
- **Sklubot.** DIFFÉRENT : un ordinateur par bot (`docker/desktop`, `server/test/isolation.test.ts`). Pour un travail à plusieurs bots sur un même dossier d'équipe, rien n'isole les écritures (instantanés `server/src/snapshots.ts` seulement).

**T15. Intégration vérifiée** — importance : basse
- **Comportement.** La clôture d'une intégration est refusée si ce qu'elle intègre n'est pas dans la base, ou si l'empreinte donnée est déjà utilisée par une autre tâche ; le refus dit quoi faire. « Intégré ailleurs » (demande d'intégration acceptée en ligne, fusion à la main) enregistre l'empreinte et débloque les dépendances ; une empreinte inconnue localement est acceptée mais notée « non vérifiée ».
- **Pourquoi.** Aucune tâche déclarée finie sans preuve.
- **Contrôle.** Déclarer intégrée une empreinte absente de la base : refus.
- **Sklubot.** NE PAS REPRENDRE tel quel (public développeur) ; l'idée « preuve avant de dire fini » existe déjà pour les objectifs (`server/src/agent/goals.ts`).

**T16. Livrer par demande d'intégration en ligne** — importance : basse
- **Comportement.** Un projet peut choisir de livrer par une demande d'intégration sur la forge en ligne plutôt que par fusion locale.
- **Pourquoi.** Respecter le flux d'équipe existant.
- **Contrôle.** Projet réglé ainsi : la tâche finit par une demande ouverte, pas une fusion.
- **Valeurs relevées (v2).** Avant de pousser : le compte connecté à la forge doit être celui attendu, l'adresse de destination celle du projet, les auteurs des enregistrements l'identité du dépôt ; jamais de poussée forcée ; une branche distante qui a bougé seule n'est jamais écrasée ; aucune référence interne (numéro de tâche, d'idée, mention d'attribution) dans les messages, le titre ou la description. Une idée liée ne se ferme qu'à l'intégration réelle de la demande, pas à la fusion intermédiaire.
- **Sklubot.** PARTIEL : issues et réponses GitHub (`server/src/githubissues.ts`, test `server/test/github-issue-workflow.test.ts`).

### A.4 Missions : conduite, reprise, états

**T17. Corriger le tir pendant le travail, ou mettre en file** — importance : haute
- **Comportement.** Pendant qu'un bot travaille, deux gestes : l'un glisse la consigne **dans le tour en cours** (le bot change de cap), l'autre la **met en file** pour le tour suivant ; inversion réglable ; le texte d'aide de la zone de saisie rappelle les deux. Selon le moteur, la consigne est lue entre deux étapes, ou le tour est arrêté et repris avec elle : le chat l'indique (« tour redirigé »). Un message avec fichier est toujours mis en file. Si la redirection est impossible à ce moment, le message est mis en file et le chat le dit. Par l'API : refus explicites (pas de tour en cours ; impossible maintenant ; un bot ne peut pas se rediriger lui-même).
- **Pourquoi.** Arrêter une mauvaise piste sans attendre ni tout casser.
- **Contrôle.** Envoyer « arrête, fais d'abord X » pendant un tour : le chat montre si c'est pris dans le tour ou en file.
- **Sklubot.** PARTIEL : `server/src/agent/loop.ts:205,369-380` (le serveur choisit seul), test `server/test/engine-queue.test.ts`. Pas de choix ni d'indication.

**T18. Rappeler ses anciens messages au clavier** — importance : moyenne
- **Comportement.** Flèche haut / bas dans la zone de saisie : les 50 derniers messages envoyés à ce bot (dans ce navigateur), puis retour au brouillon en cours ; sur plusieurs lignes, la flèche n'agit qu'en début / fin de texte.
- **Pourquoi.** Relancer une consigne longue sans la retaper.
- **Contrôle.** Envoyer 3 messages, flèche haut 2 fois : le 2e réapparaît.
- **Sklubot.** MANQUANT (`web/src/components/Composer.tsx:398` : flèches réservées au menu des compétences).

**T19. Répondre à un message précis** — importance : moyenne
- **Comportement.** Bouton « répondre » sur un message : bandeau de citation au-dessus de la saisie (clic = y revenir, Échap = annuler) ; le message envoyé affiche la citation. Le bot reçoit le début du message cité et sa référence ; après un résumé ou un changement de modèle, il relit l'original par cette référence.
- **Pourquoi.** Dire « à propos de ta deuxième proposition » sans ambiguïté.
- **Contrôle.** Répondre à un message ancien après compaction : le bot cite correctement l'original.
- **Sklubot.** MANQUANT.

**T20. Copier, copier avec mise en forme, écouter** — importance : basse
- **Comportement.** Sous chaque réponse : copier le texte, copier avec la mise en forme (titres, listes, code, liens), répondre, lire à voix haute.
- **Pourquoi.** Coller une réponse dans un document ou un ticket sans la reformater.
- **Contrôle.** « Copier avec mise en forme » d'une réponse à liste : la liste se colle en Markdown.
- **Sklubot.** PARTIEL : copier (`web/src/components/ui.tsx:417`), écouter (`server/src/voice/speak.ts`, test `server/test/voice-speak.test.ts`). Manque la copie avec mise en forme.

**T21. État de chaque mission et cause d'interruption** — importance : haute
- **Comportement.** Chaque mission porte un badge : au travail, tour fini (attend la suite), ouverte, **interrompue** avec la cause au survol (limite d'usage, plus de crédit, modèle saturé, refus d'autorisation, arrêtée, arrêtée à la main, muette trop longtemps, durée maximale du tour atteinte, plantage). À côté : nombre de messages en attente dans sa boîte et de demandes reçues non répondues. La cause système est **stockée à part** de la raison « métier » donnée par le bot.
- **Pourquoi.** Incident observé chez la source : trois tâches « bloquées » sans raison, en réalité un quota épuisé, à démêler à la main.
- **Contrôle.** Tâche coupée par un quota : la carte dit « limite d'usage », pas « bloquée » tout court.
- **Valeurs relevées (v2).** États exacts : au travail (tour en cours), tour fini (processus vivant), ouverte (aucun processus ou pas encore de tour fini), interrompue (cause enregistrée). Une cause inconnue n'est pas une interruption. Une mission que le redémarrage a rattachée n'est ni échouée ni annotée. Les causes ont un libellé dans chaque langue.
- **Sklubot.** PARTIEL : carte d'échec avec remèdes (`server/src/agent/failures.ts:132-166`, types `server/src/failuretypes.ts`, test `server/test/failures.test.ts`). Pas de badge de cause sur la ligne du bot ni sur la tâche.

**T22. Redémarrage pendant un tour** — importance : haute
- **Comportement.** Si le service redémarre pendant un tour, la mission est marquée interrompue (« redémarrage ») et le tour **n'est pas rejoué tout seul**, parce qu'il a pu déjà modifier des fichiers ou envoyer des messages ; l'utilisateur vérifie puis relance. Si le moteur peut reprendre sa session, le contexte est retrouvé. Si la session est perdue, le tour reprend à partir de la conversation enregistrée, et une carte dit ce que le bot a reçu (tout, un résumé, la fin seulement, rien). Un moteur sans session reçoit seulement le nouveau message, et une ligne unique le signale.
- **Pourquoi.** Jamais d'action faite deux fois dans le dos de l'utilisateur ; jamais d'amnésie silencieuse.
- **Contrôle.** Couper le service pendant un tour qui envoie un message : après relance, aucun second envoi ; le chat dit ce qui s'est passé.
- **Sklubot.** DIFFÉRENT : reprise automatique (`server/src/agent/loop.ts:1678-1730`), sûre pour les outils enregistrés « une seule fois » (`server/src/agent/executions.ts`, test `server/test/security-review.test.ts`) mais pas pour un clic dans un site. Recommandation : à la reprise, consigne « vérifie avant de refaire une action visible » + ligne dans le chat.

**T23. Plusieurs conversations par bot, origine visible** — importance : moyenne
- **Comportement.** Un bot a plusieurs conversations. Chacune a un titre (donné par l'utilisateur, par ce qui l'a lancée, ou généré en 4 à 6 mots à la fin de la 1re réponse ; modèle de titre réglable ou désactivable). Une icône dit qui l'a lancée (moi, une tâche, une routine, un autre bot, le système) ; filtre « seulement les miennes ». Regroupement facultatif sous le chef qui les a lancées, replié par défaut. Copier l'identifiant de la mission et celui de la session du moteur (pour signaler un problème).
- **Pourquoi.** Les travaux automatiques ne noient pas les échanges de l'utilisateur.
- **Contrôle.** Une routine tourne : sa conversation est marquée « routine » et masquable.
- **Valeurs relevées (v2).** Le titre automatique n'est payé qu'une fois par conversation, après une première réponse réussie, jamais pour une mission automatique ni pour une ancienne conversation reprise ; un échec n'est pas réessayé ; un titre posé à la main gagne même pendant une génération en cours. Choix du modèle de titre : automatique (le plus léger du fournisseur), désactivé, ou un modèle précis ; délai 60 s. Filtres par origine et par état combinables avec le filtre par bot, appliqués avant la limite de la liste ; un filtre inconnu est refusé, pas ignoré.
- **Sklubot.** DIFFÉRENT : un fil par bot avec « générations » (`server/src/routes.ts:952`, `server/src/store.ts:338`) et fils de tâches. Routines et discussion dans le même fil.

**T24. Tout arrêter, vraiment** — importance : haute
- **Comportement.** Écrire « STOP » n'arrête rien (la doc le dit). « Tout arrêter » sur un bot ou un projet : termine les tours, annule les messages en attente (reçus et envoyés), ferme les demandes entre bots sans réponse automatique, passe les tâches en attente ou en cours à « bloquée » avec « arrêté par… », coupe routines et déclencheurs qui les relanceraient, annule et désactive les enchaînements liés, **puis liste tout ce qui a été neutralisé**. Rien n'est supprimé ; reprendre = débloquer et rallumer.
- **Pourquoi.** Un tableau vide ne veut pas dire que rien ne repartira : boîtes, routines et déclencheurs réveillent les bots.
- **Contrôle.** Arrêter un bot avec une routine et 2 messages en file : rapport qui liste les 3 ; rien ne se relance.
- **Valeurs relevées (v2).** Arrêter un projet atteint tous ses bots et ses tâches confiées à d'autres bots ; arrêter un bot annule l'enchaînement pour lequel il travaille, sans relance ni message au chef, et éteint les enchaînements qui le relanceraient ; un redémarrage ne les rallume pas. Un utilisateur qui arrête un bot ne touche pas aux missions d'un autre propriétaire.
- **Sklubot.** PARTIEL : pause d'un bot ou de tous (`server/src/routes.ts:753`, `server/src/pauses.ts`, test `server/test/pause.test.ts`). Pas de rapport, messages déjà en file non annulés.

**T25. Pièces jointes préparées avant le modèle** — importance : moyenne
- **Comportement.** Images réduites (plus grand côté 2 048 px, format compact) avant l'envoi ; refus au-delà de 8 Mo après réduction ; 18 Mo maximum par message, avec le nombre de fichiers laissés de côté ; plus de 3 images se replient en pile. Les autres fichiers sont posés sur la machine et ouverts par le bot avec ses outils ; un moteur qui n'accepte que des images le dit dès l'ajout.
- **Pourquoi.** Moins de coût, moins de refus « image trop grande ».
- **Contrôle.** Joindre une photo de 12 Mpx : le modèle reçoit ≤ 2 048 px.
- **Valeurs relevées (v2).** Budget d'un message : 18 Mo une fois encodé pour le transport (corps de requête plafonné à 25 Mo, refus clair au-delà) ; images, fichiers et texte collé comptent ensemble ; dix photos de téléphone dépassent le budget, une plus petite après elles passe encore. Fichier vide ou trop gros sauté, le reste part, et l'omission est signalée. Pièces jointes de conversation supprimées après 30 jours, jamais celles d'une mission vivante. Un long collage voyage entier, seule sa présentation se replie.
- **Sklubot.** PARTIEL : envois volumineux (`server/src/uploads.ts`, `server/src/uploadparts.ts`, test `server/test/large-attachments.test.ts`). Pas de réduction automatique.

**T26. Le bot montre une image ou une vidéo** — importance : basse
- **Comportement.** Le bot affiche un fichier de sa mission, une adresse https publique (téléchargée et vérifiée par le serveur ; le navigateur de l'utilisateur ne contacte jamais le site) ou une image en ligne (10 Mo). Refus : images vectorielles, fichiers cachés, http simple, adresses IP, réseau local, ports inhabituels, adresses avec identifiants ; le bot reçoit la raison. 1 Go par conversation ; supprimé 30 jours après la fin.
- **Pourquoi.** Montrer un résultat visuel sans exposer l'utilisateur.
- **Contrôle.** Demander l'affichage d'une adresse locale : refus motivé.
- **Sklubot.** FAIT : `file_send` (`server/src/agent/tools.ts:356`), carte fichier (`web/src/components/Transcript.tsx:270`), test `server/test/media-tools.test.ts`.

**T27. Cartes interactives qui attendent la réponse** — importance : moyenne
- **Comportement.** Quand le texte ne suffit pas, le bot affiche une page autonome (tableau, graphique, formulaire) isolée de l'appli, sans réseau ni fichier externe. Un formulaire n'envoie qu'après un **vrai** clic ou appui, une seule fois ; la réponse arrive dans le tour en cours ou comme message dès que le bot est libre. Tous ceux qui voient la mission voient la carte ; seul le propriétaire répond. États affichés (en attente, répondue, expirée, fermée).
- **Pourquoi.** Choisir dans un tableau plutôt que retaper des options.
- **Contrôle.** Un script de la page qui tente d'envoyer seul : rien n'est envoyé.
- **Sklubot.** PARTIEL : aperçu isolé (`server/src/pageroutes.ts:47-48`, `web/src/components/PagePreview.tsx:53`, test `server/test/pages-artifacts.test.ts`) ; pas de réponse renvoyée au bot.

**T28. Aperçu des fichiers dans l'appli** — importance : moyenne
- **Comportement.** Lecture seule sans quitter l'appli : images (navigation flèches gauche/droite dans le dossier, compteur « 3 / 12 », arrêt aux bouts), vidéos, PDF, **documents texte, tableurs (1 000 premières lignes par feuille), présentations** en texte. Fenêtre déplaçable, redimensionnable, ancrable à gauche ou à droite, position mémorisée par appareil ; Échap n'agit que si la fenêtre a le focus. Fichiers texte : aperçu ou édition, enregistrement au clavier, alerte avant de fermer un fichier modifié.
- **Pourquoi.** Vérifier un livrable sans le télécharger.
- **Contrôle.** Ouvrir un tableur : les feuilles s'affichent en texte.
- **Sklubot.** PARTIEL : `web/src/components/SpendSkillsFiles.tsx:341-368` (images, PDF, texte, Markdown, tableur CSV 50 lignes). Manquent bureautique, galerie, édition.

**T29. Plusieurs discussions côte à côte** — importance : moyenne
- **Comportement.** Grille de discussions (2×2, 3×3) ; glisser un bot dans une case ; modèles de grille enregistrés (taille + bot par case, pas les conversations) ; ouvrir une discussion à côté d'une autre page.
- **Pourquoi.** Suivre deux bots qui travaillent en même temps.
- **Contrôle.** Deux bots dans une grille 1×2 : les deux flux défilent en direct.
- **Sklubot.** MANQUANT (`web/src/components/WorkspaceDock.tsx` : pages et outils seulement).

**T30. Barre « qui travaille maintenant »** — importance : basse
- **Comportement.** En haut, un onglet par bot au travail : visage avec anneau animé, état (réfléchit, a besoin de toi, fini), temps écoulé ; épingler, masquer jusqu'à la prochaine mission, réordonner ; glisser un onglet pour ouvrir la discussion à côté.
- **Pourquoi.** Voir tout de suite qui attend une réponse.
- **Contrôle.** Un bot attend un accord : son onglet affiche « a besoin de toi ».
- **Sklubot.** PARTIEL : état dans la liste (`web/src/components/Sidebar.tsx:119-123`), centre de commande (`web/src/components/CommandView.tsx`).

### A.5 Contexte et modèles dans la discussion

**T31. Jauge de contexte et compaction en un clic** — importance : haute
- **Comportement.** Un anneau sous la saisie montre le remplissage de la fenêtre de contexte (rouge dès 40 %), son panneau donne les chiffres, le modèle, le compte. À 80 %, un conseil de compacter apparaît une fois. « Compacter » : sur place quand le moteur le permet, sinon résumé puis nouvelle conversation qui s'ouvre seule (l'ancienne reste) ; ou compacter vers un autre modèle avec un premier message. La progression survit à un rechargement. Dans le fil, une ligne discrète « avant / après » avec « voir le résumé ».
- **Pourquoi.** Comprendre pourquoi le bot oublie, et agir.
- **Contrôle.** Conversation à 85 % : conseil affiché ; après compaction, la jauge baisse et le résumé est consultable.
- **Valeurs relevées (v2).** Fenêtre inconnue : anneau neutre, sans valeur. Une seule compaction à la fois par conversation ; une compaction en cours est suivie, pas relancée ; refus lisible si le bot est en train de répondre ; une compaction sur place sans réponse se termine à une échéance au lieu d'attendre sans fin ; une opération que le serveur ne connaît plus finit en erreur, jamais en barre infinie.
- **Sklubot.** PARTIEL : compaction automatique à 80 % (`server/src/agent/loop.ts:1125-1137`, test `server/test/wave10-context.test.ts`), route manuelle (`server/src/routes.ts:1166`). Ni jauge ni bouton visible ni « voir le résumé ».

**T32. Changer de modèle en cours de route** — importance : moyenne
- **Comportement.** Changer le modèle d'une conversation : tout est transmis si ça tient ; sinon l'ancien modèle résume ; s'il ne peut pas (quota, déconnecté), le nouveau résume ; sinon seule la fin passe, et le chat dit pourquoi. Un compte épuisé est refusé tout de suite avec l'heure de réouverture. Si le nouveau modèle ne démarre pas, la conversation reste sur l'ancien et le dit.
- **Pourquoi.** Continuer sans perdre le fil.
- **Contrôle.** Basculer une longue conversation : le chat indique « résumé par l'ancien modèle ».
- **Valeurs relevées (v2).** Tout l'historique est transmis jusqu'à environ 80 000 jetons ; au-delà, résumé automatique (seuil réglable, 0 = toujours résumer). Résumé par le modèle quitté, sinon par le modèle d'arrivée ; si les deux échouent, les deux raisons sont dites. Un changement sur le même moteur est immédiat ; vers un autre compte, aperçu avec deux choix (tout transmettre, ou résumé). Un tour en cours bloque le transfert, pas un simple changement de modèle sur le même moteur. Si le lancement du nouveau modèle échoue, l'état d'origine est restauré et la raison écrite dans le fil.
- **Sklubot.** PARTIEL : modèle par bot (`web/src/components/BotSettings.tsx:31-54`), pas de transfert expliqué.

**T33. Sélecteur de modèle unique partout** — importance : basse
- **Comportement.** Même sélecteur dans la discussion, la fiche du bot, une tâche, un plan : fournisseurs (chaque compte d'abonnement séparé), favoris liés au compte, recherche dans tous les fournisseurs, fenêtre de contexte, badge « nouveau » une semaine, compte à reconnecter marqué et non sélectionnable, **modèle retiré affiché grisé au lieu d'être remplacé en silence**, saisie libre d'un identifiant, option « hériter » avec ce qui s'appliquerait.
- **Pourquoi.** Jamais de changement de modèle invisible.
- **Contrôle.** Retirer un modèle du catalogue : la fiche du bot l'affiche grisé.
- **Sklubot.** PARTIEL : `BotSettings.tsx`, sélecteur OpenRouter (`web/src/components/AiAccounts.tsx`). Ni favoris ni modèle retiré visible.

**T34. Niveau de réflexion et mode d'autorisation par conversation** — importance : moyenne
- **Comportement.** Sous la saisie : modèle, niveau de réflexion, mode d'autorisation (proposer sans rien changer ; demander avant chaque outil ; modifications libres, le reste demandé ; automatique avec classement ; tout permis, réservé aux administrateurs et confirmé). Le nouveau mode vaut dès le message suivant ; un tour en cours finit dans son mode ; un bot ne peut jamais élever une conversation au-dessus de son propre niveau.
- **Pourquoi.** « Montre-moi d'abord ce que tu ferais » sans risque.
- **Contrôle.** Mode « proposer » : le bot ne modifie aucun fichier.
- **Sklubot.** DIFFÉRENT : autonomie par bot (`server/src/shared.ts:61`, test `server/test/floor-autonomy.test.ts`), réflexion par bot. Pas de mode « proposer seulement » ni de réglage par conversation.

### A.6 Fiabilité sans témoin

**T35. Deux couches de nouvel essai, jamais mélangées** — importance : haute
- **Comportement.** (1) Les essais du fournisseur s'affichent sur **une seule ligne** sous la réponse en cours (« impossible de joindre…, essai 2/5 » avec la raison ; puis « reconnecté après 2 essais »). (2) Quand le fournisseur abandonne : dans une discussion surveillée, bouton « réessayer » qui renvoie le dernier message, **jamais de renvoi caché** ; dans une mission sans témoin (tâche, routine, réveil, sous-mission), le service rejoue le même tour dans la même session **3 fois, à 30 s, 1 min, 2 min**, en demandant de reprendre sans refaire. Limite d'usage, connexion refusée ou demande refusée ne sont jamais rejouées ainsi. Un bot qui attend la réponse de cette mission continue d'attendre ; au dernier échec il est prévenu.
- **Pourquoi.** Une panne de réseau de 40 s ne doit pas tuer une routine de nuit ; un renvoi caché pourrait envoyer un message deux fois.
- **Contrôle.** Couper le fournisseur 45 s pendant une routine : elle aboutit au 2e essai ; dans une discussion, un bouton apparaît.
- **Valeurs relevées (v2).** Relance sans témoin : 3 essais, délai de base 30 s doublé à chaque essai, jamais plus court que l'attente annoncée par le fournisseur ; la consigne de reprise ne répète jamais la demande ; le message final nomme les deux couches d'essais. Pendant ces relances, aucune réponse automatique n'est envoyée au bot demandeur.
- **Sklubot.** PARTIEL : essais à délai croissant dans l'appel (`server/src/agent/reliability.ts:41-48`, `loop.ts:1010-1016`, test `server/test/codex-retry.test.ts`), carte d'échec (`failures.ts`). Pas de relance de tour sans témoin, pas de ligne « essai n/N ».

**T36. Tours muets et tours sans fin** — importance : haute
- **Comportement.** Un tour est arrêté comme bloqué seulement après une **durée sans rien** (45 min par défaut : ni texte, ni progrès d'outil, ni événement) ; un plafond par tour (4 h par défaut, désactivable) arrête même un tour actif, avec sa cause, et sa tâche n'est pas rejouée. Un tour qui attend un accord n'est jamais arrêté par ces délais. Une mission sans témoin dont le tour est fini est libérée après 10 min de silence, ou 1 h si elle a lancé un processus de fond.
- **Pourquoi.** Plus de bot « figé » qu'il faut débloquer à la main.
- **Contrôle.** Fournisseur qui garde la connexion ouverte sans rien envoyer : le tour s'arrête avec la cause « muet trop longtemps ».
- **Valeurs relevées (v2).** Inactivité d'une mission sans témoin après tour : 10 min ; avec un travail de fond : 1 h ; tour muet : 45 min ; plafond de tour : 4 h (0 = sans plafond) ; processus d'une discussion inactive libéré après 1 h (la conversation reste reprenable) ; passage de contrôle chaque minute. Une sortie qui ne réfléchit qu'en interne compte comme activité. Un tour ouvert par le moteur de lui-même est un vrai tour (état, chronomètre, retour) avec le même plafond ; des tours enchaînés sans message de l'utilisateur partagent un budget.
- **Sklubot.** MANQUANT : veille du tour = avis seulement (`server/src/agent/watch.ts`, test `server/test/watch.test.ts`) ; aucun délai sur le flux (`server/src/llm/anthropic.ts`, `server/src/llm/openai-compat.ts`).

**T37. Tâche qui meurt : relances bornées et compteur en base** — importance : haute
- **Comportement.** Une tâche dont la mission s'arrête avant clôture (plantage, délai, processus tué) est relancée 3 fois à quelques minutes d'intervalle ; ensuite elle reste bloquée avec la **dernière erreur du moteur** et la marche à suivre. Un bot qui finit son tour sans clore sa tâche est relancé deux fois (« as-tu fini ? ») ; s'il reste muet, la tâche est close « rien signalé » (une relecture close ainsi se bloque pour décision). Un bot ne peut relancer une tâche ratée qu'en changeant de bot, de moteur ou de modèle, et après un délai ; après 6 échecs, seul l'humain peut relancer, avec un compteur neuf. Le compteur est **lu en base** (un redémarrage ne le remet pas à zéro). Les arrêts par quota, crédit ou moteur indisponible ne comptent pas, sauf s'ils se répètent sans trace de limite dans la sortie (3 fois).
- **Pourquoi.** Incident observé chez la source : un chef relançait sans fin une tâche qui mourait toujours de la même façon.
- **Contrôle.** Tâche qui plante toujours : 3 relances, puis blocage ; un bot qui la relance sans rien changer est refusé.
- **Valeurs relevées (v2).** Relance après mort : délai de 2 min doublé jusqu'à 15 min, jamais avant une date programmée ; plafond dur de morts à partir duquel seul l'humain relance (compteur remis à zéro par lui). Au redémarrage, une mort récente (moins de 24 h) et rejouable est relancée une fois ; plus ancienne, la tâche reste bloquée. Un arrêt par quota consomme une allocation distincte, elle aussi conservée au redémarrage. Programme introuvable ou connexion refusée : nommés comme tels, pas décrits comme un plantage.
- **Sklubot.** PARTIEL : coordinateur d'échecs avec anti-tempête de 10 min (`server/src/agent/failures.ts:342`, test `server/test/failures.test.ts`). Survie du compteur au redémarrage non vérifiée.

**T38. Disjoncteur entre deux bots** — importance : haute
- **Comportement.** Par **paire** de bots (A→B et B→A comptent ensemble), au-delà de N messages écrits par des bots dans une fenêtre glissante, les messages suivants entre eux sont mis de côté (pas livrés, pas de réveil) et l'utilisateur est prévenu. Compteur en base.
- **Pourquoi.** Incident observé : deux bots se réveillaient l'un l'autre, chaque tour payé ; un « STOP » écrit ne marchait pas puisque toute réponse réveille l'autre.
- **Contrôle.** Deux bots qui se répondent en boucle : arrêt au seuil, carte à l'utilisateur, toujours arrêté après redémarrage.
- **Valeurs relevées (v2).** Seuil par défaut : 30 messages en 30 minutes par paire ; la casse du nom ne crée pas une seconde paire ; une saisie humaine ou une idée envoyée depuis le carnet relance la paire ; les retours de tâches ne sont jamais retenus ; un message « libre » (sans demande) ne réveille pas et ne compte pas.
- **Sklubot.** PARTIEL : garde-boucle des salons (`server/src/agent/roombudget.ts:1-30`, `server/src/agent/team.ts` 3 rebonds, test `server/test/roombudget.test.ts`), en mémoire vive ; délégation directe hors salon non couverte (non vérifié).

**T39. Démarrage sur disque en panne** — importance : basse
- **Comportement.** Si le stockage échoue à chaque démarrage, le service ne se relance pas en boucle (incident observé : plus de 4 700 redémarrages qui remplissaient le journal d'un disque déjà plein) ; il s'arrête avec un message clair.
- **Pourquoi.** Ne pas aggraver une panne.
- **Contrôle.** Base illisible : un seul échec journalisé, pas de boucle.
- **Valeurs relevées (v2).** Erreur de stockage au démarrage : message qui nomme la base, l'espace libre et le délai, attente de 60 s, puis sortie ; une base remplacée pendant la marche est attendue, pas relancée en boucle ; avertissement d'espace disque sous 1 Go.
- **Sklubot.** PARTIEL : surveillance du disque (`server/src/diskwatch.ts`), Sentinelle (`server/src/sentinel/`, test `server/test/sentinel.test.ts`). Comportement en boucle non vérifié.

**T40. Réponse tardive livrée seulement si utile** — importance : basse
- **Comportement.** Une décision prise sur une carte après la fin du tour n'est transmise au bot que s'il peut encore agir (mission vivante, tâche non close) ; sinon elle est seulement enregistrée.
- **Pourquoi.** Ne pas réveiller un bot pour rien.
- **Contrôle.** Répondre à une carte d'une tâche close : pas de nouveau tour.
- **Sklubot.** PARTIEL : la réponse à `ask_user` revient en message (`tools.ts:1205-1211`, test `server/test/ask-wait.test.ts`).

### A.7 Abonnements, quotas, rythme

**T41. Bots sur les abonnements existants, comptes multiples** — importance : haute
- **Comportement.** Les bots pensent à travers les abonnements en ligne de commande de l'utilisateur. Un fournisseur peut avoir **plusieurs comptes nommés** (perso, travail), chacun connecté depuis le navigateur de l'utilisateur même si le service tourne sur un serveur. Un administrateur peut prêter un compte à un autre utilisateur sans donner l'identifiant ; un compte « d'instance » sert aux travaux sans propriétaire (routines). États lisibles (connecté, à reconnecter, plus de quota, désactivé). Un échec de connexion ne marque que **ce** compte.
- **Pourquoi.** Utiliser ce qu'on paie déjà, séparer usages perso et pro.
- **Contrôle.** Deux comptes du même fournisseur : chaque bot choisit le sien ; un compte expiré n'arrête pas l'autre.
- **Sklubot.** PARTIEL : connexion d'abonnement dans l'ordinateur du bot (`server/src/subscriptionconnect.ts:12-19`, `server/src/agent/engine.ts`, `web/src/components/AiAccounts.tsx`). Pas de comptes nommés multiples ni de prêt.

**T42. Jauge de quota par compte, « inconnu » ≠ 0 %** — importance : moyenne
- **Comportement.** Un panneau liste chaque compte connecté avec sa consommation réelle et ses fenêtres (heures, semaine), et la tendance ; sous la saisie, les chiffres du compte de la mission. Une mesure impossible s'affiche « inconnu », jamais « 0 % ». Un fournisseur qui ne donne pas d'heure de réouverture ne permet pas de promesse d'heure.
- **Pourquoi.** Savoir s'il reste de quoi lancer un gros travail.
- **Contrôle.** Fournisseur sans mesure : « inconnu ».
- **Valeurs relevées (v2).** Une lecture de quota est réutilisée quelques minutes (5 min pour les plus coûteuses) ; un échec est mis en cache aussi pour ne pas relancer l'outil toutes les 30 s ; « rafraîchir » force une nouvelle lecture ; un fournisseur qui limite les lectures garde les derniers bons chiffres. Un abonnement illimité n'affiche pas de jauge plutôt que 0 %. Un dépassement est borné à 100 %, jamais exprimé en argent. Un compte non connecté est un état, pas une alerte.
- **Sklubot.** PARTIEL : consommation et plafonds (`server/src/usage.ts`, `server/src/usagecaps.ts`, test `server/test/usage-caps.test.ts`), pas de lecture du quota d'abonnement.

**T43. Un refus de quota n'est jamais cru sur parole** — importance : haute
- **Comportement.** Une mise à l'écart enregistrée (« réouverture dans 5 h », souvent estimée à partir d'une phrase) ne décide jamais seule. Avant chaque nouveau tour, le service revérifie : avec la vraie consommation si elle est lisible, sinon par un seul essai toutes les 2 minutes. Un compte rouvert est réutilisé tout de suite.
- **Pourquoi.** Incident observé : tous les travaux refusés pendant 5 h alors que le compte était rouvert depuis longtemps.
- **Contrôle.** Simuler une mise à l'écart de 5 h, rouvrir le compte : le tour suivant passe en moins de 2 min.
- **Sklubot.** MANQUANT : disjoncteur par fournisseur (`server/src/agent/failures.ts`), durée et revérification non vérifiées.

**T44. Bascule sur le secours** — importance : haute
- **Comportement.** Dans une discussion, un quota épuisé fait passer la **même conversation**, historique compris, sur le secours ; sans secours, la discussion attend la réouverture. « Modèle saturé » ≠ plantage : bascule immédiate, sinon 3 essais plus tard. Un compte choisi explicitement ne glisse jamais sur un autre abonnement **sauf** le chef d'une série (sans lui le travail s'arrête) : il passe d'abord sur une autre connexion du même fournisseur appartenant au même propriétaire, puis sur un équivalent. Un chef trouvé arrêté au redémarrage est basculé sans être relancé, avec une carte « bascule automatique ». Jamais de bascule vers un moteur non installé. Une tâche arrêtée par le quota repart seule quand le moteur rouvre (heure annoncée + 2 min) ou qu'un secours la prend, sans compter dans ses relances.
- **Pourquoi.** Incident observé : le chef tombé sur un quota épuisé a provoqué une cascade de missions mortes alors que la moitié des bots avaient encore du quota.
- **Contrôle.** Épuiser le compte du chef pendant une série : il continue sur une autre connexion, les retours sont traités.
- **Valeurs relevées (v2).** Mise à l'écart estimée après une limite : 5 h ; crédit épuisé : 24 h ; une heure exacte annoncée par le fournisseur corrige l'estimation (même pour la raccourcir), une estimation ne prolonge jamais une heure exacte ; marge de 2 min après la réouverture. Une cible de secours non installée ou non connectée est sautée. Ordre : règle de la tâche, du groupe, de la série, réglage global ; une équivalence de même gamme passe avant le secours fixe. Une seule alerte urgente par panne pour un chef bloqué. Un tour avec fichiers n'est pas basculé vers un secours qui ne peut pas les lire.
- **Sklubot.** PARTIEL : chaîne de secours dans la même conversation (`server/src/agent/reliability.ts:18-26`, `loop.ts:1017-1027`, test `server/test/failures.test.ts`). Pas de carte de bascule, pas de reprise automatique des tâches à la réouverture.

**T45. Travail de nuit au rythme des quotas** — importance : moyenne
- **Comportement.** Une série de tâches peut être programmée la nuit et étalée pour rester dans les fenêtres de quota ; une tâche porte une date de début ; les travaux de fond lourds (curateur de mémoire, notation de projets, « rêve ») ont chacun leur créneau de nuit pour ne pas s'empiler.
- **Pourquoi.** Profiter des quotas inutilisés pendant le sommeil.
- **Contrôle.** 10 tâches programmées à 1 h avec quota limité : elles s'étalent, aucune n'échoue pour quota.
- **Sklubot.** MANQUANT (plafonds seulement, `server/src/usagecaps.ts`).

**T46. Fournisseurs gérés dans une page claire** — importance : basse
- **Comportement.** Liste des fournisseurs (connectés / autres) avec un statut chacun et un badge « mise à jour disponible » ; ordre réglable ; « vérifier » relance la détection. Désactiver un fournisseur montre les bots, routines et tâches qui l'utilisent ; leurs choix sont gardés **sans bascule silencieuse** ; le dernier fournisseur actif ne peut pas être désactivé. Par fournisseur : modèles visibles ou cachés, modèle par défaut, ajout d'un modèle. Fournisseur ajouté par fichier : refusé avec la raison sans empêcher le démarrage.
- **Pourquoi.** Comprendre et maîtriser où partent les demandes.
- **Contrôle.** Désactiver un fournisseur utilisé : dialogue qui liste les utilisateurs.
- **Sklubot.** PARTIEL : comptes IA et modèles (`AiAccounts.tsx`, `server/src/providers.ts`).

### A.8 Agents, organisation, identité

**T47. Identité en plusieurs documents** — importance : moyenne
- **Comportement.** L'identité d'un bot = plusieurs documents courts (caractère et règles de fond, consignes particulières, tout document ajouté : style, charte…), affichés rendus avec « modifier », gérables aussi par le bot lui-même et par son chef s'ils n'ont pas un niveau supérieur.
- **Pourquoi.** Séparer « qui il est » de « ce qu'il doit faire aujourd'hui ».
- **Contrôle.** Ajouter un document de style : il apparaît dans ce que le bot reçoit (T49).
- **Sklubot.** PARTIEL : un champ de consignes (`server/src/shared.ts:162`), profil.

**T48. Organigramme et droits de délégation** — importance : moyenne
- **Comportement.** Graphe : pôles, projets, chef de chaque projet, liens hiérarchiques ; glisser un bot sur un autre pour qu'il en dépende (annulable) ; replier les sous-bots (un groupe replié s'allume si un caché travaille). Un bot ne peut lancer un travail ou assigner une tâche qu'à un bot qu'il **dirige** (directement ou par intermédiaire) ; le chef principal et les chefs dirigent tous. Liste manuelle possible, qui remplace alors la hiérarchie. Refus explicite qui nomme les deux bots et la règle. Un bot ne peut pas changer ses droits ni sa place. Parler (messages) reste libre.
- **Pourquoi.** Éviter qu'un bot quelconque mobilise toute l'équipe.
- **Contrôle.** Un bot sans subordonné tente de déléguer : refus motivé.
- **Sklubot.** PARTIEL : délégation libre entre bots du compte (`server/src/agent/team.ts`, test `server/test/room-routing.test.ts`), sections de liste (`server/src/sectionroutes.ts`). Pas de hiérarchie.

**T49. Voir ce que le bot reçoit au démarrage** — importance : haute
- **Comportement.** Un écran liste, numérotés **dans l'ordre où le modèle les reçoit**, tous les morceaux injectés : préambule et description du moteur, consignes globales, identité, rôle, consignes particulières, compétences (entières ou en une ligne, avec leur origine), mémoire (résumé global, règles qui s'appliquent, pièges récents). Les fichiers de projet que le moteur *pourrait* lire seul sont listés à part, non numérotés. Chaque morceau s'ouvre ; ceux qui sont modifiables s'éditent **à leur vraie source**. Les secrets apparaissent masqués, avec l'indication « le bot reçoit la valeur » ou non ; un morceau qui contient un secret ne s'édite pas depuis cet écran. Le texte stable vient d'abord, le variable à la fin.
- **Pourquoi.** Un bot qui dérive suit souvent une consigne oubliée ; c'est le meilleur outil de diagnostic pour un non-développeur.
- **Contrôle.** Ajouter une règle de mémoire : elle apparaît à sa place dans la liste ; la modifier depuis l'écran change la règle.
- **Sklubot.** MANQUANT (prompt construit dans `server/src/agent/prompt.ts`, aucun écran).

**T50. Corbeille des bots** — importance : haute
- **Comportement.** Supprimer un bot le met à la corbeille (consignes, identité, mémoire, compétences, navigateur et ses connexions) ; ses secrets et profils de navigateur prêtés sont **révoqués** dans tous les cas ; un nouveau bot du même nom repart de zéro. « Restaurer » (refusé si le nom est pris) rend tout sauf les secrets et les « toujours autorisé ». Purge après 30 jours (réglable, 0 = jamais). Liste : qui a supprimé, quand la purge aura lieu.
- **Pourquoi.** Un clic de trop ne doit pas effacer des mois de mémoire.
- **Contrôle.** Supprimer puis restaurer : mémoire intacte, secrets à redonner.
- **Sklubot.** MANQUANT : suppression définitive (`server/src/routes.ts:685-691`).

**T51. Dupliquer, renommer, exporter, importer** — importance : moyenne
- **Comportement.** Dupliquer (mémoire vide). Renommer : tout suit (missions, tâches, routines, déclencheurs, secrets, profils, liens). Exporter un, plusieurs ou tous les bots en archive : nom, consignes, identité, règles de mémoire, compétences, connecteurs (noms des secrets seulement), routines (avec leur état), visage, équipe, rôle, modèle ; **jamais** de valeurs secrètes, conversations ni journaux ; un connecteur qui lance un programme local n'est pas recréé. Import avec aperçu (créer / mettre à jour / ignorer), dossier introuvable signalé avec proposition d'un dossier voisin, modèle absent remplacé par le défaut ; réimporter met à jour sans dupliquer sauf modifications locales.
- **Pourquoi.** Changer de machine ou partager une équipe sans fuite.
- **Contrôle.** Exporter un bot avec un connecteur à clé : l'archive ne contient que le nom de la clé.
- **Valeurs relevées (v2).** Renommage refusé tant qu'une mission du bot est vivante ; si une écriture échoue, tout est remis comme avant ; une règle de filtre contenant exactement l'ancien nom est déplacée, une règle ambiguë est signalée, jamais réécrite. Import depuis un autre outil : aperçu, échec au milieu d'un bot = ce bot et ce qu'il a créé retirés (les autres importés), routines importées éteintes, secrets réduits à leurs noms, un bot modifié à la main n'est pas écrasé (l'aperçu le dit), un nom pris reçoit un suffixe ; le dépôt d'archive est à usage unique et refusé s'il a changé entre l'aperçu et l'application.
- **Sklubot.** PARTIEL : dupliquer (`server/src/routes.ts:720-724`), fichier d'équipe (`server/src/teammd.ts`, test `server/test/team-markdown.test.ts`), import Grok (`server/src/grokimport.ts`, test `server/test/grok-import.test.ts`). Le fichier d'équipe ne porte ni mémoire ni routines (`server/src/shared.ts:1109`).

**T52. Siège du bot principal** — importance : moyenne
- **Comportement.** Un seul bot reçoit les messages du système (récapitulatifs, notifications). Il ne peut pas être supprimé ; pour le changer, l'utilisateur le désigne (jamais un bot). Siège vide : pris automatiquement s'il n'y a qu'un candidat, sinon carte qui liste les candidats. Une tâche bloquée est signalée une seule fois à son chef, pas à chaque redémarrage ; une tâche bloquée par l'humain n'est pas signalée.
- **Pourquoi.** Toujours un destinataire clair aux alertes.
- **Contrôle.** Supprimer le bot principal : refus.
- **Sklubot.** FAIT : refus de suppression du bot principal (`server/src/routes.ts:687`).

**T53. Rôles partagés modifiables** — importance : basse
- **Comportement.** Rôles prédéfinis dont on peut modifier le texte (marqués « modifié », « rétablir ») ; le changement vaut pour tous les bots de ce rôle au prochain lancement ; les rôles non modifiés suivent les mises à jour du produit.
- **Pourquoi.** Corriger un comportement pour toute l'équipe en un endroit.
- **Contrôle.** Modifier le rôle relecteur : tous les relecteurs l'appliquent.
- **Sklubot.** PARTIEL : modèles d'équipe (`server/templates/*.md`, `web/src/components/TeamModels.tsx`).

**T54. Avatar vivant** — importance : basse
- **Comportement.** Visage au choix : emoji, image téléversée et cadrée, mascotte configurable. La mascotte montre l'état du bot (réfléchit, attend, écrit) partout ; une seule bulle animée à la fois ; option pour figer, et respect du réglage système « réduire les animations ».
- **Pourquoi.** L'état se lit sans texte.
- **Contrôle.** Réglage « réduire les animations » : aucune animation.
- **Valeurs relevées (v2).** Une image de visage ou de profil doit être servie par le produit lui-même : une adresse d'image externe est refusée (elle pourrait renseigner un tiers).
- **Sklubot.** PARTIEL : personnage dessiné (`web/src/components/CharacterEditor.tsx`, `Character.tsx`) ; pas de photo.

**T55. Les bots lisent la documentation du produit** — importance : moyenne
- **Comportement.** Chaque bot peut chercher et lire, hors ligne, la documentation de la version installée, pour aider l'utilisateur à configurer.
- **Pourquoi.** « Comment je règle ça ? » reçoit une réponse juste.
- **Contrôle.** Demander au bot comment activer une option : il cite la bonne page.
- **Sklubot.** PARTIEL : guides de tâches (`server/src/agent/guides.ts:100-103`), pas la doc du produit.

**T56. Consignes globales** — importance : moyenne
- **Comportement.** Un seul texte, modifiable dans les réglages, pour ce qu'on veut de **tous** les bots (langue, style, habitudes).
- **Pourquoi.** Ne pas répéter la même consigne à chaque bot.
- **Contrôle.** Écrire « réponds en français » : un nouveau bot le fait.
- **Sklubot.** PARTIEL : règles par compte (`server/src/rules.ts`), consignes de section (migration `server/src/migrations/028-section-instructions.ts`).

### A.9 Accords, secrets, sécurité

**T57. Carte d'accord lisible** — importance : haute
- **Comportement.** La carte nomme l'outil dans la langue de l'utilisateur (service + action), son identifiant technique en petit, et une phrase sur ce qu'il fait (la description donnée par le bot pour une commande, sinon une phrase courte).
- **Pourquoi.** Décider vite et en connaissance.
- **Contrôle.** Accord pour écrire un fichier : « écrit tel fichier ».
- **Sklubot.** FAIT : `server/src/agent/loop.ts:1803` (`waitForApproval`), `web/src/components/Cards.tsx`, test `server/test/security.test.ts`.

**T58. Montrer le contenu du script qu'on approuve** — importance : haute (ordinateur personnel)
- **Comportement.** Quand une commande lance un fichier du dossier de travail (script par chemin, script passé à un interpréteur, commande enveloppée), la carte montre un extrait du fichier et son empreinte. Un fichier hors du dossier, un lien qui en sort, un chemin que seul le shell résoudrait est nommé avec la raison, non lu. Fichier trop gros : premières lignes seulement et pas d'« autoriser ». **Si le fichier change entre la carte et le clic, la commande ne part pas** et une nouvelle carte est demandée. Un fichier absent qui apparaît avant le clic compte comme un changement. Rien n'est jamais exécuté pour préparer la carte.
- **Pourquoi.** Un dépôt cloné peut cacher n'importe quoi derrière un nom rassurant ; un clic l'exécuterait avec les droits de l'utilisateur.
- **Contrôle.** Le bot modifie le script après l'apparition de la carte : la commande est refusée.
- **Sklubot.** MANQUANT (utile pour le Relais : `server/src/agent/mycomputer.ts`, test `server/test/relay.test.ts`).

**T59. « Pour la session » et « toujours », au plus juste** — importance : haute
- **Comportement.** « Pour cette session » et « toujours » couvrent **la même chose exactement** : même commande (approuver un test n'approuve pas « test puis tout effacer »), même fichier, même domaine, même appel avec les mêmes arguments. Une approbation de commande retient l'état des fichiers qu'elle lance et ne vaut que tant qu'ils n'ont pas changé. Survol = ce qui est couvert. Quand la cible est indéterminable, seul « autoriser une fois » est proposé. L'approbation appartient à l'utilisateur et à ce bot ; un bot ne peut pas se la donner ; une liste « toujours autorisé » permet de révoquer.
- **Pourquoi.** Ne pas ouvrir plus que ce qu'on croit.
- **Contrôle.** « Toujours » sur une commande, puis la même commande suivie d'une autre : nouvelle carte.
- **Sklubot.** PARTIEL : « toujours » et « pour cette conversation » (`server/src/agent/loop.ts:1868`), jamais pour un envoi (`server/src/agent/irreversible.ts:8`), test `server/test/wave5.test.ts`. Portée exacte et liste révocable non vérifiées.

**T60. Cartes sans témoin qui expirent avec un compte à rebours** — importance : haute
- **Comportement.** Une carte ouverte par une mission sans témoin affiche le temps restant ; à l'échéance, le bot est **prévenu qu'il n'a pas eu de réponse et continue sans**. Délais distincts : accord sans téléphone prévenu (5 min), accord après notification arrivée sur un appareil (35 min), formulaire (30 min) ; tous inférieurs au délai de tour muet. Une discussion de l'utilisateur n'expire jamais. Un formulaire qui revient reprend ce qui avait été coché.
- **Pourquoi.** Une routine de nuit ne reste pas bloquée jusqu'au matin, et l'utilisateur sait combien de temps il a.
- **Contrôle.** Routine qui demande un accord sans réponse : après le délai, la routine finit en disant ce qu'elle n'a pas fait.
- **Valeurs relevées (v2).** Délai de grâce de 30 s si la page qui attend la carte se reconnecte ; une carte abandonnée refuse une réponse tardive au lieu de se rouvrir ; la carte affiche le temps restant en horloge et « expire » au lieu d'un temps négatif. Attente maximale d'une décision : 40 min.
- **Sklubot.** PARTIEL : expiration après 25 min (`server/src/config.ts:188-191`) et rappel (`config.ts:185`), pas de compte à rebours ; comportement à l'échéance non vérifié.

**T61. Secrets jamais vus par les bots** — importance : haute
- **Comportement.** Coffre ; valeurs jamais réaffichées par défaut ; « afficher » demande le mot de passe et montre 30 s (réservé aux administrateurs connectés en local) ; un bot peut créer un secret ou en demander un par un formulaire ; il peut appeler un service sous l'identité d'un secret sans le voir.
- **Pourquoi.** Une fuite par le modèle devient impossible.
- **Contrôle.** Le bot appelle un service avec une clé : la clé n'apparaît dans aucun échange.
- **Sklubot.** FAIT : relais de clés (`server/src/egress.ts:129`), carte secret et clés collées (`server/src/pastedsecrets.ts`), masquage (`loop.ts:1734`), tests `server/test/security-fixes.test.ts`, `server/test/security.test.ts`. (Pas de « révéler 30 s » : choix plus strict.)

**T62. Clôture du système autour de chaque mission** — importance : moyenne
- **Comportement.** Selon le système, chaque mission tourne dans une clôture : dossier personnel en lecture seule, écriture dans son dossier seulement, exceptions par bot ou projet (dossier inscriptible, socket). Mode automatique / obligatoire / désactivé. Cache de paquets propre à chaque bot. Là où la clôture n'existe pas, la doc dit clairement ce qu'une mission peut lire.
- **Pourquoi.** Une mission ne lit pas les clés du service.
- **Contrôle.** Une mission tente de lire un fichier du service : refus.
- **Sklubot.** DIFFÉRENT (plus fort) : un conteneur par bot, réseau isolé (`docker/desktop`, `deploy/bots-firewall.sh`, test `server/test/isolation.test.ts`).

**T63. Journal réseau par mission et alerte « nouvel hôte »** — importance : moyenne
- **Comportement.** Option : chaque connexion sortante passant par le relais du service est notée (hôte, port, méthode, statut, octets, durée, erreur). Vue par mission : hôtes contactés (les nouveaux en tête avec un badge), connexions récentes, « plus ancien ». **Notification au premier hôte jamais contacté par ce projet.** 2 000 connexions par mission, 30 jours. La vue dit franchement ce qu'elle ne voit pas (programmes qui ignorent le relais). Désactivé : la vue le dit et explique comment l'activer.
- **Pourquoi.** Savoir à qui un bot a parlé ; repérer une fuite après une injection.
- **Contrôle.** Le bot contacte un site nouveau : notification.
- **Valeurs relevées (v2).** Désactivé par défaut. Première connexion vers un hôte nouveau : alerte immédiate ; les suivantes regroupées par fenêtres de 15 min ; aucune alerte quand rien de nouveau. Aucun identifiant, chemin ni paramètre d'adresse n'est journalisé ; une requête sans identifiant de mission est refusée par le relais.
- **Sklubot.** MANQUANT (le relais `server/src/egress.ts` sert aux clés, pas de journal).

**T64. Connecteurs vérifiés sur leurs adresses réelles** — importance : moyenne
- **Comportement.** L'adresse d'un connecteur déclarée par un bot ou un module doit être publique et non locale, jugée sur **toutes ses adresses résolues**, deux fois : à l'enregistrement et à chaque lancement (le DNS peut changer). Une tâche n'hérite pas des connecteurs du compte, sauf si son rôle les liste ; une liste d'outils de lecture peut être autorisée sans carte.
- **Pourquoi.** Un nom de domaine peut pointer vers le réseau interne.
- **Contrôle.** Connecteur dont le nom résout vers une adresse locale : refusé au lancement.
- **Sklubot.** PARTIEL : `server/src/net.ts`, `server/src/teammcp.ts`, test `server/test/team-mcp.test.ts` ; seconde vérification non vérifiée.

**T65. Appareils reliés et machines multiples** — importance : basse
- **Comportement.** Relier un appareil par un code à usage unique valable 5 min, émis seulement depuis la machine elle-même ; liste (nom, état, date, dernière connexion, adresse) ; révocation ; avertissement net : un appareil relié a tous les droits du compte. Option : piloter plusieurs machines depuis une interface, avec leur état.
- **Pourquoi.** Accès depuis le téléphone sans exposer le service.
- **Contrôle.** Code expiré : refusé.
- **Valeurs relevées (v2).** Une mauvaise saisie brûle le code (même le bon est refusé ensuite) ; la saisie est limitée par adresse ; un appareil inactif depuis 90 jours est refusé ; un appareil révoqué est refusé dès sa requête suivante et ses flux ouverts sont coupés ; chaque appairage est notifié et journalisé.
- **Sklubot.** FAIT pour l'appairage : `server/src/relay.ts`, `web/src/components/MyComputer.tsx`, test `server/test/relay.test.ts`. Plusieurs machines : NE PAS REPRENDRE (serveur central).

### A.10 Mémoire et compétences

**T66. Mémoire qui apprend en trois temps** — importance : haute
- **Comportement.** (1) **Capture** en fin de mission, réussie ou ratée (les pièges naissent des échecs), par un petit modèle sans lancer d'agent, au-delà de quelques messages ; faits bruts non injectés. (2) **Curateur de nuit** par projet : à partir des faits et des règles existantes, décide nouveau / fusion / remplacement (l'ancienne gardée comme « remplacée ») / rejet ; garde-fous (une fusion doit viser une règle existante) ; **chaque décision journalisée et réversible** ; l'utilisateur reçoit un résumé et peut s'opposer après coup. (3) **Promotion** : un fait vu plusieurs fois chez un bot est **proposé** comme règle d'équipe, jamais écrit seul. Les pièges récents sont rappelés en attendant la synthèse. Les faits bruts non confirmés s'oublient.
- **Pourquoi.** La mémoire s'améliore sans que l'utilisateur valide chaque ligne, mais il peut tout défaire.
- **Contrôle.** Une fusion de nuit : visible dans un journal avec « annuler ».
- **Valeurs relevées (v2).** Capture de faits désactivée par défaut ; synthèse de nuit à 3 h (fenêtre de 4 h), seulement à partir de 5 faits, 80 au plus par passe, passes espacées de 90 s ; promotion désactivée par défaut (seuil : 3 occurrences, passage toutes les 6 h) ; oubli progressif désactivé par défaut (demi-vie 30 jours). Mémoire désactivée = aucune règle rappelée et préambule sans section mémoire.
- **Sklubot.** PARTIEL : consolidation au repos (`server/src/agent/memory.ts:137,311-319`), confiance et oubli (`server/src/agent/prompt.ts:24-33`), carte de contradiction (`memory.ts:182`), test `server/test/memory-guard.test.ts`, rappel `server/test/memory-recall.test.ts`. Ni journal réversible ni promotion.

**T67. Retirer une règle = repartir propre** — importance : haute
- **Comportement.** Supprimer, réécrire ou désactiver une règle de mémoire (par l'utilisateur, un module ou le curateur) fait repartir d'une conversation neuve, à leur prochaine mission, **tous les bots qui ont pu la voir** (même portée que le rappel), parce que l'ancienne conversation contient encore la règle.
- **Pourquoi.** Sinon une règle supprimée continue d'agir sans que personne le sache.
- **Contrôle.** Supprimer une règle : le bot ne l'applique plus à la mission suivante.
- **Sklubot.** MANQUANT.

**T68. Portées de mémoire** — importance : moyenne
- **Comportement.** Règles courtes par portée (tous, projet, rôle, bot) et par nature (piège, décision, préférence) ; une règle globale ou « toujours injectée » exige un administrateur ; une règle écrite par un module porte son origine que personne d'autre ne peut usurper.
- **Pourquoi.** Une leçon apprise par un bot sert à toute l'équipe concernée.
- **Contrôle.** Règle de projet : tous les bots du projet la reçoivent, pas les autres.
- **Sklubot.** PARTIEL : notes par bot et profil (`server/src/agent/prompt.ts:187-221`) ; mémoire d'équipe manquante (COUVERTURE).

**T69. Récapitulatif global, notation des projets, idées de nuit** — importance : basse
- **Comportement.** Le bot principal reçoit, sans appel de modèle, un récapitulatif borné des projets (actifs / dormants, objectifs). Chaque nuit, une passe note le potentiel et l'avancement de chaque projet actif (seulement s'il a bougé depuis la dernière note) pour signaler **le projet presque fini laissé dormant**. Une autre passe propose des pistes (amélioration, opportunités appuyées sur des signaux web) **à valider, jamais exécutées**.
- **Pourquoi.** Aider un propriétaire dispersé à finir ce qui compte.
- **Contrôle.** Un projet à 90 % inactif depuis 3 semaines : signalé.
- **Valeurs relevées (v2).** Récapitulatif : projets actifs dans les 30 derniers jours, 6 au plus, 2 500 caractères. Notation à 5 h (fenêtre 2 h), un projet re-noté seulement après 14 jours ou s'il a bougé. Passe d'idées à 6 h : 4 projets au plus, 2 pistes d'amélioration par projet, 3 opportunités, sans répéter une piste vue dans les 30 jours.
- **Sklubot.** PARTIEL : vue du jour (`server/src/today.ts`, test `server/test/today.test.ts`), pépites et idées (`server/src/ideas.ts`).

**T70. Notes lisibles hors de l'appli** — importance : basse
- **Comportement.** Option : un dossier de notes de l'utilisateur sert de mémoire lisible (leçons écrites par un bot documentaliste après les longues conversations, garde anti-récursion, verrou posé avant le lancement pour ne jamais dupliquer).
- **Pourquoi.** L'utilisateur relit et corrige la mémoire avec ses outils habituels.
- **Contrôle.** Après une longue conversation, une note apparaît dans le dossier, une seule fois.
- **Sklubot.** MANQUANT.

**T71. Compétences : catalogue ou texte entier, au choix** — importance : moyenne
- **Comportement.** Une compétence est un dossier (instructions + fichiers annexes). Par compétence et par bot : **catalogue** (une ligne dans le prompt, lecture à la demande, annexes lisibles une par une) ou **entière** (toujours injectée, pour une procédure à suivre absolument). Un bot distant sans accès aux fichiers reçoit tout en entier (et l'écran le dit). Le poids de chaque compétence est affiché.
- **Pourquoi.** Une procédure critique n'est jamais « oubliée » faute d'avoir été lue.
- **Contrôle.** Passer une compétence en « entière » : elle apparaît intégralement dans ce que le bot reçoit.
- **Sklubot.** DIFFÉRENT : automatique selon la taille totale (`server/src/agent/prompt.ts:223-231`), test `server/test/skills-library.test.ts`.

**T72. Portées et exclusions de compétences** — importance : moyenne
- **Comportement.** Une compétence peut être attachée à tous les bots, un projet, un rôle ou un bot, en catalogue / entière / **exclue** ; la portée la plus étroite décide. La fiche du bot montre les compétences héritées avec « exclure pour ce bot ». Effet au prochain lancement ; un changement ciblant un bot peut interrompre son processus pour repartir à jour.
- **Pourquoi.** Gérer 30 bots sans cocher 30 fois.
- **Contrôle.** Compétence pour tous, exclue pour un bot : ce bot ne la reçoit pas.
- **Sklubot.** PARTIEL : compétences partagées entre bots du compte (`prompt.ts:233-236`, `server/src/store.ts:590`).

**T73. Vérifier qu'une compétence est lue** — importance : moyenne
- **Comportement.** Le service compte les lectures de chaque compétence par bot ; l'écran montre si un bot la lit ; conseils pour écrire une description qui déclenche la lecture.
- **Pourquoi.** Savoir si une compétence sert à quelque chose.
- **Contrôle.** Après une tâche qui l'utilise, le compteur augmente.
- **Valeurs relevées (v2).** Les lectures sont comptées sur 30 jours ; une lecture par un outil de lecture ou une commande qui ouvre le fichier compte ; sur un moteur dont on ne peut pas mesurer les lectures, aucune compétence n'est dite « jamais lue ».
- **Sklubot.** MANQUANT (table sans compteur, `server/src/migrations/001-baseline.ts:62-65`).

**T74. Apprendre un parcours en le montrant** — importance : haute
- **Comportement.** Bouton « enregistrer » dans le navigateur ; les étapes (aller à, cliquer, saisir, entrée, onglets, connexion enregistrée) sont listées et relisibles ; **mots de passe, codes à usage unique et données de carte ne sont jamais enregistrés** (remplacés par un repère masqué) ; cadres intégrés notés « étape manuelle ». « Apprendre » : un bot lit l'enregistrement une fois et écrit une compétence rejouable ; au rejeu, il s'arrête pour les codes et demande à l'utilisateur de les taper lui-même (donc impossible sans personne devant l'écran). Rejouable à la demande, par tâche ou par routine.
- **Pourquoi.** Apprendre une démarche à un bot sans rien écrire.
- **Contrôle.** Enregistrer une connexion : aucun mot de passe dans l'enregistrement.
- **Valeurs relevées (v2).** Un enregistrement garde au plus 1 000 étapes et 1 Mo, et dit s'il a été tronqué ; une étape que la capture n'avait pas masquée l'est à nouveau avant stockage ; brouillons supprimés après 7 jours ; la mission qui apprend n'a accès qu'aux pages de l'enregistrement, sans lecture de fichiers ni connecteur, et ne pose que des questions.
- **Sklubot.** PARTIEL : « montre-moi » (`server/src/teach.ts`) ; masquage des champs sensibles et liste d'étapes relisible non vérifiés.

**T75. Annoter une page pour dire quoi changer** — importance : moyenne
- **Comportement.** Bouton « annoter » dans le navigateur : cliquer un élément, écrire la consigne ; le bot de la discussion reçoit la consigne, l'élément et une image de celui-ci. Historique par page avec état (en attente, envoyée…). Après changement de modèle, le bot relit les annotations.
- **Pourquoi.** Le geste le plus clair pour faire corriger une page ou un site.
- **Contrôle.** Annoter un bouton : le bot reçoit l'élément et l'image.
- **Valeurs relevées (v2).** Consigne : 4 000 caractères ; vignette : 200 Ko ; le texte et le code de la page ne sont transmis que pour une page locale ou de développement ; annotations gardées 7 jours, 1 jour une fois traitées ; contenu chiffré au repos.
- **Sklubot.** MANQUANT.

**T76. Outils de débogage du navigateur pour le bot** — importance : basse
- **Comportement.** Le bot lit la console et les erreurs, inspecte les requêtes et réponses (cookies et en-têtes d'autorisation toujours cachés), ralentit réseau ou processeur (et le rétablit), mesure le chargement. Profil persistant par projet (connexions gardées).
- **Pourquoi.** Un bot qui fait un site peut voir ses erreurs.
- **Contrôle.** Page avec une erreur de script : le bot la cite.
- **Sklubot.** MANQUANT pour la console et le réseau (outils par éléments `server/src/agent/elements.ts`, test `server/test/elements.test.ts`) ; profil persistant par bot : FAIT (`server/src/computer.ts`, test `server/test/linux.test.ts`).

### A.11 Routines, déclencheurs, enchaînements

**T77. Routines planifiées** — importance : haute
- **Comportement.** Routine à heure fixe ou récurrente, fuseau horaire, activable ; les routines proposées par le bot à l'accueil sont créées **éteintes**.
- **Pourquoi.** Travail régulier sans y penser, jamais allumé à l'insu de l'utilisateur.
- **Contrôle.** Routine proposée à l'accueil : éteinte tant que l'utilisateur ne l'allume pas.
- **Sklubot.** FAIT : `server/src/routines.ts:143`, `server/src/cron.ts`, rattrapage `server/src/scheduler.ts:183-193`, test `server/test/features.test.ts`.

**T78. Webhooks entrants filtrés, signés, regroupés, testables** — importance : haute
- **Comportement.** Filtre sur le contenu (un appel hors filtre reçoit « ignoré : filtre », journalisé). Signature par secret partagé vérifiée. **Regroupement des rafales** : clé de regroupement, période de calme, plafond (une fiche modifiée 5 fois = un seul réveil). « Envoyer un exemple » : voir ce que feraient les actions sans rien faire (case pour vraiment exécuter). Journal des appels. Codes de réponse clairs pour l'expéditeur. Doc pour exposer l'adresse quand le service n'écoute qu'en local.
- **Pourquoi.** Un service bavard ne coûte pas 5 tours ; un inconnu qui connaît l'adresse ne déclenche rien.
- **Contrôle.** 5 appels en 3 s avec la même clé : un seul tour.
- **Valeurs relevées (v2).** Formats de signature reconnus pour les forges courantes et les webhooks standard, fenêtre anti-rejeu de ±300 s, rejeu détecté même si l'identifiant de livraison change ; un appel forgé ne consomme pas le budget de l'adresse ; un webhook sans signature n'accepte que des appels de la machine elle-même (jamais via un proxy ni une page web) ; secret affiché une seule fois ; rotation avec 24 h pendant lesquelles l'ancien et le nouveau secret marchent.
- **Sklubot.** PARTIEL : jeton dans l'adresse et limite de débit (`server/src/routes.ts:400-420`). Manquent filtre, signature, regroupement, test à blanc, journal.

**T79. Déclencheurs sur événements internes et actions variées** — importance : moyenne
- **Comportement.** Sources : planning, webhook, **événement interne** (tâche finie, idée résolue, bot renommé…). Actions : lancer un bot, **envoyer un webhook sortant**, gabarits, retour silencieux, lancer un script, lancer un enchaînement. Un déclencheur suit le renommage d'un bot. Les bots gèrent les déclencheurs par outils (créer, lister, tester, supprimer).
- **Pourquoi.** Relier l'équipe à d'autres systèmes dans les deux sens.
- **Contrôle.** « Quand une tâche finit, prévenir tel service » : le webhook sortant part une fois.
- **Valeurs relevées (v2).** Deux déclencheurs d'événements ne s'alimentent jamais l'un l'autre ; une tâche ouverte par un déclencheur peut être « silencieuse » (pas de retour au chef) et le reste si elle est relancée ; un bot ne peut ni élargir un déclencheur au-delà de ses droits ni modifier un déclencheur qui lance un script.
- **Sklubot.** PARTIEL : déclencheurs e-mail, page, événements natifs (`server/src/scheduler.ts:153-164`, `server/src/native/triggers.ts`). Pas d'événement interne ni de webhook sortant.

**T80. Éditeur d'enchaînements** — importance : basse
- **Comportement.** Éditeur visuel : nœuds (déclencheurs multiples, agents, logique, actions, étape humaine, mémoire, sortie), sorties « réussi / échoué », requête HTTP, boucle uniquement par un lien marqué « boucle » avec un maximum (3 par défaut, 100 au plus), rangement automatique en colonnes.
- **Pourquoi.** Construire un processus réutilisable.
- **Contrôle.** Boucle sans maximum : refusée.
- **Valeurs relevées (v2).** Brouillon et version publiée séparés : exécuter le brouillon ne remplace pas la version publiée ; publication refusée si un réglage est invalide (le champ fautif est nommé) ; nœud de requête HTTP : https, réseau privé refusé sauf droit d'administrateur, redirection vers une adresse de métadonnées refusée, délai 30 s par défaut et 300 s au plus, réponse 1 Mo au plus ; étape humaine avec délai et sortie « expiré » ; un bot peut proposer un enchaînement, seule une personne l'accepte, l'acceptation ne publie pas.
- **Sklubot.** DIFFÉRENT : méthodes de travail (`server/src/agent/workmethods.ts`), enchaînements du studio vidéo (`server/src/videoworkflows.ts`, test `server/test/studio-workflows.test.ts`).

### A.12 Modules (extensions)

**T81. Modules signés installés à chaud** — importance : basse pour Sklubot
- **Comportement.** Widgets, pages, thèmes, dispositions, fournisseurs, ou un lot de tout ça, ajoutés sans redémarrer. Installation réservée au super-administrateur ; signature vérifiée (« vérifié » décrit la signature, pas l'utilité) ; mode développeur pour les non signés ; un module refusé dit pourquoi (contrat incompatible, signature invalide) ; un module livré qui perd une partie faute d'outil sur la machine dit ce qui manque. Un module fournisseur liste le programme exact qu'il lancera et vérifie qu'il s'identifie comme attendu. Les modules d'un module n'agissent qu'avec les permissions déclarées ; une règle de mémoire écrite par un module ne peut être retirée que par lui (ou un administrateur).
- **Pourquoi.** Étendre sans toucher au cœur.
- **Contrôle.** Module à signature invalide : refusé avec la raison, rien n'est chargé.
- **Sklubot.** NE PAS REPRENDRE pour du code tiers dans le serveur hébergé (risque entre comptes). L'idée de « fiche de permissions déclarées » s'applique déjà aux connecteurs MCP (`server/src/teammcp.ts`).

### A.13 Notifications

**T82. Trois sortes de notifications et une cloche réglable** — importance : moyenne
- **Comportement.** « A besoin de toi » (accord, question), alertes, rapports ; chacune nomme le bot ou le système. Cloche avec badge, « tout lu », archive complète. Choix des sortes listées et du nombre (5 à 100), interrupteur « seulement ce qui m'attend ». Une « a besoin de toi » s'efface seule quand l'action est faite ; après redémarrage, les cartes devenues sans réponse possible sont closes. Bouton « copier » (titre + texte) pour coller une erreur ailleurs.
- **Pourquoi.** Ne rien rater sans être noyé.
- **Contrôle.** Répondre à un accord : sa notification disparaît.
- **Valeurs relevées (v2).** Par défaut : toutes les sortes, 15 lignes ; nombre borné entre 5 et 100 ; la dernière sorte visible ne peut pas être décochée ; le badge ne compte que les sortes visibles ; une notification nomme le bot de sa mission, sinon de sa tâche.
- **Sklubot.** PARTIEL : types et heures calmes (`server/src/push.ts:94-104`, test `server/test/phone.test.ts`) ; pas d'archive in-app ni d'effacement automatique vérifié.

**T83. Notifications système et sons** — importance : basse
- **Comportement.** Notifications système activées par appareil. Sons distincts : tâche démarrée (éteint par défaut, une fois par tâche), tâche faite, tâche bloquée ou échouée, accord demandé, mission finie ; six sons au choix ou fichier personnel (1 Mio, 10 s maximum, refus motivé), volume commun.
- **Pourquoi.** Savoir sans regarder l'écran.
- **Contrôle.** Fichier de 20 s : refusé.
- **Valeurs relevées (v2).** Plusieurs onglets ouverts : un seul joue le son ; une rafale de la même sorte ne joue qu'un son ; un onglet caché laisse le son à un onglet visible ; le début de tâche, activé, affiche aussi une bulle même son coupé.
- **Sklubot.** FAIT pour les notifications système (`server/src/push.ts`, `web/src/components/PushPromptBanner.tsx`) ; sons MANQUANTS.

### A.14 Réglages et données

**T84. Recherche dans les réglages** — importance : basse
- **Comportement.** Un champ cherche dans tous les réglages : noms, descriptions, clés, mots cachés ; sans tenir compte des accents ni de la casse.
- **Contrôle.** Chercher « sombre » trouve l'apparence.
- **Sklubot.** FAIT : `web/src/components/SettingsNavigation.tsx:47` (mots cachés et accents non vérifiés).

**T85. Sauvegardes et rétention** — importance : moyenne
- **Comportement.** Sauvegarde chaque nuit, secrets exclus ; N archives gardées et âge maximum ; l'archive la plus récente toujours gardée ; écriture en fichier temporaire supprimé en cas d'échec ; vérification d'espace (1,5 fois la dernière) avant, sinon sautée avec alerte ; autres échecs signalés après 3 nuits, alerte fermée au succès suivant. Rétention réglable de l'historique des missions (180 jours), des chronologies (90 jours, reconstructibles), des faits bruts de mémoire.
- **Pourquoi.** Filet de sécurité sans remplir le disque.
- **Contrôle.** Disque presque plein : sauvegarde sautée et alerte.
- **Valeurs relevées (v2).** Sauvegarde activée une seule fois par défaut à 3 h 30, jamais réactivée si l'utilisateur l'a éteinte ; 7 archives, sans âge maximal par défaut ; garder zéro archive est refusé ; la purge passe même si l'export échoue. Historique des missions : 180 jours d'inactivité (une mission vivante ou utile à une tâche ouverte garde tout ; une mission purgée le dit) ; chronologies : 90 jours, totaux conservés ; reçus de messagerie : 30 jours.
- **Sklubot.** PARTIEL : `server/src/autobackup.ts`, `server/src/backuparchive.ts`, tests `server/test/auto-backup.test.ts`, `server/test/backup-drill.test.ts` ; rétention de mémoire non réglable (`server/src/privacy.ts`, test `server/test/privacy.test.ts`).

**T86. Langues de l'interface** — importance : moyenne
- **Comportement.** Onze langues ; suit la langue du navigateur ; erreurs du service et raisons de blocage traduites ; ce qu'écrit un bot ou l'utilisateur reste tel quel ; détails techniques cités en anglais.
- **Contrôle.** Passer en espagnol : les raisons de blocage sont en espagnol.
- **Valeurs relevées (v2).** La langue suit d'abord le choix explicite, puis la langue du navigateur (la région compte : une variante régionale lit la langue correspondante), sinon l'anglais. Un message du serveur porte un code stable traduit côté interface ; un code inconnu ou incomplet garde le texte anglais plutôt qu'un texte brut.
- **Sklubot.** PARTIEL : français et anglais (`web/src/i18n/`).

**T87. Statistiques d'usage** — importance : —
- **Comportement.** La source envoie des statistiques anonymes **activées par défaut**.
- **Sklubot.** NE PAS REPRENDRE : Sklubot n'envoie rien, à garder.

**T88. Diagnostic « tout est-il en place ? »** — importance : moyenne
- **Comportement.** Une commande et un écran vérifient le service, les moteurs, les chemins, et disent ce que l'absence d'un outil désactive.
- **Contrôle.** Moteur absent : listé avec la conséquence.
- **Sklubot.** PARTIEL : santé (`server/src/health.ts`), Sentinelle (`server/src/sentinel/`, tests `server/test/sentinel.test.ts`, `server/test/monitor.test.ts`), pas d'écran utilisateur.

### A.15 Accueil

**T89. Accueil en conversation, sans redemander** — importance : haute
- **Comportement.** Après la création du compte : choix de l'IA (abonnement détecté = étape sautée ; « détecter à nouveau » après installation à la main ; commande donnée quand des droits élevés sont nécessaires), profil en un clic (je code / j'automatise / je découvre) qui règle les défauts, création du bot principal (visage, nom), quatre courtes diapositives. Le bot principal **parle le premier**, dans la langue choisie, **sans redemander** ce qui vient d'être dit, et propose : créer un autre bot (il le crée lui-même après accord), créer un projet avec une équipe, mettre en place ce que sa fiche demandait (créé éteint). Le service s'installe pendant ce temps avec une carte de progression. Si le moteur échoue, essai du suivant installé ; sinon cartes pour installer ou se connecter et « réessayer ». « Passer l'accueil » toujours disponible. Hors ligne : création du compte possible par une commande locale.
- **Pourquoi.** Un premier résultat en quelques minutes, sans formulaire.
- **Contrôle.** Nouveau compte avec abonnement déjà connecté : l'étape IA n'apparaît pas ; le bot ne redemande pas son nom.
- **Sklubot.** FAIT pour l'essentiel : `web/src/components/Onboarding.tsx`, recruteur (`server/src/agent/recruit.ts`, test `server/test/recruiter.test.ts`), idées de premières tâches (spec 07 A19). « Ne pas redemander » et bascule de moteur à l'accueil non vérifiés.

**T90. Accès depuis partout** — importance : moyenne
- **Comportement.** Le même service est joignable depuis le bureau, le navigateur, le téléphone, une messagerie et une ligne de commande complète (lancer, envoyer, redresser, attendre la fin d'un tour — une relance du service ne compte pas comme une fin —, état, arrêter).
- **Contrôle.** Par l'API : « attendre » ne rend la main qu'à la vraie fin du tour.
- **Sklubot.** PARTIEL : API bot (`server/src/botapi.ts`, test `server/test/bot-api.test.ts`), Telegram texte seulement (`server/src/telegram.ts:71`), appli mobile et bureau (`mobile/`, `companion/`).

### A.16 Charge et machine

**T91. Plafonds de missions et de tâches simultanées** — importance : haute
- **Comportement.** Au plus 12 missions vivantes et 8 tâches du tableau en parallèle (réglables) ; au-delà de 90 % de charge de la machine, rien de nouveau ne démarre. Quand une place manque, la mission sans témoin inactive depuis le plus longtemps rend sa place ; une discussion de l'utilisateur et un tour en cours ne sont jamais évincés ; une mission qui attend un travail de fond n'est évincée qu'après le plafond de fond. Les tâches « miroir » d'un outil externe ne comptent pas dans le plafond.
- **Pourquoi.** Une rafale de tâches ne doit ni saturer la machine ni couper l'échange en cours.
- **Contrôle.** 15 tâches prêtes : 8 tournent, les autres attendent ; ouvrir une discussion pendant ce temps : elle démarre, une mission inactive cède sa place.
- **Sklubot.** PARTIEL : un tour à la fois par bot (`server/src/agent/engine.ts:188`), plafond d'ordinateurs allumés avec mise en veille du moins récemment utilisé (`server/src/linux.ts:421`). Pas de plafond global de missions ni de seuil de charge.

**T92. Ménagement de la machine le jour et la nuit** — importance : moyenne
- **Comportement.** Deux profils : le jour (8 h–20 h par défaut) moins de processeur, moins de mémoire, priorité basse et au plus 4 missions / 2 tâches ; la nuit, plus large. Une mission a un plafond de mémoire (12 Go par défaut), toujours sous le plafond global. Une pression mémoire forte déclenche une seule alerte par épisode, avant que le système ne tue un processus ; une mission tuée faute de mémoire est nommée avec son plafond et un conseil. Un nouveau réglage s'applique au tour suivant sans changer de profil.
- **Pourquoi.** L'ordinateur reste utilisable pendant la journée ; le gros du travail passe la nuit.
- **Contrôle.** À 10 h, lancer 6 tâches : 2 tournent ; à 21 h, la file s'élargit.
- **Sklubot.** PARTIEL : mémoire et processeurs fixes par ordinateur de bot (`server/src/linux.ts:392-402`). Pas de profil jour/nuit ni d'alerte de pression.

### A.17 Fiabilité (suite)

**T93. Dossier de travail disparu** — importance : moyenne
- **Comportement.** Si le dossier d'un bot ou d'un projet n'existe plus (ou n'est pas un dossier, ou est illisible), le lancement est refusé en nommant le dossier et la raison exacte ; ce contrôle passe avant celui du quota (un dossier absent n'est jamais pris pour un quota épuisé) ; la tâche est bloquée sans relance ni bascule ; une reprise ou une redirection sur un dossier disparu n'est pas comptée comme un plantage.
- **Pourquoi.** Un dossier déplacé à la main ne doit pas déclencher trois relances payantes.
- **Contrôle.** Renommer le dossier d'un projet puis lancer une tâche : blocage immédiat qui nomme le dossier.
- **Sklubot.** MANQUANT (non vérifié pour le dossier d'équipe partagé).

**T94. Moteur qui meurt sans répondre : trace lisible** — importance : haute
- **Comportement.** Quand le moteur s'arrête sans réponse, le fil reçoit un avis qui nomme le moteur, le code de sortie et la fin de ce qu'il a écrit en erreur (la fin, pas le début ; bornée ; sans couleurs, sans chemin personnel, secrets masqués), avec l'identifiant de la mission et de la session. Un programme introuvable et un programme non exécutable sont distingués et donnent le bon geste ; un moteur mort en silence reçoit quand même un avis.
- **Pourquoi.** Jamais de fil vide après un échec.
- **Contrôle.** Retirer le programme du moteur : l'avis dit « introuvable » et comment l'installer.
- **Sklubot.** PARTIEL : fin de la sortie d'erreur gardée et reprise dans l'échec (`server/src/agent/engine.ts:626,850,942`). Pas de nettoyage des chemins ni de distinction introuvable / non exécutable.

**T95. Mise à l'écart d'un moteur qui ne produit rien** — importance : haute
- **Comportement.** Un résultat « stérile » (fin en moins de 2 s sans rien produire) est reconnu sans lire le texte d'erreur. Trois résultats stériles d'affilée en 10 min, par moteur, mettent ce moteur à l'écart 30 min ; un échec de connexion lu dans un champ structuré le met à l'écart dès le premier rebond ; un tour réussi remet le compteur à zéro ; un moteur qui n'a jamais produit un tour n'est écarté que 5 min. Une mise à l'écart mieux informée (crédit épuisé) n'est jamais raccourcie par ce mécanisme ; une mission tuée par lui fait basculer sa série vers son secours.
- **Pourquoi.** Une connexion expirée produit des tours vides en boucle sans message d'erreur clair.
- **Contrôle.** Simuler 3 tours vides : le moteur est écarté, la tâche part sur le secours.
- **Sklubot.** PARTIEL : disjoncteur par fournisseur ouvert 10 min (`server/src/agent/failures.ts:39,154`). Pas de détection des résultats stériles.

**T96. Délais de relance des réveils** — importance : moyenne
- **Comportement.** Un bot qu'on n'arrive pas à réveiller (lancement refusé) est réessayé avec un délai qui double de 30 s à 10 min, avec une seule notification et sans boucle. Un message pour un bot supprimé expire sans lancement ; supprimer un bot vide sa boîte mais garde les alertes humaines. Un message hérite du propriétaire de son expéditeur.
- **Pourquoi.** Une panne passagère ne doit ni noyer l'utilisateur ni faire tourner le service à vide.
- **Contrôle.** Compte du fournisseur révoqué : une notification, des essais espacés, pas de rafale.
- **Sklubot.** PARTIEL : délai croissant 20 s → 2 min pour les tours en échec (`server/src/agent/failures.ts:39,156`). Réveil d'un bot supprimé : non vérifié.

**T97. Arrêt propre du service** — importance : moyenne
- **Comportement.** Sur demande d'arrêt : les étapes d'arrêt enregistrées tournent, puis les modules sont libérés, avec un délai de grâce borné (5 s) au-delà duquel le service sort quand même ; un second signal pendant l'arrêt sort immédiatement ; redemander l'arrêt ne précipite rien. Un tour coupé par l'arrêt laisse dans le fil un avis « coupé par un redémarrage, reprenable », rejoué à un client qui se reconnecte. Les processus des moteurs d'un service mort sont retrouvés et arrêtés au démarrage suivant (sans jamais tuer un numéro de processus réattribué).
- **Pourquoi.** Pas de moteur orphelin qui continue à consommer après un arrêt.
- **Contrôle.** Arrêter pendant un tour : avis dans le fil, aucun processus de moteur restant.
- **Sklubot.** PARTIEL : arrêt sur signal qui ferme serveur, messageries et ordinateurs (`server/src/index.ts:144-155`). Pas de délai de grâce borné, pas de second signal, tours coupés non annoncés.

**T98. Un seul service par dossier de données** — importance : moyenne
- **Comportement.** Un second service lancé sur les mêmes données est refusé avant de toucher quoi que ce soit, avec le numéro de processus et le port de celui qui les tient ; le verrou d'un service mort se reprend sans intervention ; un verrou impossible à prendre pour une autre raison donne un avertissement, pas un blocage.
- **Pourquoi.** Deux services sur la même base la corrompent.
- **Contrôle.** Lancer deux fois : le second s'arrête en nommant le premier.
- **Sklubot.** MANQUANT (non trouvé ; déploiement en un seul conteneur).

**T99. Mise à niveau des données avec copie et retour arrière** — importance : haute
- **Comportement.** Au premier démarrage d'une version plus récente, la base (journal d'écriture compris), la configuration et les données des modules sont copiées avant toute migration ; les 3 dernières copies sont gardées. Sans copie possible, une migration qui ne fait qu'ajouter démarre avec un avertissement, une migration destructive arrête le démarrage et laisse les données intactes. Une copie partielle (place manquante, données trop grosses) est annoncée une fois. Restaurer une copie remplace base et configuration et garde ce qui a été remplacé ; une restauration coupée au milieu est annulée au démarrage suivant ; une copie abîmée est refusée avant tout changement.
- **Pourquoi.** Une mise à jour ratée ne doit jamais coûter les données.
- **Contrôle.** Simuler un disque plein à la mise à jour : l'ancienne version reste utilisable, un message le dit.
- **Sklubot.** PARTIEL : copie de la base avant migration (`server/src/migrations/index.ts:125`). Nombre de copies, blocage des migrations destructives et restauration : non vérifiés.

**T100. Fichiers de données réservés au propriétaire** — importance : moyenne
- **Comportement.** Le dossier de données, la base et ses fichiers annexes, la clé de chiffrement sont accessibles au seul compte système propriétaire ; les droits sont resserrés à chaque démarrage, jamais élargis ; un échec de resserrage est journalisé sans bloquer ; une clé lisible par d'autres est refusée, pas réparée en silence.
- **Pourquoi.** Un autre utilisateur de la machine ne lit pas les conversations ni les secrets.
- **Contrôle.** Élargir les droits de la base, redémarrer : ils sont de nouveau restreints.
- **Sklubot.** PARTIEL : archives de sauvegarde en accès restreint (`server/src/autobackup.ts`, `server/src/backuparchive.ts`). Base et dossier de données : non vérifié.

**T101. Journaux du service datés et bornés** — importance : basse
- **Comportement.** Un fichier de journal par jour, avec heure locale et décalage ; changement de fichier à minuit et au-delà d'une taille de partie ; 14 jours et 200 Mo au total par défaut, le plus ancien supprimé d'abord, jamais le fichier en cours ; lecture des lignes récentes du plus récent au plus ancien.
- **Pourquoi.** Diagnostiquer sans remplir le disque.
- **Contrôle.** Dépasser 200 Mo : les journaux les plus anciens disparaissent.
- **Sklubot.** DIFFÉRENT : journaux sur la sortie standard du conteneur, rotation laissée à l'hébergeur.

**T102. Flux en direct borné et qui se répare** — importance : haute
- **Comportement.** À la reconnexion, le flux d'une mission rejoue les derniers événements de discussion (bornés en nombre et en taille, sans les fragments de jetons) puis le direct, sans doublon. Au-delà d'un plafond de clients, une nouvelle connexion est refusée puis acceptée dès qu'une place se libère ; un lecteur qui ne lit plus est déconnecté après un délai ; une fenêtre qui rouvre le même flux remplace l'ancien. Côté interface, un flux coupé vérifie d'abord que la mission existe, puis rouvre ; un flux silencieux demande au service si le tour est fini ; un tour en préparation est laissé tranquille.
- **Pourquoi.** Un onglet resté ouvert la nuit ne doit ni rater la fin d'un tour ni faire tomber le service.
- **Contrôle.** Couper le réseau 1 min pendant un tour : à la reconnexion, le fil est complet, sans message en double.
- **Sklubot.** PARTIEL : flux d'événements avec battement (`server/src/routes.ts:528-551`). Plafond de clients et rejeu borné : non vérifiés.

**T103. État « tour en préparation »** — importance : moyenne
- **Comportement.** Entre l'envoi d'un message et le vrai démarrage du moteur (lancement, reconstitution d'une session perdue avec son résumé), la mission affiche « en préparation » ; deux préparations qui se chevauchent ne se masquent pas ; une préparation qui échoue n'annonce aucun tour.
- **Pourquoi.** Savoir que le message a été pris pendant une attente qui peut durer.
- **Contrôle.** Envoyer un message à une session perdue : « en préparation » s'affiche jusqu'au premier mot.
- **Sklubot.** MANQUANT.

**T104. Chronologie détaillée d'une mission** — importance : basse
- **Comportement.** Chaque mission a une chronologie (tours, outils, erreurs, durées) reliée à ce qui l'a lancée (tâche, enchaînement, mission parente) ; la vue est paginée, filtrable par sorte, le détail d'une étape se charge à part ; après la rétention (90 jours), les totaux restent et la vue dit ce qui a été retiré ; une chronologie retirée peut être reconstruite pour son propriétaire.
- **Pourquoi.** Comprendre où une mission longue a perdu son temps.
- **Contrôle.** Ouvrir une mission de 200 outils : les étapes se chargent par pages, les totaux sont justes.
- **Sklubot.** PARTIEL : journal d'activité (`server/src/journal.ts`), fils de tâches (`web/src/components/ThreadPanel.tsx`).

### A.18 Travail entre bots

**T105. Demande entre bots avec réponse garantie** — importance : haute
- **Comportement.** Quand un bot fait une demande à un autre, le texte final de la réponse revient automatiquement à la mission exacte qui a demandé, même sans geste explicite de réponse ; une réponse explicite supprime l'automatique ; une seule réponse durable, même après un redémarrage ou une double fin ; un tour échoué ou vide renvoie une issue explicite au lieu de disparaître ; une sortie d'outil ou un ancien tour ne devient jamais la réponse ; rien n'est renvoyé pendant les relances ; un message « libre » reste dans la boîte sans réveiller ; les réponses et notifications ne déclenchent jamais une autre réponse automatique.
- **Pourquoi.** Un chef ne doit pas attendre indéfiniment une réponse qu'un sous-bot a oublié d'envoyer.
- **Contrôle.** Demander à un bot qui répond seulement par du texte : la réponse arrive chez le demandeur, une fois.
- **Sklubot.** PARTIEL : délégation et retour de résultat entre bots (`server/src/agent/team.ts`, test `server/test/room-routing.test.ts`). Garantie d'une seule réponse durable après redémarrage : non vérifiée.

**T106. Équipes de bots cloisonnées** — importance : moyenne
- **Comportement.** Un utilisateur crée, renomme, supprime des équipes qui lui appartiennent. Deux bots d'équipes différentes ne peuvent pas se parler ; l'expéditeur est lu depuis sa mission, jamais depuis le nom qu'il annonce ; un bot d'équipe répond toujours à son chef et à son supérieur ; un refus nomme les deux bots et dit quoi faire ; la liste des bots vue par un bot d'équipe se limite à son équipe et à son chef. Un bot sans équipe garde sa portée habituelle.
- **Pourquoi.** Séparer des clients ou des activités sans risque de fuite entre bots.
- **Contrôle.** Bot de l'équipe A écrit à un bot de l'équipe B : refus motivé.
- **Sklubot.** PARTIEL : rôles et permissions d'espace (`server/src/shared.ts:866-867`, `server/src/workspaces.ts:113`). Pas de cloisonnement des échanges entre équipes de bots.

**T107. Les sous-missions ne questionnent pas l'humain** — importance : moyenne
- **Comportement.** Une sous-mission lancée par un bot qui veut poser une question est renvoyée vers son lanceur, sans carte ; une mission sans témoin et sans référent est invitée à décider seule ; seule la mission que l'utilisateur pilote peut ouvrir le formulaire de plan ; une demande de secret ou de commande d'une mission sans témoin est répondue tout de suite (refus explicite).
- **Pourquoi.** L'utilisateur ne reçoit pas de questions de bots qu'il ne suit pas.
- **Contrôle.** Une sous-mission demande « quel format ? » : la question arrive chez le bot lanceur.
- **Sklubot.** MANQUANT (la question met fin au tour, `server/src/agent/tools.ts:1191`, quel que soit le lanceur ; non vérifié pour les tâches de fond).

### A.19 Questions, commandes et secrets demandés

**T108. Formulaire de questions borné, brouillon gardé** — importance : moyenne
- **Comportement.** Un formulaire porte 1 à 4 questions ; chacune a 2 à 4 options ou est ouverte (texte obligatoire) ; un onglet par question, « suivant » jusqu'à la dernière, « envoyer » à la fin ; un texte libre peut accompagner un choix ; on ne peut pas envoyer tant qu'une question n'a ni choix ni texte ; un choix qui n'est pas une des options n'atteint jamais le bot. Le brouillon est gardé pour la même mission et les mêmes questions. Un formulaire invalide est refusé tout de suite avec la raison adressée au bot ; 3 formulaires invalides d'affilée ferment ce canal, un formulaire valide remet le compteur à zéro.
- **Pourquoi.** Des questions claires sans formulaire infini ni bot qui boucle sur un formulaire mal formé.
- **Contrôle.** Un bot envoie 5 questions : refus qui cite le nombre, aucune carte.
- **Sklubot.** PARTIEL : une question avec réponses toutes prêtes (`server/src/agent/tools.ts:1191`). Pas de questions multiples, de brouillon ni de compteur d'invalides.

**T109. « Je lance la commande moi-même »** — importance : basse
- **Comportement.** Pour une commande d'une seule ligne, la carte d'accord offre trois choix : autoriser, « coller dans mon terminal », refuser (deux choix seulement si le bot ne peut pas l'exécuter). « Coller » enregistre la décision puis tape la commande dans le terminal du projet sans la valider ; si la fenêtre refuse, la décision reste enregistrée et le dit. La commande reste refusée dans le tour ; à la fin du tour, le bot apprend qui l'exécute. Seul le propriétaire peut coller.
- **Pourquoi.** Garder la main sur une commande sensible sans bloquer le bot.
- **Contrôle.** Choisir « coller » : la commande apparaît dans le terminal, non exécutée ; le bot est prévenu.
- **Sklubot.** MANQUANT (pertinent pour le Relais `server/src/agent/mycomputer.ts`).

**T110. Demande de secret avec durée et destination** — importance : haute
- **Comportement.** Un bot demande un secret par une carte qui dit qui demande, pourquoi, pour combien de temps (une fois, la durée de la mission, durable) et où il sera envoyé (hôtes, ou la page d'origine pour un site) ; champ masqué ; « fournir » reste éteint tant que le champ est vide ; le bot apprend le nom et le statut, jamais la valeur. Une valeur « une fois » est consommée par son premier envoi ; deux usages simultanés : un seul gagne. La carte expire après 30 min ; refus, expiration ou fin de mission ferment la carte et préviennent le bot. Après la fin, aucune valeur tapée ne reste en base. Une mission sans témoin est refusée tout de suite.
- **Pourquoi.** Donner une clé à un bot sans qu'elle traîne ni serve ailleurs.
- **Contrôle.** Fournir une valeur « une fois », le bot l'utilise deux fois : le second appel n'a rien.
- **Sklubot.** PARTIEL : carte de secret, valeur jamais vue, liée à un hôte (`server/src/agent/tools.ts:573`, `server/src/egress.ts:18-33`). Pas de durée au choix ni d'expiration affichée.

### A.20 Secrets

**T111. Masquage des secrets partout, même coupés** — importance : haute
- **Comportement.** Toute valeur du coffre d'au moins 12 caractères (en dessous, la lisibilité prime) est masquée dans les conversations, le flux en direct, les notifications, les raisons d'échec et la fin des sorties d'erreur ; la plus longue d'abord quand l'une en contient une autre ; une valeur coupée entre deux fragments du flux n'est jamais émise, même caractère par caractère ; un coffre vide ne retarde rien. Écrire un secret le fait masquer immédiatement.
- **Pourquoi.** Une clé recopiée par le modèle ne doit jamais apparaître à l'écran.
- **Contrôle.** Le modèle écrit une clé en deux morceaux : aucun des morceaux n'atteint l'écran.
- **Sklubot.** PARTIEL : remplacement des valeurs connues (`server/src/store.ts:854-860`, `server/src/agent/loop.ts:1732`). Pas de seuil de longueur ni de garde pour une valeur coupée entre deux fragments.

**T112. Portées, autorisations et relais des secrets** — importance : haute
- **Comportement.** Un nom de secret suit la forme d'une variable d'environnement en majuscules. Un secret sans autorisation n'atteint aucun bot ; portée bot > projet > global quand un nom existe aux trois ; les autorisations s'additionnent. Un secret « relais » n'est jamais injecté : il est ajouté à la requête seulement vers ses hôtes autorisés (hôte exact ou sous-domaine, jamais une sous-chaîne ; liste vide = rien), sans suivre de redirection, et le bot ne peut pas remplacer l'en-tête. Chaque usage est journalisé (le fait, jamais la valeur), même après suppression du secret. Une valeur indéchiffrable coûte une variable, pas tout le lancement.
- **Pourquoi.** Chaque bot ne reçoit que ce qu'il doit, et une clé ne part que vers son service.
- **Contrôle.** Un bot appelle un hôte voisin non autorisé avec un secret relais : refus journalisé, aucun appel.
- **Sklubot.** FAIT pour le relais (`server/src/egress.ts:18-33` : hôtes liés, https, 60 requêtes/min, journal). PARTIEL pour les portées projet / global.

**T113. Rotation de la clé maîtresse sans perte** — importance : moyenne
- **Comportement.** La rotation rescelle toutes les valeurs (secrets, jetons, réglages sensibles) d'un seul bloc ; si une seule ne s'ouvre pas, rien ne change ; une rotation coupée entre l'écriture et la bascule est reprise au démarrage ; une clé introuvable alors que des secrets existent est un refus, jamais une nouvelle clé.
- **Pourquoi.** Changer de clé ne doit jamais rendre le coffre illisible.
- **Contrôle.** Couper le service pendant une rotation : au redémarrage, tous les secrets s'ouvrent.
- **Sklubot.** FAIT : rotation des clés de données avec essai à blanc (`server/src/datakeyrotate.ts:65`). Reprise d'une rotation coupée : non vérifiée.

### A.21 Comptes et accès

**T114. Comptes, rôles et droits par écran** — importance : moyenne
- **Comportement.** Le premier compte est super-administrateur ; le dernier super-administrateur actif ne peut être ni désactivé ni rétrogradé. Un préréglage « employé » n'ouvre que l'accueil et la discussion ; chaque page et chaque carte a son droit ; un module tiers est invisible sans droit explicite. Un refus dit ce qui manque (droit du compte, plafond de la mission, mission sans propriétaire), jamais un « introuvable » trompeur, et ne révèle pas l'existence des données d'autrui. Ce qu'un compte crée lui appartient ; une tâche née d'une mission hérite de son propriétaire.
- **Pourquoi.** Partager l'outil avec une équipe sans tout ouvrir.
- **Contrôle.** Compte « employé » : le tableau et les réglages n'apparaissent pas ; l'appel direct est refusé avec la raison.
- **Sklubot.** PARTIEL : rôles d'espace propriétaire / administrateur / membre (`server/src/shared.ts:866-867`). Pas de droits par page.

**T115. Connexion protégée et sessions** — importance : haute
- **Comportement.** 5 échecs en 15 min verrouillent le compte avec une durée croissante jusqu'à 1 h ; une adresse inconnue est traitée exactement pareil (pas d'indice d'existence) ; le verrouillage est journalisé une fois. Session de 7 jours prolongée quand plus de la moitié est passée, plafond absolu de 30 jours ; une session expirée n'est jamais ravivée. Changer son mot de passe ferme les autres sessions ; changer d'adresse exige le mot de passe actuel et une confirmation à la nouvelle adresse (24 h), l'adresse n'étant appliquée qu'après. Mots de passe hachés avec un coût élevé, revérifiés et ré-hachés si l'ancien coût est détecté.
- **Pourquoi.** Résister aux essais en série sans gêner l'utilisateur actif.
- **Contrôle.** 6 mauvais mots de passe : verrouillage ; changer son mot de passe : l'autre navigateur est déconnecté.
- **Sklubot.** PARTIEL : limitation par adresse et par compte (`server/src/routes.ts:363-370`), sessions hachées de 30 jours (`server/src/auth.ts:8,24-27`), autres sessions fermées (`server/src/store.ts:875`), changement d'adresse confirmé (migration `server/src/migrations/003-account-mail.ts`). Pas de prolongation glissante.

**T116. Codes envoyés par e-mail** — importance : basse
- **Comportement.** Code de 6 chiffres valable 10 min ; 5 erreurs brûlent le code (10 sur l'ensemble de ses renvois) ; renvoi possible après 60 s, qui remplace le code ; 5 envois au plus par demande ; 10 envois par origine en 15 min ; seul un condensé est gardé. L'écran décompte l'attente et indique les essais restants ; un service d'envoi indisponible le dit au lieu d'ouvrir un écran vide.
- **Pourquoi.** Confirmer une adresse sans ouvrir la porte au harcèlement par e-mail.
- **Contrôle.** Demander 11 codes en 15 min : le 11e attend.
- **Sklubot.** DIFFÉRENT : confirmation par lien (`server/src/publicsignup.ts:231`) et code d'application à deux facteurs (`server/src/twofactor.ts:5`).

**T117. Journal d'audit des gestes sensibles** — importance : moyenne
- **Comportement.** Création et désactivation de comptes, changements de droits, refus d'élévation, appairages, approbations : journalisés avec acteur, action et cible ; l'adresse transmise par un intermédiaire n'est notée que si cet intermédiaire est déclaré de confiance ; un geste fait avec le jeton de l'opérateur est attribué au service, pas au premier administrateur ; supprimer une règle de mémoire efface aussi son texte du journal.
- **Pourquoi.** Savoir qui a fait quoi sans garder de données en trop.
- **Contrôle.** Refuser une élévation à un bot : une ligne d'audit apparaît.
- **Sklubot.** FAIT : journal d'audit (`server/src/store.ts:880`).

**T118. Récupération d'un administrateur bloqué** — importance : basse
- **Comportement.** Depuis la machine seulement, l'opérateur peut réinitialiser le mot de passe d'un compte : mot de passe à usage unique affiché une fois, ancienne session coupée, ancien mot de passe refusé ; impossible depuis un navigateur, même super-administrateur.
- **Pourquoi.** Ne jamais rester enfermé dehors, sans créer de porte dérobée en ligne.
- **Contrôle.** Réinitialiser : l'ancien mot de passe échoue, le nouveau marche une fois puis doit être changé.
- **Sklubot.** FAIT : commande de réinitialisation (`server/src/reset-password.ts:4`).

**T119. Exposition réseau prudente** — importance : haute
- **Comportement.** Le service n'écoute que sur la machine par défaut ; l'exposer est un choix explicite, sans joker ni nom d'hôte ; exposé ou derrière un proxy, l'authentification ne peut pas être désactivée (le service refuse de démarrer) ; un nom d'hôte étranger est refusé tant que le service écoute en local (contre le détournement de nom) ; un jeton n'est jamais lu dans l'adresse ; une modification venue d'un autre site est refusée.
- **Pourquoi.** Un service local ne doit pas devenir une porte ouverte par une mauvaise configuration.
- **Contrôle.** Appeler le service avec un nom d'hôte inventé : refus.
- **Sklubot.** PARTIEL : en-têtes de sécurité (`server/src/hardening.ts:53-64`). Contrôle du nom d'hôte non trouvé (service hébergé derrière proxy).

### A.22 Conversations et interface

**T120. Recherche dans l'historique des conversations** — importance : moyenne
- **Comportement.** Recherche plein texte : plusieurs mots = tous requis ; guillemets = phrase exacte ; suffixe = préfixe ; ponctuation neutralisée ; filtres par bot et par période (relative ou absolue). Seuls les textes des messages sont indexés (pas la réflexion ni les sorties d'outils) ; un résultat par passage, avec extrait et bot ; une recherche sans terme utilisable ne renvoie rien.
- **Pourquoi.** Retrouver « ce que le bot avait dit sur le devis » sans faire défiler des semaines.
- **Contrôle.** Chercher une phrase entre guillemets : seuls les passages exacts sortent.
- **Sklubot.** PARTIEL : recherche par mots tous requis, 40 résultats (`server/src/store.ts:892-900`, `server/src/routes.ts:1256`). Ni phrase exacte, ni période.

**T121. Longues conversations lisibles** — importance : moyenne
- **Comportement.** Une longue conversation s'ouvre sur ses derniers messages ; les plus anciens se chargent par pages (2 000 au plus par requête), sans couper une sortie d'outil de son appel ; quand l'utilisateur lit plus haut, l'arrivée de messages ne déplace pas sa lecture ; un message lié par un lien est ramené dans la vue ; revenir sur une conversation affiche tout de suite la version gardée puis ne rejoue que la différence ; une conversation dont le début a été purgé le dit.
- **Pourquoi.** Des conversations de plusieurs milliers de messages restent fluides.
- **Contrôle.** Lire un message ancien pendant qu'un tour écrit : la vue ne saute pas.
- **Sklubot.** PARTIEL : repli des étapes dans le fil (`web/src/components/Transcript.tsx:58`). Chargement par pages et ancrage de lecture : non vérifiés.

**T122. Brouillons et pièces en attente conservés** — importance : moyenne
- **Comportement.** Le brouillon tapé est gardé par conversation (deux conversations du même bot ont deux brouillons), survit à un changement d'écran et se vide à l'envoi ; un message rappelé de l'historique s'affiche sans remplacer le brouillon ; les pièces déposées en attente survivent à un rechargement et apparaissent dans les autres fenêtres.
- **Pourquoi.** Ne jamais perdre une consigne longue en changeant de page.
- **Contrôle.** Taper un texte, ouvrir un autre bot, revenir : le texte est là.
- **Sklubot.** PARTIEL : brouillon par bot (`web/src/components/Composer.tsx:74`). Par conversation et survie au rechargement : non vérifiées.

**T123. Avis « modèle demandé non appliqué »** — importance : basse
- **Comportement.** Quand le modèle ou le niveau de réflexion demandé ne peut pas être appliqué, le fil dit lequel a été demandé, pourquoi il a été refusé, et lequel tourne réellement (ou « le défaut du bot »). Une bascule automatique de modèle porte sa cause ; un changement manuel n'en porte pas.
- **Pourquoi.** Jamais de modèle remplacé en silence.
- **Contrôle.** Demander un niveau de réflexion que le modèle ignore : un avis le dit.
- **Sklubot.** MANQUANT.

**T124. Avis « moteur sans session »** — importance : basse
- **Comportement.** Avec un moteur qui ne garde pas de session, le fil dit une seule fois, au-dessus du tour concerné, que le bot repart du seul nouveau message ; si le contexte est encore dû, l'avis attend le premier tour réellement « aveugle » ; un moteur qui annonce sa session n'est jamais présenté ainsi ; un passage de relais à un autre moteur sans session est annoncé aussi.
- **Pourquoi.** Comprendre pourquoi le bot a « oublié ».
- **Contrôle.** Basculer vers un moteur sans session : un avis unique apparaît.
- **Sklubot.** MANQUANT.

**T125. Clavier, lecteur d'écran et petit écran** — importance : moyenne
- **Comportement.** Fenêtres et formulaires gardent le focus à l'intérieur ; Échap ferme et rend le focus à ce qui avait ouvert ; onglets navigables aux flèches, Suppr ferme et l'annonce ; une touche passe d'une zone à l'autre ; les séparateurs se règlent au clavier ; sous 768 px de large, les zones s'empilent avec un sélecteur et rien n'exige un glisser-déposer ; sur écran tactile, la recherche n'ouvre pas le clavier toute seule.
- **Pourquoi.** Utilisable sans souris et sur téléphone.
- **Contrôle.** Parcourir un formulaire de tâche au clavier seul jusqu'à l'enregistrement.
- **Sklubot.** MANQUANT (non vérifié de façon systématique).

**T126. Bandeau d'annonces borné** — importance : basse
- **Comportement.** Au plus 3 cartes à la fois, avertissements d'abord ; une carte fermée est mémorisée par compte côté service et ne revient pas sur un autre appareil ; « réafficher les cartes fermées » existe ; les annonces du produit arrivent signées et expirent ; une carte qui renvoie vers une page de l'appli disparaît sur cette page même.
- **Pourquoi.** Informer sans envahir.
- **Contrôle.** Fermer une carte sur le téléphone : elle n'apparaît plus sur l'ordinateur.
- **Sklubot.** PARTIEL : annonces avec envoi une fois par lecteur (`server/src/announcements.ts`, `server/src/index.ts:118`). Plafond de 3 cartes et fermeture par compte : non vérifiés.

### A.23 Projets, fichiers, noms

**T127. Supprimer un projet qui a des bots** — importance : moyenne
- **Comportement.** Supprimer un projet qui a des bots est refusé avec leur liste tant que l'utilisateur n'a pas choisi : supprimer les bots avec, les détacher (ils restent sans projet), ou les déplacer vers un autre projet (ils suivent son dossier) ; déplacer vers un projet inconnu ou vers lui-même est refusé avant tout changement ; un projet sans bot se supprime directement.
- **Pourquoi.** Ne jamais supprimer des bots par accident.
- **Contrôle.** Supprimer un projet de 2 bots : la liste et les trois choix s'affichent.
- **Sklubot.** PARTIEL : suppression d'espace réservée au propriétaire (`server/src/workspaces.ts:113`). Pas de choix pour les bots.

**T128. Gestionnaire de fichiers du bot sûr** — importance : moyenne
- **Comportement.** Déplacer, renommer, créer, supprimer dans le dossier d'un bot : jamais d'écrasement (un changement de casse renomme sans écraser un voisin) ; refus de sortir du dossier, y compris par un lien ; un lien supprimé ou déplacé est le lien, jamais sa cible ; dossiers techniques (historique de version, dépendances) protégés ; un nouveau nom est un nom simple. Les chemins reviennent avec des barres obliques quel que soit le système. Un fichier hors du dossier ne s'ouvre qu'avec un droit dédié, par chemin absolu, s'il existe.
- **Pourquoi.** L'utilisateur range sans risque de casser ou de fuir.
- **Contrôle.** Renommer un fichier avec le nom d'un voisin : refus.
- **Sklubot.** PARTIEL : fichiers du bot et aperçu (`web/src/components/SpendSkillsFiles.tsx`). Protections de déplacement et de lien : non vérifiées.

**T129. Noms de bots dans toutes les écritures** — importance : basse
- **Comportement.** Un nom peut être dans n'importe quelle écriture ; limite de 80 octets (pas 80 caractères) ; ce qu'un dossier ou un shell ne peut pas contenir est refusé ; deux formes Unicode équivalentes désignent le même bot et un doublon est refusé ; une adresse encodée fonctionne.
- **Pourquoi.** Nommer ses bots dans sa langue.
- **Contrôle.** Créer un bot au nom chinois puis le même nom en forme décomposée : refus de doublon.
- **Sklubot.** MANQUANT (pas de limite en octets ni de normalisation trouvée).

**T130. Pôles qui regroupent les projets** — importance : basse
- **Comportement.** Un pôle regroupe des projets, a un bot responsable, se crée vide, se renomme (les projets marqués de l'ancien ou du nouveau nom restent dedans) et se supprime sans supprimer ni ses projets ni son responsable ; le nom ignore casse, accents et espaces pour l'identifiant.
- **Pourquoi.** Organiser 20 projets par activité.
- **Contrôle.** Supprimer un pôle : ses projets et son responsable restent.
- **Sklubot.** PARTIEL : sections de la liste (`server/src/sectionroutes.ts`).

### A.24 Navigateur

**T131. Navigateur par projet qui s'éteint seul** — importance : moyenne
- **Comportement.** Chaque projet a son navigateur et son profil (connexions gardées), séparés par propriétaire et par projet ; un profil explicite introuvable ou interdit échoue sans repli silencieux sur le profil général. Après 30 min sans usage, le navigateur s'éteint ; au rallumage, les onglets réels sont rouverts sans doublon (adresse exacte), les pages internes ignorées ; une session jamais touchée compte depuis son démarrage ; sans date connue, on refuse de fermer plutôt que de deviner. Un refus de connexion d'un grand fournisseur d'identité est détecté et remis à l'utilisateur.
- **Pourquoi.** Économiser la machine sans perdre où on en était.
- **Contrôle.** Laisser un navigateur 31 min : éteint ; relancer : mêmes onglets.
- **Sklubot.** PARTIEL : navigateur par bot, mise en veille du moins récemment utilisé au plafond (`server/src/computer.ts:103-112`). Extinction après inactivité et restauration des onglets : non vérifiées.

**T132. Identifiants de site remplis sans être vus** — importance : haute
- **Comportement.** Identifiants de site chiffrés au repos, liés à une origine exacte (pas d'identifiants dans l'adresse, pas d'autre schéma que le web), jamais renvoyés dans une réponse ni une conversation ; le remplissage n'envoie que le profil et l'origine ; un identifiant ne change ni de profil ni de propriétaire ; enregistrer depuis une page passe par une commande dédiée.
- **Pourquoi.** Le bot se connecte à un site sans jamais lire le mot de passe.
- **Contrôle.** Demander au bot d'écrire le mot de passe dans le chat : il ne l'a pas.
- **Sklubot.** FAIT : saisie d'un identifiant enregistré sans que le bot le voie, seulement dans un champ mot de passe et sur le bon site (`server/src/agent/tools-browser.ts:61-72`).

### A.25 Automatisation (suite)

**T133. Scripts déclenchés approuvés par une personne** — importance : haute
- **Comportement.** Un déclencheur peut lancer un script d'un projet. Un bot peut seulement le proposer (carte) ; une personne l'approuve, une seule fois, et le déclencheur appartient à l'auteur de la proposition. L'approbation porte sur l'empreinte du fichier : un fichier réécrit est refusé, signalé une fois, jusqu'à nouvelle approbation ; ce qui ne peut pas être empreint n'est pas approuvable. Pas de chevauchement (un tour qui trouve le précédent en cours est sauté) ; délai de 300 s par défaut, 3 600 s au plus ; un échec lève une alerte avec la fin de la sortie ; des échecs répétés éteignent le déclencheur ; secrets passés par nom, jamais dans le journal ; un webhook non signé ne lance jamais de script. Un script ne crée ni tâche ni mission.
- **Pourquoi.** Automatiser sans laisser un bot écrire puis lancer son propre code.
- **Contrôle.** Le bot modifie un script approuvé : le prochain déclenchement est refusé.
- **Sklubot.** MANQUANT.

**T134. Webhook sortant fiable** — importance : moyenne
- **Comportement.** Un déclencheur peut envoyer un webhook : https seulement, droit dédié, destinations privées, locales ou de métadonnées refusées à la création et à chaque envoi ; message signé avec un secret propre affiché une fois ; réessayé avec le même identifiant, abandonné après 10 essais ; aucun identifiant dans les journaux.
- **Pourquoi.** Prévenir un autre outil sans risque de fuite vers le réseau interne.
- **Contrôle.** Créer un webhook vers une adresse locale : refus.
- **Sklubot.** MANQUANT.

**T135. Planifications robustes** — importance : moyenne
- **Comportement.** Une planification tourne au plus une fois par minute ; une occurrence due est réservée une seule fois ; si le module visé n'est pas prêt au démarrage, l'occurrence attend (grâce de 5 min) puis s'exécute une fois ou échoue avec une alerte ; une cible en vraie panne alerte tout de suite ; échecs successifs : une alerte par série, un succès en ouvre une nouvelle ; rafales sur la même chose regroupées avec la dernière donnée ; « tester » fait un essai à blanc par défaut.
- **Pourquoi.** Une routine ne se perd pas et n'inonde pas de rappels.
- **Contrôle.** Arrêter le service pendant l'heure d'une routine : elle part une fois au redémarrage.
- **Sklubot.** PARTIEL : créneau réservé atomiquement et rattrapage (`server/src/routines.ts:177`, `server/src/scheduler.ts:183-193`). Alerte par série d'échecs : non vérifiée.

**T136. Messageries entrantes fiables** — importance : moyenne
- **Comportement.** Chaque message reçu d'une messagerie (canal de discussion, bot de messagerie) est enregistré avant l'accusé de réception ; un doublon est reconnu même après redémarrage ; une panne après la création de la mission réessaie avec la même identité (pas de seconde mission) ; le texte de réponse et sa progression survivent à un envoi raté ; une réponse part dès le premier tour même si la mission reste ouverte ; file globale plafonnée (au-delà, refus sauf doublon) ; budget de débit conservé au redémarrage ; un message d'erreur qui contient un identifiant est retenu ; reçus gardés 30 jours. Retirer le droit d'un propriétaire met en pause sa file jusqu'au rétablissement.
- **Pourquoi.** Un client qui écrit sur une messagerie n'est jamais ignoré ni servi deux fois.
- **Contrôle.** Couper le service juste après la réception : au redémarrage, une seule réponse part.
- **Sklubot.** PARTIEL : position de lecture enregistrée après chaque message (`server/src/telegram.ts:87`). Pas de file durable ni de réessai avec la même identité.

**T137. Tickets externes transformés en idées** — importance : basse
- **Comportement.** Un connecteur (forge, salon communautaire) transforme un ticket signé en une idée, une seule fois, avec sa référence et ses fichiers (lus comme texte) ; une réponse dans le fil du ticket s'ajoute à l'idée une fois et la remet « à faire » si elle était analysée ; l'issue puis la clôture repartent signées, dans l'ordre, réessayées après échec ; un connecteur non approuvé demande l'approbation au lieu d'échouer en silence. Les tâches « miroir » d'un outil externe ne sont jamais lancées et ne réveillent personne.
- **Pourquoi.** Le carnet d'idées se remplit tout seul depuis les retours clients.
- **Contrôle.** Un ticket ouvert deux fois (rejeu) : une seule idée.
- **Sklubot.** PARTIEL : issues et réponses de forge (`server/src/githubissues.ts`, test `server/test/github-issue-workflow.test.ts`).

### A.26 Mémoire et compétences (suite)

**T138. Règles de mémoire propres** — importance : moyenne
- **Comportement.** Un doublon exact sur la même portée est refusé (casse et espaces ignorés), le même texte sur une autre portée passe ; une règle de portée sans cible est refusée (elle ne serait jamais injectée) ; une règle ajoutée est visible tout de suite dans le rappel ; injection plafonnée (10 règles « toujours injectées », 12 000 caractères de rappel, 40 résultats de recherche) ; supprimer ou réécrire une règle retire son ancien texte du journal d'audit ; personne n'écrit une règle dans un bot à la corbeille.
- **Pourquoi.** Une mémoire sans doublons, bornée, et sans traces de ce qu'on a voulu effacer.
- **Contrôle.** Ajouter deux fois la même règle avec des majuscules différentes : refus.
- **Sklubot.** PARTIEL : carte de contradiction (`server/src/agent/memory.ts:182`). Doublon exact et effacement du journal : non vérifiés.

**T139. Import de compétences encadré** — importance : moyenne
- **Comportement.** Importer une compétence depuis un dossier, un module ou une commande : fichiers copiés sans liens ni dossiers techniques ; collision d'identifiant refusée (la compétence existante intacte) ; une compétence du produit n'est jamais remplacée ; taille bornée (200 fichiers, 256 Ko par fichier annexe) ; une compétence qui pré-autorise des outils exige un droit élevé et une liste mal fermée n'autorise rien ; une compétence inexistante est sautée avec un avertissement sans bloquer le lancement.
- **Pourquoi.** Une compétence importée ne doit pas élargir en douce ce que le bot peut faire.
- **Contrôle.** Importer une compétence qui pré-autorise le shell sans droit : refus.
- **Sklubot.** PARTIEL : analyse de sécurité des compétences (`server/src/skillscan.ts`), import depuis la forge (`server/src/skillsgithub.ts`).

### A.27 Voix

**T140. Dictée : moteur choisi et consentement** — importance : basse
- **Comportement.** Le moteur de dictée choisi n'est jamais remplacé par un autre en silence (s'il ne peut pas tourner : refus) ; un moteur tiers exige un consentement qui nomme où part la voix, valable pour ce moteur sur cette machine, redemandé si la destination change ; une hésitation courte relance l'écoute, un silence prolongé termine ; un micro refusé est fatal ; la touche « parler pour dicter » est configurable, sans touches qui tapent ou pilotent la page, et la répétition clavier ne relance pas. Un modèle local à télécharger demande un accord, affiche sa taille et la progression, se met en pause, et dit la place manquante.
- **Pourquoi.** Savoir où va sa voix.
- **Contrôle.** Choisir un moteur tiers : une carte nomme la destination avant tout enregistrement.
- **Sklubot.** PARTIEL : dictée côté serveur (`server/src/speechtext.ts`). Un seul moteur : consentement par moteur sans objet aujourd'hui.

**T141. Conversation vocale en direct qui délègue** — importance : basse
- **Comportement.** Désactivée par défaut, et fermée tant que la clé du service vocal manque ; la session reçoit l'historique récent (les messages les plus anciens retirés entiers s'il dépasse le budget) ; la voix délègue le travail aux bots et ne doit jamais prétendre avoir fait ce qu'elle n'a pas délégué ; chaque tour parlé est écrit dans l'historique sans réveiller le bot ; un refus du service amont est traduit sans montrer sa réponse brute.
- **Pourquoi.** Parler à son équipe en mains libres sans perdre la trace écrite.
- **Contrôle.** Demander à voix haute un rapport : le travail part au bot, la conversation est dans le fil.
- **Sklubot.** PARTIEL : appels vocaux par le serveur (`server/src/voice/session.ts:16`, `server/src/calls.ts:7`).

### A.28 Données et diagnostic

**T142. Export et import complets de l'installation** — importance : moyenne
- **Comportement.** Un export emporte bots, visages, modules et leurs données, base des intégrations (écritures en cours comprises), disposition des écrans ; les chemins sous le dossier personnel deviennent portables et redeviennent locaux à l'import ; un import remplace les bots au lieu de les fusionner ; il est refusé sur une installation en marche sans option « forcer », et refusé si un autre processus tient la base ; les projets dont le dossier est introuvable sont listés ; un connecteur exporté n'emporte jamais la valeur de sa clé et l'import dit comment la redonner ; les secrets ne sortent jamais.
- **Pourquoi.** Changer de machine sans rien perdre ni rien fuiter.
- **Contrôle.** Exporter puis importer sur une machine vierge : même équipe, clés à redonner.
- **Sklubot.** PARTIEL : archive de sauvegarde complète (`server/src/backuparchive.ts`, `server/src/autobackup.ts:139`). Import sur une installation en marche : non vérifié.

**T143. Rapport de diagnostic à partager** — importance : basse
- **Comportement.** Un rapport réunit les constats (service sans données, port tenu par un autre programme avec son nom, données ouvertes par une version plus ancienne, moteur sans exécutable de base), les dernières lignes de journal du plus récent au plus ancien, avec valeurs de fichiers, formes de jetons, paramètres secrets et adresses masqués, sans la base ; une installation saine n'a rien à dire. Le diagnostic dit aussi si les missions sont isolées et ce que l'isolation laisse ouvert.
- **Pourquoi.** Demander de l'aide sans exposer ses données.
- **Contrôle.** Générer un rapport : aucun secret du coffre n'y figure.
- **Sklubot.** PARTIEL : Sentinelle et santé (`server/src/sentinel/`, `server/src/health.ts`). Pas de rapport à partager.

**T144. Une fonction en panne n'arrête pas le service** — importance : moyenne
- **Comportement.** Une erreur non rattrapée d'un module est attribuée à ce module, comptée (pas répétée) dans une fenêtre, signalée au plus une fois par heure, et n'arrête pas le service ; une route qui échoue répond une erreur sans détail interne ; un module désactivé désactive ceux qui en dépendent, sans redémarrage ; un module qui échoue au rechargement est réessayé seul, sans bloquer l'arrêt des autres ; le résumé de démarrage liste ce qui est éteint et pourquoi.
- **Pourquoi.** Une fonction secondaire cassée ne doit pas couper les bots.
- **Contrôle.** Forcer une erreur dans une fonction annexe : les discussions continuent, une alerte nomme la fonction.
- **Sklubot.** FAIT : rejet non géré journalisé avec le bot, tour planté → carte d'échec (`server/src/index.ts:132-138`, `server/src/agent/crashguard.ts`).

**T145. Mises à jour du produit vérifiées et annoncées** — importance : basse
- **Comportement.** Vérification toutes les 6 h (première vérification étalée sur une minute après le démarrage) d'un manifeste signé et daté ; une version stable ne voit jamais de pré-version ; un manifeste plus ancien rejoué est refusé ; une panne réseau garde la dernière offre vérifiée ; échec : nouvel essai après 15 min puis 1 h ; une notification par version ; « plus tard » vaut pour cette version et ce compte ; avant d'installer, les missions en cours sont annoncées avec « attendre » ou « installer quand même ». La requête n'envoie rien d'identifiant.
- **Pourquoi.** Se tenir à jour sans casser un travail en cours.
- **Contrôle.** Fermer l'annonce d'une version : elle ne revient que pour la suivante.
- **Sklubot.** DIFFÉRENT : service hébergé mis à jour par l'opérateur ; l'idée « prévenir des missions en cours avant un redémarrage » reste à reprendre.

---

## B) À ne pas reprendre, et pourquoi

- **Code, textes, libellés, nom, mascotte** : AGPL + marques. Idées seulement.
- **Statistiques activées par défaut, e-mails commerciaux « agence »** : contraire à la ligne de Sklubot.
- **Modules tiers chargés dans le serveur** : risque entre comptes en mode hébergé (voir T81).
- **Terminal texte offert à l'utilisateur, widget de conteneurs, graphe git, publication de branches** : public développeur ; Sklubot montre l'écran du bot.
- **Pilotage de plusieurs machines** : Sklubot est central.
- **Licence payante contrôlée en ligne** : modèle commercial propre à la source.
- **Copie de cookies d'un navigateur personnel pour contourner un refus de connexion** : à n'envisager que si le Chromium du bureau du bot est refusé, et toujours à l'initiative de l'utilisateur.

## C) Dépendances payantes ou propriétaires

- Les abonnements en ligne de commande (Claude, ChatGPT…) : déjà gérés par Sklubot via l'ordinateur du bot.
- Modèle de dictée « précis » d'un fournisseur commercial : Sklubot a sa propre dictée serveur ; inutile.
- Aucun autre service payant n'est requis par les exigences ci-dessus.

## Ce que ça change pour la reconstruction (ordre conseillé)

1. Fiabilité sans témoin : T36 (délais), T35 (relances), T43 (quota revérifié), T38 (disjoncteur en base), T22 (reprise prudente). Petits chantiers, gros effet.
2. Transparence : T49 (ce que reçoit le bot), T21 (cause visible), T67 (règle retirée = conversation neuve), T60 (compte à rebours).
3. Confort du chat : T17, T18, T19, T31, T50 (corbeille).
4. Travail à plusieurs : T1, T3, T6, T9, T13 adaptés aux livrables non-code (page, rapport, e-mail).
5. Sécurité fine : T58, T59, T63, T78.
6. Ajouts v2, par ordre d'effet : T105 (réponse garantie entre bots), T111 (masquage des secrets coupés), T91 (plafonds de missions), T94 et T95 (moteur mort ou stérile), T102 et T103 (flux en direct, « en préparation »), T110 (secret demandé avec durée), T133 (scripts approuvés), T136 (messageries fiables), T115 (sessions glissantes), T99 (copie avant mise à niveau).

## Carte de couverture

Relevé fait sur la totalité du dépôt (6 102 fichiers, 1 782 fichiers de tests lus par leurs intitulés, réglages par défaut et bornes chiffrées lus dans le code). Chaque module est décrit de façon générique ; les numéros renvoient aux exigences ci-dessus.

### Service (cœur)

| Module | Exigences |
|---|---|
| Lancement des missions et cycle de vie des moteurs (lancement, reprise de session, redirection en cours de tour, arrêt) | T17, T21, T22, T36, T93, T94, T97, T103 |
| Surveillance des tours (inactivité, tour muet, plafond de tour, travail de fond, tours ouverts par le moteur) | T36, T91 |
| Plafonds de missions simultanées et éviction | T91 |
| Gardien des ressources (profils jour / nuit, mémoire, pression, processus tués) | T92 |
| Nouvel essai des tours (couche fournisseur, couche service) | T35, T105 |
| Disjoncteurs (moteur stérile, paire de bots), mise à l'écart pour quota, revérification, réouverture | T38, T43, T44, T95 |
| Bascule de secours (comptes, équivalences, séries, groupes, chef) | T10, T44 |
| Relance des tâches mortes, boucle de plantages, reprise au démarrage | T37, T96 |
| Réveils, boîtes de réception, récapitulatif des retours au chef | T6, T7, T52, T96, T105 |
| Demandes entre bots et réponses automatiques | T105 |
| Délégation, hiérarchie, liste d'orchestration, équipes | T12, T48, T106 |
| Tableau de tâches : création, garde-fous de date, pièces jointes, suppression sûre, liste et filtres | T1, T2, T8 |
| Dépendances, barrières de relecture et d'intégration | T3, T13, T15 |
| Enchaînement automatique écrire → relire → corriger → intégrer → documenter, reprise après coupure | T13 |
| Clôture des tâches (texte obligatoire, verdict, empreinte d'intégration, fermeture automatique qualifiée) | T13, T15, T37 |
| Carnet d'idées, promotion, passage au chef, fermeture automatique, issues et notes publiques | T4, T5 |
| Plan de série (formulaire, groupes, modèles par rôle, jeux de modèles) | T9, T10, T11 |
| Choix du modèle (ordre de résolution, titre automatique, résumé, transfert de contexte) | T10, T23, T31, T32 |
| Conversations : liste, origine, filtres, recherche plein texte, pages d'historique, rétention | T23, T85, T120, T121 |
| Compaction (sur place ou par résumé), suivi d'opération | T31 |
| Reprise de contexte après session perdue, moteurs sans session | T22, T124 |
| Accords : cartes, portées « session / toujours », aperçu des scripts, délais sans témoin, refus réservés aux personnes | T57, T58, T59, T60, T109 |
| Questions et formulaires du bot, sous-missions sans témoin | T27, T107, T108 |
| Niveaux d'autorisation par conversation et plafonds d'élévation | T34, T114 |
| Pièces jointes de discussion et médias montrés par le bot (adresses vérifiées, plafonds) | T25, T26 |
| Documents interactifs dans la discussion | T27 |
| Répondre à un message, copier, présentation des messages | T19, T20 |
| Identité des bots (documents, âme, rôle), visage | T47, T54 |
| Corbeille des bots, renommage, duplication, export / import de bots, import depuis d'autres outils | T50, T51 |
| Siège du bot principal | T52 |
| Rôles partagés modifiables | T53 |
| Ce que reçoit le bot (blocs injectés, poids, secrets masqués) | T49, T71 |
| Consignes globales | T56 |
| Mémoire : capture, synthèse de nuit, promotion, portées, retrait = conversation neuve, règles propres | T66, T67, T68, T138 |
| Récapitulatif global, notation des projets, idées de nuit | T45, T69 |
| Compétences : catalogue / entière, portées, lectures comptées, fichiers annexes, import | T71, T72, T73, T139 |
| Coffre de secrets : chiffrement, portées, relais vers hôtes autorisés, journal d'usage, demande par carte, masquage, rotation | T61, T110, T111, T112, T113 |
| Relais réseau des missions et journal des connexions | T63 |
| Connecteurs (adresses vérifiées, jetons scellés, moindre privilège pour les tâches) | T64 |
| Clôture système des missions et masquage des fichiers privés | T62, T100 |
| Fichiers du bot (lecture, écriture, déplacement, liens) | T28, T128 |
| Projets, pôles, suppression avec bots, dossier introuvable | T93, T127, T130 |
| Navigateur : sessions par projet, profils, identifiants, enregistrement de parcours, annotations, outils de débogage | T74, T75, T76, T131, T132 |
| Routines et déclencheurs (planning, webhooks entrants, événements internes, scripts, webhooks sortants) | T77, T78, T79, T133, T134, T135 |
| Enchaînements visuels (brouillon / publication, boucles, nœuds HTTP, script, étape humaine) | T80 |
| Notifications (sortes, cloche, fermeture automatique, sons, notifications système) | T82, T83 |
| Annonces et mises à jour du produit | T126, T145 |
| Comptes, rôles, droits par écran, connexion, sessions, codes par e-mail, audit, récupération | T114, T115, T116, T117, T118 |
| Appareils reliés | T65 |
| Écoute réseau, contrôle du nom d'hôte, authentification obligatoire hors machine | T119 |
| Sauvegardes, rétention, archive des événements, chronologies | T85, T104 |
| Mise à niveau des données (copie, restauration, migrations destructives) | T99 |
| Verrou de données, droits des fichiers, arrêt propre, échec de stockage, journaux | T39, T97, T98, T100, T101 |
| Flux en direct (rejeu, plafonds, éviction) | T102 |
| Messages du service codés et traduits | T86 |
| Diagnostic et rapport | T88, T143 |
| Noyau de modules (activation à chaud, dépendances, isolation des pannes) | T81, T144 |
| Fournisseurs : liste, comptes multiples, lecture des quotas, installation et mise à jour des outils en ligne de commande | T41, T42, T46 |
| Accueil (étapes, installation du service en fond, conversation d'accueil, profil) | T89 |
| Messageries entrantes (reçus durables, doublons, réessais) et connecteurs de tickets | T90, T136, T137 |
| Voix : dictée, lecture à voix haute, conversation vocale en direct | T20, T140, T141 |
| Ligne de commande et outils exposés aux bots (parité des deux accès) | T55, T90 |

### Interface

| Module | Exigences |
|---|---|
| Zone de saisie (deux gestes en cours de tour, historique au clavier, brouillons, pièces en attente) | T17, T18, T122 |
| Fil de discussion (fenêtre glissante, ancrage de lecture, cache par compte, navigation) | T121 |
| Anneau de contexte et compaction | T31 |
| Sélecteur de modèle unique, favoris, niveau de réflexion, avis de modèle non appliqué | T32, T33, T34, T123 |
| Lignes d'essai du fournisseur, avis de tour interrompu, de moteur mort, de moteur sans session | T22, T35, T94, T124 |
| Cartes : accord, compte à rebours, aperçu de script, commande à coller, demande de secret, questions | T57, T58, T60, T108, T109, T110 |
| Tableau et carnet d'idées (cartes, filtres mémorisés, suppression avec chaîne, détail d'idée) | T1, T2, T4, T8 |
| Formulaire de plan et jeux de modèles | T9, T11 |
| Barre « qui travaille », onglets épinglés, regroupement par projet | T30 |
| Espaces de travail découpés, grilles de discussions, dispositions enregistrées | T29, T125 |
| Aperçu de fichiers (galerie, bureautique, PDF, vidéo) | T28 |
| Notifications (cloche, préférences, sons, copier) | T82, T83 |
| Réglages (recherche, mots cachés), rétention, confidentialité | T84, T85, T87 |
| Langues, thèmes | T86 |
| Accessibilité clavier, petit écran | T125 |
| Annonces et mises à jour | T126, T145 |
| Comptes (profil, confirmation d'adresse, réinitialisation, appareils) | T65, T115, T116 |
| Écran « ce que reçoit le bot » | T49 |
| Organigramme et orchestration | T48 |
| Vue réseau d'une mission | T63 |

### Modules écartés volontairement

| Module | Raison |
|---|---|
| Licence payante, verrou des versions bêta, quotas d'utilisateurs par licence, marque blanche | modèle commercial propre à la source ; aucun comportement utile à l'utilisateur de Sklubot |
| Installation et supervision du service sur chaque système (unités de service, tâches planifiées, élévation, appropriation, passage de relais entre versions empaquetées) | application de bureau installée ; Sklubot est un service hébergé déployé par l'opérateur (seule l'idée « un seul service par dossier » est gardée : T98) |
| Appli de bureau (fenêtres, icône de barre, navigateur intégré natif, mises à jour de l'appli) | coquille de bureau ; Sklubot montre l'ordinateur du bot (comportements utiles repris dans T74, T75, T131, T132, T145) |
| Moteurs de dictée embarqués (modèles locaux, segmentation, filtrage des hallucinations) | détail d'implémentation d'un moteur local ; seul le comportement visible est repris (T140) |
| Garde-fous git internes (appels git neutralisés contre les crochets écrits par une mission, nettoyage des copies de travail, liens de dépendances, graphe de branches, publication) | public développeur (voir B) ; l'isolation des écritures reste dans T14 |
| Pilotage de plusieurs machines, réseau privé et publication du service, agents à distance par jetons délégués | Sklubot est central (voir T65) |
| Terminal texte intégré pour l'utilisateur | voir B ; seul le geste « coller une commande » est repris (T109) |
| Intégrations propres à chaque fournisseur (formats de sortie, trousseau système, catalogue d'agents externes téléchargeables) | détails d'intégration de moteurs ; Sklubot a ses propres moteurs ; comportements visibles repris dans T41, T42, T44, T94, T95 |
| Kit de développement de modules, signatures de modules, galerie, exemples, contrats d'API pour tiers | voir T81 et B (code tiers dans un serveur hébergé) |
| Statistiques d'usage | T87 (ne pas reprendre) |
| Mascotte 3D (rendu, fourrure, animation) | ressource graphique protégée ; seul le comportement d'état est repris (T54) |
| Outils de publication et de construction (scripts de version, collecte des tests, contrôle des langues dans le code) | outillage interne sans effet pour l'utilisateur |
| Synthèse vocale par conteneur local | Sklubot a sa propre lecture à voix haute (T20) |
| Prospect « partenaire » envoyé au site de l'éditeur | collecte commerciale propre à la source |

### Zones non couvertes en détail

- Les tests de l'interface ont été lus par leurs intitulés pour les écrans principaux (discussion, cartes, tableau, notifications, réglages, accueil, mises à jour) ; les tests purement graphiques (verre, couleurs, mascotte, disposition au pixel) n'ont pas donné d'exigence.
- Les intégrations par fournisseur ont été survolées : leurs comportements visibles sont regroupés dans les exigences génériques, pas détaillés fournisseur par fournisseur.
