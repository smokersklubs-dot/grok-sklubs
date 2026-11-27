# Audit : n8n-io/nod — ce qui est nouveau depuis le cahier 07, comparé à Sklubot

Date : 22/11/2026. Lecture seule. Rien n'a été modifié dans Sklubot.

- Cahier existant : `docs/cleanroom/07-n8n-nod.md`, étude du commit `49ac8277` (14/11/2026).
- Dépôt relu : `n8n-io/nod`, HEAD `1b42e68` (21/11/2026). **387 commits** et 511 fichiers modifiés depuis l'étude (+75 000 / −12 000 lignes).
- Sources lues : messages de tous les commits depuis `49ac8277`, liste des fichiers ajoutés, différences de la documentation (`docs/src/content/docs/**`), nouvelles pages (utilisation de l'ordinateur, connecteurs communautaires, règles d'approbation des connecteurs), en-têtes de quelques nouveaux modules. Rien n'a été exécuté.
- Pour les fonctions déjà décrites par le cahier 07 (A1–A22), l'état Sklubot est celui de `docs/COUVERTURE.md` § « Spec 07 vague 5 / 5b », re-vérifié par sondage. Ce document ne liste que **ce qui a été ajouté ou changé** depuis le 14/11.

## Comptes (lignes nouvelles uniquement)

| Statut | Nombre |
|---|---|
| FAIT | 6 |
| PARTIEL | 30 |
| MANQUANT | 22 |
| DIFFÉRENT | 2 |
| NON REPRIS | 2 |
| Non vérifié (voir § 5) | 8 |
| **Total** | **70** |

Lecture rapide : la semaine a surtout apporté (1) **l'utilisation des applis natives de l'ordinateur de l'utilisateur** par l'arbre d'accessibilité, avec une liste d'applis toujours refusées (terminaux, réglages, gestionnaires de fichiers, de mots de passe, navigateurs en lecture seule) ; (2) **des routines plus lisibles** (piste des exécutions en retard, sautées, ratées ; activité en direct ; arrêter une exécution sans mettre en pause) ; (3) **une ligne d'activité qui dit toujours ce que fait l'assistant**, dès l'envoi ; (4) **un modèle par type de travail** (discussion, routines, travail de fond, chaque tâche) et une **vérification de santé du modèle** avant d'envoyer ; (5) **un format ouvert de connecteurs communautaires** avec exigences de preuve ; (6) des dizaines de corrections du vérificateur d'actions (décrire la requête HTTP exacte, l'outil MCP choisi, ce qu'un clic engage).

---

## 1. Licence

| Partie | Licence | Ce qu'elle permet |
|---|---|---|
| Dépôt | **Apache License 2.0** (`LICENSE`, inchangée) + `NOTICE` | Copie possible avec licence, NOTICE et mention des changements. Sklubot a choisi la salle blanche pour ce dépôt (cahier 07) : on garde cette ligne, idées seulement. |
| Nouveau : `desktop/licenses/agent-desktop.md` | licence du composant libre d'accessibilité utilisé pour piloter les applis natives | À lire avant toute réutilisation ; non pertinent si on refait l'idée. |

---

## 2. Tableau des nouveautés

Colonnes : Zone · Nouveauté (nos mots) · Statut · Preuve Sklubot (fichier:ligne, test) · Ce qui manque · Taille.

### 2.1 Utilisation des applis de l'ordinateur de l'utilisateur (nouveau)

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 1 | Ordinateur perso | Piloter les applis natives (traitement de texte, tableur, mail) en lisant l'**arbre d'accessibilité** (boutons, champs, menus) plutôt que des pixels ; image d'**une seule fenêtre** si besoin, jamais de tout l'écran | DIFFÉRENT | Relais : souris, clavier, capture d'écran, ouvrir une appli, lister / activer des fenêtres, shell (`companion/src/main/relay-core.js:167-176,415-431`, `protocol.js:60-64`) ; `server/test/relay.test.ts` | Sklubot pilote par pixels et capture tout l'écran. Moins fiable et plus indiscret. | L |
| 2 | Ordinateur perso | Les connecteurs passent **avant** l'appli locale ; l'appli seulement si demandé ou si aucun connecteur ne peut le faire | MANQUANT | — | Consigne d'ordre de préférence à écrire dans `prompt.ts`. | S |
| 3 | Ordinateur perso | **Liste fixe d'applis toujours refusées** : terminaux et lanceurs de scripts, réglages et sécurité du système, gestionnaires de fichiers, gestionnaires de mots de passe et portefeuilles, l'assistant lui-même, applis homonymes ; menus système et raccourcis système interdits | MANQUANT | Le Relais accepte `shell.run` et toute appli (accord de session sur le poste) | Un bot peut ouvrir un terminal ou les réglages de sécurité du poste. | M |
| 4 | Ordinateur perso | Navigateurs et éditeurs de code **en lecture seule** (le web passe par le navigateur de l'assistant avec le coffre) | MANQUANT | — | — | S |
| 5 | Ordinateur perso | **Liste « garder à l'écart »** réglable par l'utilisateur (applis et dossiers), avec plafond | MANQUANT | Dossiers choisis dans le Relais pour les fichiers (COUVERTURE A15) | Pas de liste d'exclusion d'applis. | S |
| 6 | Ordinateur perso | Ouvrir une appli = comme ouvrir un fichier : couvert par les mots de l'utilisateur sinon question ; valable pour **cette demande** seulement ; règle possible « peut utiliser le tableur sans demander » | PARTIEL | Accord de session Relais ; règles en langage courant (`server/src/rules.ts`) | Portée « cette demande » absente. | S |
| 7 | Ordinateur perso | Chaque étape qui modifie passe au vérificateur, qui voit l'appli, la fenêtre, le contrôle, la saisie **et le contenu actuel de la fenêtre** (comme donnée, jamais comme parole de l'utilisateur) | PARTIEL | Vérificateur sur les actions (COUVERTURE A1, A13) | Pas de contenu de fenêtre transmis au vérificateur pour le Relais. | M |
| 8 | Ordinateur perso | **Relire la fenêtre juste avant la saisie** ; refuser si le contrôle ou le contenu a changé depuis la vérification ; saisie liée au contrôle qui a le focus | MANQUANT | — | Risque de taper dans la mauvaise fenêtre si l'utilisateur bouge. | M |
| 9 | Ordinateur perso | **Jamais de lecture ni saisie dans un champ mot de passe** ; aucune capture ni raccourci tant qu'un tel champ a le focus | MANQUANT | — | — | M |
| 10 | Ordinateur perso | Étape en attente, refusée ou incertaine : le même contrôle reste bloqué pour toute la demande ; arrêter annule les étapes en file ; aucune étape après son échéance | PARTIEL | Registre « incertain » (`server/src/agent/executions.ts`) pour les actions extérieures | Pas pour les étapes du Relais. | S |
| 11 | Ordinateur perso | Travail en arrière-plan + **pastille « travaille dans [appli] »** ; quand il faut passer devant : attendre que l'utilisateur ne tape plus, cadre lumineux autour de la fenêtre, rendre le focus après, restaurer le presse-papier | PARTIEL | Indicateur de session dans l'appli Relais (`companion/src/renderer/app.js`) | Pas d'attente d'inactivité, pas de restauration du focus / presse-papier. | M |
| 12 | Ordinateur perso | **Raccourci global d'arrêt** de tout le travail | PARTIEL | Fin de session Relais (`relay-core.js:168`) | Pas de raccourci clavier global. | S |
| 13 | Ordinateur perso | Garder l'ordinateur **éveillé** pendant une tâche locale | MANQUANT | — | — | S |
| 14 | Ordinateur perso | Expérimental sur Windows et Linux avec les mêmes refus ; message clair si le service d'accessibilité Linux est absent | DIFFÉRENT | Relais multi-plateforme | — | — |

### 2.2 Fichiers locaux (évolutions)

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 15 | Fichiers locaux | Accès **éteint au départ**, activé **dans la discussion** (« oui » ou bouton), puis la demande continue ; refus = reste éteint ; un travail lancé par l'assistant seul ne peut pas demander l'activation | PARTIEL | Dossiers choisis dans le Relais (`fs.roots`) | Activation depuis la discussion absente. | S |
| 16 | Fichiers locaux | Identité, taille et dates du fichier vérifiées **avant et après** une lecture ; ouverture sans suivre les liens ; dossier revérifié juste avant une écriture | NON VÉRIFIÉ → § 5 | `companion` `fs.read` / `fs.write` | — | S |
| 17 | Fichiers locaux | Erreur d'entrée/sortie après le début d'une lecture = résultat incertain ; nouvel essai bloqué dans la même demande | MANQUANT | — | — | S |
| 18 | Fichiers locaux | « Montre-moi la capture sur mon bureau » : copie dans l'espace de l'assistant et jointe à la réponse | PARTIEL | `fs.read` + `file_send` | Non vérifié de bout en bout. | S |
| 19 | Fichiers locaux | Garder la marque d'ordre des octets d'un fichier texte modifié ; `~` = dossier personnel | NON VÉRIFIÉ → § 5 | — | — | S |

### 2.3 Discussion

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 20 | Chat | **Ligne d'activité toujours visible** : mot animé dès l'envoi ; ~1 s après, une phrase courte résumant la demande (petit modèle) ; puis l'étape en cours avec le site / l'appli concernée ; « en attente de [modèle] » après 1 min sans rien ; « [modèle] a échoué, nouvel essai (1 sur 3) » | PARTIEL | Étapes repliées (`web/src/components/Transcript.tsx:58-96`), légende (`loop.ts`) | Pas de résumé immédiat, pas de « en attente du modèle », pas de compteur d'essais visible. | S |
| 21 | Chat | Ligne d'activité dépliable : les **4 dernières étapes terminées** | PARTIEL | « A travaillé N min » repliable | — | S |
| 22 | Chat | **Répondre à un message** et **répondre à une sélection** (citation exacte), clic sur la citation pour y aller, « revenir où j'étais » | MANQUANT | grep `reply` dans `Composer.tsx` : rien | — | S |
| 23 | Chat | **Copier** sur les blocs de code et les tableaux | MANQUANT | `web/src/lib/markdown.ts` : aucun bouton | Déjà noté par l'audit Hermes. | S |
| 24 | Chat | Coller une adresse sur un texte sélectionné = lien ; texte collé gardé littéral ; barre de mise en forme | MANQUANT | — | — | S |
| 25 | Chat | Retour à la ligne avec Entrée sur clavier tactile, envoi par le bouton | NON VÉRIFIÉ → § 5 | `Composer.tsx` | — | S |
| 26 | Chat | **Langue** : suit le dernier message clair de l'utilisateur, partout (questions, confirmations, tâches) ; réponses aux cartes ne comptent pas | PARTIEL | Langue du compte (`users.localeOf`, `server/src/egress.ts:140`) | Pas de bascule selon la langue du message. | S |
| 27 | Chat | `/clear` : contexte neuf, vue propre, tâches indépendantes continuent, anciens messages cherchables | FAIT | Nouvelle génération (`server/src/routes.ts:952`, `store.ts:338`) ; pas de test | — | — |
| 28 | Chat | Un résultat arrive **avec sa carte** ; un visuel = un aperçu avec bouton agrandir ; diagrammes avec étapes cliquables | PARTIEL | Cartes fichier et pages (`Transcript.tsx:270`, `PagePreview.tsx`) | Pas de diagramme interactif. | M |
| 29 | Chat | **Carte « Signaler un bug »** proposée quand l'assistant échoue (pas sur une réponse coupée) ; rapport de diagnostic qui masque chemins, numéros, liens ; renvoi possible | MANQUANT | — | Déjà noté (COUVERTURE « Message d'erreur avec identifiant… signaler un problème »). | S |
| 30 | Chat | Récupérer après une erreur de contexte définitive ; laisser de côté les gros anciens résultats d'outil dans une requête à froid | FAIT | Rattrapage « trop long » (`loop.ts:1002-1008`), retrait des anciens résultats (`server/src/agent/context.ts:36,91`) ; `server/test/wave10-context.test.ts` | — | — |
| 31 | Chat | Petits modèles : garder chargés les outils essentiels ; ajuster la requête avant le débordement | PARTIEL | Compaction (`loop.ts:1125-1137`) | Tous les outils envoyés à chaque tour (audit Hermes l. 151). | M |
| 32 | Chat | Carte de **vols** (recherche rapide, prix totaux, ≤ si incertain, détails pliés) | NON REPRIS | — | S'appuie sur une page grand public d'un tiers sans API officielle. L'idée « carte de vols lisible » est déjà notée (COUVERTURE). | — |

### 2.4 Tâches

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 33 | Tâches | Garder chaque tâche **sur la demande qu'elle sert** : répondre à un message d'une tâche la corrige ; un message sans cible va au chat principal, qui peut l'aiguiller vers une tâche si l'intention est claire | PARTIEL | Répondre sur la carte de tâche (`server/src/agent/bgtasks.ts:79,89`) ; `server/test/wave9.test.ts` | Pas d'aiguillage automatique d'un message libre. | S |
| 34 | Tâches | Chaque message d'une tâche **cite le message de l'utilisateur** auquel il appartient | MANQUANT | — | — | S |
| 35 | Tâches | « **Réessaie** » juste après un résultat : reprend avec la demande d'origine et **vérifie si l'action a déjà eu lieu** avant de refaire | PARTIEL | Carte « C'est passé ? » et registre incertain (COUVERTURE A3) | Pas de « réessaie » en langage courant relié à la dernière tâche. | S |
| 36 | Tâches | Les demandes retirées par l'utilisateur sont exclues des consignes de reprise | NON VÉRIFIÉ → § 5 | — | — | S |
| 37 | Tâches | Un travail extérieur (attente d'une personne) part dans sa propre tâche ; les questions périmées sont fermées | PARTIEL | Tâches de fond (`task_start`) | Fermeture des questions périmées non vérifiée. | S |
| 38 | Tâches | Détails de tâche et d'activité **fermés par défaut**, plan en liste à cocher dans le détail | FAIT | Carte de tâche repliée (`bgtasks.ts`) ; pas de test web | — | — |
| 39 | Tâches | Règle d'équilibre pendant les longues tâches (premiers résultats utiles vs interruptions) | PARTIEL | `progress_update` (`server/src/agent/tools.ts`) | Pas de consigne explicite d'équilibre. | S |

### 2.5 Routines

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 40 | Routines | **Piste des exécutions** : en retard, sautées pendant l'arrêt, ratées, avec l'heure prévue et réelle ; affichée en tête du premier message d'une exécution en retard | PARTIEL | Exécutions « sautée » (`server/src/routines.ts:206-208`), historique `/routines/:id/runs` | Pas de piste lisible « prévue à / sautées / lancée à » dans le chat. | S |
| 41 | Routines | **Activité en direct** d'une exécution dans la liste des routines | MANQUANT | — | — | S |
| 42 | Routines | **Arrêter cette exécution** sans mettre en pause les suivantes (y compris l'attente d'une réponse) | FAIT | `routes.ts` (`/bots/:id/stop`), `server/src/pauses.ts` ; `server/test/pause.test.ts` | — | — |
| 43 | Routines | « **A besoin de toi** » ouvre la question en cours dans le chat sans relancer | PARTIEL | Notification « besoin » (`server/src/push.ts:94`) | Lien direct vers la carte non vérifié. | S |
| 44 | Routines | « Lancer maintenant » refusé si la routine a été modifiée après un échec (relire d'abord) | MANQUANT | — | — | S |
| 45 | Routines | Corrections qui gardent le reste (« toutes les heures plutôt » ne change que l'horaire) ; doublon identique non recréé | PARTIEL | Pas de doublon (COUVERTURE 5b A7) | Correction partielle en langage courant non vérifiée. | S |
| 46 | Routines | Modification avec **aperçu de la prochaine exécution** sans enregistrer ; enregistrer ne change que les champs modifiés | MANQUANT | — | — | S |
| 47 | Routines | Approbation d'une **consigne complète** de routine avec sa portée (cibles, horaire, limites) ; approuver un envoi ne vaut jamais envois récurrents | PARTIEL | Règles liées à une routine (COUVERTURE 5b) | Pas de carte « approuver toute la consigne ». | M |
| 48 | Routines | Consigne enregistrée traçable : une parole retirée ou introuvable ne peut plus servir de permission | NON VÉRIFIÉ → § 5 | — | — | S |
| 49 | Routines | Fuseaux horaires que l'appli ne sait pas afficher refusés ; emoji gardés entiers dans un titre raccourci | NON VÉRIFIÉ | `server/src/cron.ts` | — | S |

### 2.6 Modèles

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 50 | Modèles | **Un modèle par type de travail** : discussion, routines, travail lancé seul (vérifications, préparation) ; et **un modèle par tâche** et **par routine** | MANQUANT | Modèle par bot, modèle d'appoint pour la mémoire (`server/src/config.ts:175`) ; `routines.ts` sans champ modèle | Une veille quotidienne tourne sur le modèle cher. Déjà noté (audit Hermes l. 128, 162). | S |
| 51 | Modèles | **Coût mensuel projeté** d'une routine au prix du modèle choisi | FAIT | `typicalRunUsd` (`server/src/routines.ts:84-95`) ; `server/test/wave5b.test.ts` | — | — |
| 52 | Modèles | **Vérification du modèle** par une toute petite requête au choix et au démarrage ; raison du fournisseur affichée au-dessus de la saisie **avant d'envoyer** | MANQUANT | Santé des connexions (`server/src/health.ts`) | L'utilisateur découvre la panne en envoyant. | S |
| 53 | Modèles | Après un échec, **le travail automatique arrête d'utiliser ce modèle** (routines récurrentes sautées, une routine ponctuelle tourne et signale) ; clé refusée (401) = « à reconnecter », plus aucune requête | PARTIEL | Disjoncteur par fournisseur (`server/src/agent/failures.ts`) ; `server/test/failures.test.ts` | Pas de saut explicite des routines ni d'état « à reconnecter » visible. Non vérifié en détail. | S |
| 54 | Modèles | Message d'échec qui garde la **raison du fournisseur** (clé, crédit, quota, accès) et un lien vers les réglages des modèles, au lieu de demander au modèle de l'expliquer | PARTIEL | Carte d'échec avec remèdes (`failures.ts:132-166`) | Lien direct vers les réglages non vérifié. | S |
| 55 | Modèles | Sélecteur : recherche par modèle, fournisseur ou compte, regroupé par connexion, recommandés d'abord, modèle actuel coché | PARTIEL | `AiAccounts.tsx` (OpenRouter) | — | S |
| 56 | Modèles | Vérificateur d'actions au niveau de réflexion le plus bas par défaut ; réglable vers un petit modèle ; revues annulables avec délai du fournisseur au-delà de 45 s | PARTIEL | Modèle du relecteur réglable (COUVERTURE « Mode Auto ») | Délai et annulation non vérifiés. | S |

### 2.7 Vérificateur d'actions (corrections)

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 57 | Accords | Décrire **la requête HTTP exacte** et **l'outil MCP choisi** dans la question ; compte HTTP figé pendant la revue | PARTIEL | Carte d'accord avec arguments (`server/src/agent/loop.ts:1803`), empreinte de l'action (COUVERTURE A3) | Pas de phrase « méthode + adresse + corps » pour les connecteurs API. | S |
| 58 | Accords | Nommer **ce qu'un clic du navigateur engage** ; inspecter le contrôle qui reçoit vraiment le clic ; refuser un clic sur un point non identifié | FAIT | Lecture du contrôle sous le point avant `screen_click` (COUVERTURE 5b A13) ; `server/test/wave5b.test.ts` | — | — |
| 59 | Accords | **Confirmer** une action explicite répétée ; relire le texte de confirmation visible ; garder les mots de l'utilisateur quand il refuse | PARTIEL | Citation `user_quote` (COUVERTURE A1) | Mots du refus non gardés comme consigne (non vérifié). | S |
| 60 | Accords | Ouvrir un fichier ou **se connecter** n'est **jamais** une simple lecture | NON VÉRIFIÉ → § 5 | Plancher déterministe (COUVERTURE A1) | — | S |
| 61 | Accords | Citations comparées sans tenir compte des accents ni des guillemets droits / courbes | PARTIEL | Normalisation (COUVERTURE A1) | Accents : non vérifié. | S |
| 62 | Accords | Agir sur un choix déjà exprimé au lieu de redemander confirmation | PARTIEL | — | Consigne à vérifier dans `prompt.ts`. | S |

### 2.8 Connecteurs

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 63 | Connecteurs | **Format ouvert de connecteur** (dossier : fiche, contrat, icône ; MCP, API HTTP ou outil en ligne de commande), validateur, **exigences de preuve** pour l'accepter (doc officielle, essais de reconnexion / refus / expiration, écriture testée sur un enregistrement réversible, mainteneur nommé), page publique par connecteur | PARTIEL | Catalogue (`server/src/catalog.ts`, `connectorcatalogroutes.ts`), connecteurs API à la demande (COUVERTURE 5b A16) | Pas de format de contribution ni de checklist de preuve. | M |
| 64 | Connecteurs | Adresse MCP **privée** (localhost, réseau local, Tailscale) acceptée **seulement si l'utilisateur la tape** lui-même, jamais proposée par le modèle ; jeton envoyé seulement à cette adresse | MANQUANT | Garde réseau (`server/src/net.ts`) refuse le local | Pour un n8n auto-hébergé sur le réseau de l'utilisateur, impossible. En mode hébergé, à n'autoriser que via le Relais. | M |
| 65 | Connecteurs | **Renommer** un connecteur MCP ajouté à la main | MANQUANT | — | — | S |
| 66 | Connecteurs | Repli sur l'**ancien transport HTTP+SSE** quand un serveur refuse le transport récent (hors 401/403), mêmes contrôles | MANQUANT | `server/src/agent/mcp.ts` | Certains serveurs MCP anciens ne se connectent pas. | S |
| 67 | Connecteurs | Garder ouvert un long appel MCP tant que le serveur signale un progrès ; n'arrêter que l'appel stoppé sur une connexion partagée ; adresse régionale proposée selon l'espace de travail ; User-Agent sur chaque requête | NON VÉRIFIÉ → § 5 | `server/src/agent/mcp.ts` | — | S |

### 2.9 Canaux, confidentialité, appli de bureau

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 68 | Telegram | **Boutons d'accord** sous la question (dans sa langue) ; envoi de vocaux, contacts, positions ; fichiers jusqu'à 50 Mo ; fichier > 20 Mo refusé avec raison ; longues réponses découpées ; « écrit… » pendant le travail | PARTIEL | 👍/👎 sur une demande (`server/src/telegram.ts:184-188`), texte seulement (`telegram.ts:71`) | Pas de boutons, pas d'envoi de fichiers ni de réception de photos / vocaux (audit Hermes l. 88-89). | M |
| 69 | WhatsApp | Liaison par QR, Cloud API, vocaux, cartes de contact | NON REPRIS | — | QR = API non officielle ; Cloud API = compte professionnel Meta (bloqué par un fournisseur, COUVERTURE). | — |
| 70 | Bureau | Mises à jour reprises et installées à la fermeture, échecs de mise à jour avec boutons de récupération ; certificats système expirés ignorés ; erreurs de démarrage montrées sans relancer le moteur en boucle | MANQUANT | `companion/` sans mise à jour auto (COUVERTURE « Applis ») | — | S |

Vu mais non compté (NON REPRIS ou sans objet pour Sklubot) : traces de conversation exportées vers un outil d'analyse avec exclusions (Sklubot n'envoie rien dehors), sondages et analytics sur les cartes de premières tâches, Flatpak Linux, compatibilité Bedrock HTTP/1.1, recommandations de modèles de la semaine (Gemini, GPT), banc d'essai interne.

---

## 3. Écarts de comportement (court)

1. **Bot sur ton ordinateur** — nod lit l'arbre d'accessibilité, refuse d'office terminaux, réglages, gestionnaires de mots de passe, relit la fenêtre avant de taper, ne touche jamais un champ mot de passe, rend le focus et le presse-papier. Le Relais de Sklubot (`companion/src/main/relay-core.js`) pilote souris et clavier à l'aveugle sur tout l'écran **et accepte des commandes shell** dans la session approuvée. C'est l'écart de sécurité le plus net de la semaine. **Correctif** : liste d'applis refusées + liste « garder à l'écart » + garde « champ mot de passe » (via l'API d'accessibilité de chaque système, déjà demandée par le Relais, `companion/src/main/i18n.js:61`) + revérifier la fenêtre active avant `keyboard.type`. M.
2. **Ce que fait l'assistant pendant l'attente** — nod affiche dès l'envoi un mot animé, puis une phrase résumant la demande, puis « en attente de [modèle] » après une minute, et « nouvel essai 1/3 » en cas d'échec. Sklubot montre les étapes, mais rien entre l'envoi et le premier pas, et rien pendant les essais (`reliability.ts:41-48` est muet). **Correctif** : événements « en attente du modèle » et « essai n/N » envoyés au chat. S.
3. **Routines** — nod rend lisibles retards, sauts et échecs dans une piste, montre l'activité en direct, refuse « lancer maintenant » sur une routine changée après un échec. Sklubot a l'état « sautée » et l'arrêt d'une exécution, pas la piste. **Correctif** : piste en tête du message d'une exécution en retard ; activité en direct dans la liste. S.
4. **Modèles** — nod vérifie le modèle avant qu'on envoie et arrête le travail automatique sur un modèle en échec ; une routine récurrente est sautée plutôt que de répéter l'échec. Sklubot découvre l'échec au tour. **Correctif** : petite requête de santé au choix du modèle et au démarrage, état « à reconnecter » sur 401. S.
5. **Connecteur MCP privé** — nod accepte une adresse locale **tapée par l'utilisateur** (jamais proposée par le modèle). Sklubot refuse le local, ce qui est juste en mode hébergé ; en auto-hébergé ou via le Relais, l'utilisateur perd son n8n local. **Correctif** : autoriser en auto-hébergé seulement, saisie humaine obligatoire. M.

---

## 4. À faire (classé)

1. Relais : applis refusées d'office (terminaux, réglages, mots de passe), liste « garder à l'écart », garde des champs mot de passe, revérification de la fenêtre avant saisie, et retrait du shell hors accord explicite. M.
2. Modèle par routine et pour le travail de fond ; modèle par tâche. S. — **Partiel (22/11)** : modèle par tâche fait ; routines / travail de fond gardés et résolus (`routineplus.ts`), pas encore appliqués par la boucle.
3. ✅ Fait (2026-11-22, `llm/timeouts.ts` callHooks, `modelhealth.ts`, `web/src/lib/requestSummary.ts`). Ligne d'activité : « en attente du modèle » après 60 s, « nouvel essai n/N », résumé immédiat de la demande. S.
4. ✅ Fait (2026-11-22, `modelhealth.ts`, `ModelHealth.tsx`, mobile `ModelHealthBanner.tsx`). Vérification de santé du modèle au choix et au démarrage ; raison affichée avant l'envoi ; 401 = « à reconnecter ». S.
5. Telegram : boutons d'accord, envoi de fichiers et vocaux, réception de photos / vocaux, découpage des longues réponses. M. — **Fait (22/11)** : `telegramplus.ts`, test `nod-telegram.test.ts`.
6. Répondre à un message / à une sélection ; Copier sur blocs de code et tableaux. S. — **Fait (22/11)** : `ReplyAction.tsx`, `messagecopy.ts`.
7. Carte « Signaler un problème » avec rapport masqué. S.
8. Routines : piste des retards / sauts / échecs, activité en direct, refus de « lancer maintenant » après modification, aperçu de la prochaine exécution. S chacun. — **Fait (22/11)** : `routineplus.ts`, `RoutineEditor.tsx`, test `nod-routines.test.ts`.
9. Accès aux fichiers locaux activable depuis la discussion. S. — **Fait (22/11)** : `fileaccess.ts`, outil `my_file_access`, test `wave5b-files.test.ts`.
10. Repli HTTP+SSE pour MCP ; renommer un connecteur MCP. S. — **Fait (22/11)** : `mcptransport.ts`, test `nod-mcp.test.ts`.
11. Connecteurs : format de contribution et checklist de preuve. M. — **Fait (22/11, doc)** : `docs/CONNECTEURS-CONTRIBUTION.md`.
12. Langue qui suit le dernier message de l'utilisateur. S. — **Fait (22/11)** : `agent/nodguidance.ts`.
13. Approuver une consigne de routine complète avec sa portée. M. — **Fait (22/11)** : `routineplus.ts` (règle liée à la routine, coupée à toute modification).
14. Mises à jour automatiques de l'appli Relais. S. — **Fait (déjà en place, vérifié 22/11)** : vérification des versions GitHub et lien de téléchargement, jamais d'installation sans clic (`app-window.js`) ; installation automatique quand les fichiers seront signés.
15. Consigne « connecteur d'abord, appli locale ensuite ». S. — **Fait (22/11)** : `agent/nodguidance.ts`.
16. Garder l'ordinateur éveillé pendant une tâche locale (Relais). S. — **Fait (22/11)** : `companion/src/main/keep-awake.js`.
17. Adresse MCP privée tapée par l'utilisateur, en auto-hébergé seulement. M. — **Fait (22/11)** : `mcptransport.ts`.

**À ajouter au cahier 07** (section « mise à jour du 21/11 ») : lignes 1-14, 20, 22, 29, 40-47, 50, 52-53, 57-62, 63-66, 68.

---

## 5. Non vérifié

- Contrôles d'identité / taille / dates et non-suivi des liens dans `companion` `fs.read` / `fs.write` (ligne 16) ; marque d'ordre des octets (19).
- Clavier tactile du compositeur (25).
- Exclusion des demandes retirées à la reprise (36), traçabilité des consignes de routine (48), fuseaux horaires (49).
- « Ouvrir un fichier ou se connecter = jamais une lecture » dans le plancher de Sklubot (60) ; insensibilité aux accents des citations (61).
- Comportement MCP détaillé (67).
- Aucun test Sklubot relancé pour ce dépôt. Le code de nod n'a pas été exécuté.
