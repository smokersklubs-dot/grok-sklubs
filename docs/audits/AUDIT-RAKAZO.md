# Audit : elie222/rakazo — ce qui est nouveau depuis le cahier 02, comparé à Sklubot

Date : 22/11/2026. Lecture seule. Rien n'a été modifié dans Sklubot.

**Salle blanche.** Ce dépôt est une source d'étude déclarée de Sklubot. Tout ce qui suit est décrit **avec nos mots** ; aucun code, aucun texte d'interface, aucune consigne ni nom interne n'est recopié. Les fonctions « sans censure » présentées par une page tierce sont hors sujet et ne sont pas décrites.

- Cahier existant : `docs/cleanroom/02-capabilities-b.md` (RKZ-001 à RKZ-968, fichier daté du 13/11/2026, donc au plus tard la version 0.11.0 du 12/11).
- Dépôt relu : `elie222/rakazo`, HEAD `6d1b3bf` (22/11/2026). Depuis le cahier : versions **0.12.0** (16/11) et **0.13.0** (19/11), plus **549 commits** depuis le 19/11 (non publiés).
- Pages publiques lues : la page d'accueil française du produit et une page tierce de mode d'emploi d'auto-hébergement (seules les étapes légitimes ont été retenues : modèle local ou GPU loué, installation par images publiées, connexion d'un serveur compatible OpenAI, test des outils).
- Méthode : journal des changements des versions 0.12 et 0.13, messages des commits depuis le 19/11, recherche dans le cahier 02 de chaque nouveauté pour ne garder que ce qu'il ne décrit pas encore, puis recherche dans le code de Sklubot.

## Comptes (nouveautés uniquement)

| Statut | Nombre |
|---|---|
| FAIT | 9 |
| PARTIEL | 32 |
| MANQUANT | 14 |
| DIFFÉRENT | 2 |
| NON REPRIS | 4 |
| Non vérifié (voir § 5) | 9 |
| **Total** | **70** |

Lecture rapide. Les deux versions ont ajouté : (1) des **robots de réunion** qui rejoignent un appel et rendent une transcription par intervenant ; (2) des **brouillons modifiables dans la carte d'accord** (e-mail, message d'équipe) ; (3) des **membres d'organisation** et des **invités par espace** ; (4) une **mémoire de conversation partagée ou isolée** ; (5) un **coffre plus fin** (bots autorisés par élément, « demander avant chaque usage », historique d'usage, import CSV) ; (6) des **réglages par modèle** (limites, images, réflexion) et un sélecteur de modèle dans la saisie ; (7) des **routines lancées par webhook, événement Git, message de messagerie ou e-mail**, au choix à côté de la discussion ou dans un tour ; (8) beaucoup de sécurité (e-mail entrant signé, oui+non à l'oral refusé, total de paiement ambigu, masquage des secrets dans les erreurs, limites anti-ReDoS) et d'accessibilité.

---

## 1. Licence

| Partie | Licence | Ce qu'elle permet |
|---|---|---|
| Dépôt | **Apache License 2.0** (`LICENSE`) + `NOTICE` | Copie autorisée avec licence, NOTICE et mention des changements. Choix de Sklubot : **salle blanche** (source d'étude déclarée) ; seules quelques valeurs de palette ont été reprises ailleurs avec attribution (audit Hermes). On reste sur « idées seulement ». |
| Nom, logo | non couverts | À ne pas reprendre. |

---

## 2. Tableau des nouveautés (absentes du cahier 02)

### 2.1 Réunions, voix

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 1 | Réunions | Un bot **rejoint un appel vidéo** pris en charge et rend une **transcription par intervenant** ; présence programmée depuis l'agenda (ponctuel et récurrent) ; peut parler en direct si configuré ; désactivé par défaut par espace | DIFFÉRENT | Enregistreur de réunion dans le navigateur de l'utilisateur (`web/src/components/MeetingRecorder.tsx`) puis transcription (`server/src/voice/transcribe.ts`, `server/test/voice-transcribe.test.ts`) | Le bot ne rejoint pas l'appel ; pas d'intervenants. Bloqué par un fournisseur (COUVERTURE « Réunions »). | L |
| 2 | Voix | Une réponse orale contenant **à la fois oui et non** ne peut pas approuver ; un OUI/NON par texto ne vaut que pour une invitation reçue avant | MANQUANT | Accords vocaux non trouvés (grep) | Vérifier si un appel vocal peut approuver ; si oui, ajouter la règle. | S |
| 3 | Voix | Serveurs de synthèse et de transcription séparés, chacun sa clé ; repli sur une voix acceptée si le serveur refuse la voix choisie | PARTIEL | Fournisseurs de voix (`server/src/voice/providers.ts`, `autovoice.ts`) ; `server/test/voice-fish-kokoro.test.ts` | Repli de voix non vérifié. | S |
| 4 | Voix | Appel Android : la reconnaissance ne transcrit plus la voix du bot ; parler par-dessus ne coupe plus la réponse | PARTIEL | Détection de voix (`server/src/voice/vad.ts`) ; `server/test/wave6-voice.test.ts` | Annulation d'écho non vérifiée. | S |

### 2.2 Accords et brouillons

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 5 | Accords | **Modifier un brouillon** (e-mail, message d'équipe en texte simple) **dans la carte d'accord** avant l'envoi | MANQUANT | Brouillon créé dans la boîte mail, carte oui/non (`server/src/native/tools.ts:244,266`) | L'utilisateur doit quitter Sklubot pour corriger. Déjà noté (COUVERTURE « Carte de brouillon »). | M |
| 6 | Accords | Un connecteur MCP peut **poser une question ou demander une confirmation** dans la discussion | MANQUANT | grep `elicit` : rien | — | M |
| 7 | Accords | Les réglages d'accord s'appliquent aussi aux **routines, messageries et travaux influencés par du contenu extérieur** ; la revue automatique tient compte des dernières consignes du propriétaire et demande pour un **nouveau site** | FAIT | Plancher déterministe et relecteur qui sait si du contenu extérieur a été lu (COUVERTURE spec 07 A1), sites de confiance manquants | « Demander avant un site jamais vu » : MANQUANT (COUVERTURE « Demander avant d'ouvrir un lien sortant »). | S |
| 8 | Accords | Créer un **déclencheur d'événement** ou **enregistrer une compétence** demande un accord quand du contenu extérieur a pu influencer la demande | PARTIEL | `skill_propose` passe par une carte (`server/src/agent/tools.ts:785`) | Création de déclencheur par le bot après contenu extérieur : non vérifié. | S |
| 9 | Accords | Enregistrer une mémoire **après lecture de contenu extérieur** suit le mode d'accord et la liste « toujours » | FAIT (plus strict) | Mémoire apprise **seulement** des messages tapés par l'utilisateur, extrait vérifié (COUVERTURE A8, `server/src/agent/memory.ts`) ; `server/test/memory-guard.test.ts` | — | — |
| 10 | Accords | Une question du bot **reste ouverte** jusqu'à une réponse, sauf si elle tient un code à usage unique qui expire | DIFFÉRENT | Expiration après 25 min (`server/src/config.ts:188-191`) | Choix inverse. Pour un non-développeur, une question qui disparaît est plus déroutante. | S |
| 11 | Accords | Annuler une exécution ne laisse **jamais** son accord en attente d'une personne ; une carte de prise de main se règle sur place | NON VÉRIFIÉ → § 5 | `server/src/agent/loop.ts:1868` (`decideApproval`) | — | S |
| 12 | Paiement | Total de paiement **ambigu** = paiement manuel, même après une revérification ; « $.99 » lu comme des centimes ; contrôles du moyen de paiement exclus de l'accord ; **refus d'un clic si la page est illisible** au lieu de demander | PARTIEL | Paiement par carte du coffre approuvé un par un (COUVERTURE 5b A12), lecture du contrôle avant clic (A13) ; `server/test/wave5b.test.ts` | Règle « total ambigu = manuel » non vérifiée ; clic de paiement au zoom du navigateur non vérifié. | S |

### 2.3 Coffre, connexion, comptes

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 13 | Coffre | Un élément du coffre peut être **limité à certains bots**, **demander avant chaque usage**, porter plusieurs sites de connexion et une clé d'authentification, afficher son **historique d'usage** | PARTIEL | Coffre (`web/src/components/VaultSection.tsx`), codes TOTP (cahier 02 RKZ-237) | Pas de restriction par bot, pas de « demander à chaque fois », pas d'historique par élément. | M |
| 14 | Coffre | **Importer des identifiants** depuis un fichier CSV | MANQUANT | — | Import depuis un gestionnaire de mots de passe impossible. | S |
| 15 | Coffre | Un identifiant enregistré peut **choisir une option dans une liste déroulante native** sans montrer la valeur au bot | MANQUANT | Saisie des secrets à l'écran sans les montrer (COUVERTURE A11) | Listes déroulantes non couvertes. | S |
| 16 | Coffre | « Coffre plein » dit clairement quand on répond par un secret | NON VÉRIFIÉ | — | — | S |
| 17 | Coffre | Éléments sous **clés de chiffrement tournantes** | FAIT | `server/src/datakeyrotate.ts`, `rotatekey.ts` ; `server/test/data-key.test.ts` | — | — |
| 18 | Comptes | Connexion par **Google et Apple**, **clés d'accès (passkeys)**, dernière méthode marquée | PARTIEL | Google (`server/src/googlelogin.ts`, `server/test/google-login.test.ts`), double facteur TOTP (`server/src/totp.ts`, `server/test/totp.test.ts`) | Pas d'Apple ni de passkeys. | M |
| 19 | Comptes | Restriction d'inscription par domaine refusant les adresses à deux « @ » | NON VÉRIFIÉ | `server/src/publicsignup.ts` | — | S |
| 20 | Organisation | Inviter des membres, changer leur rôle, les retirer ; chaque membre a un **espace privé** ; rejoindre ne montre pas les espaces des autres ; retirer un membre garde son travail | PARTIEL | Espaces d'équipe (`server/src/workspaces.ts`) ; `server/test/wave6-workspaces.test.ts` | Garde du travail d'un membre retiré non vérifiée. | M |
| 21 | Organisation | **Invités extérieurs** sur un espace précis, par e-mail ; liste des espaces qui ont des invités | MANQUANT | — | Déjà noté (COUVERTURE « Partager une page à des invités »). | M |

### 2.4 Mémoire, compétences

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 22 | Mémoire | **Mémoire de conversation** facultative : apprend des discussions directes et de groupe, **isolée par défaut**, ou **partagée** dans l'espace | PARTIEL | Mémoire par bot (`server/src/agent/memory.ts`), rappel BM25 (`server/test/memory-recall.test.ts`) | Pas de mode partagé (COUVERTURE « Mémoire d'équipe »). | L |
| 23 | Mémoire | La mémoire **propre du bot passe avant** les documents partagés | FAIT (par construction) | Pas de documents partagés injectés | — | — |
| 24 | Mémoire | Fournisseur de mémoire externe modifiable sans déconnexion ; adresses privées soumises au consentement de l'opérateur | NON REPRIS | — | Pas de mémoire externe chez Sklubot (choix de confidentialité). | — |
| 25 | Mémoire | Le bot peut enregistrer une **demande permanente** dans ses consignes, avec les autres réglages | PARTIEL | `rule_propose` (COUVERTURE 5b « Règles modifiées depuis la discussion ») | Consignes du bot elles-mêmes non modifiables par lui. | S |
| 26 | Recherche | Recherche dans l'historique : extraits qui couvrent le plus de mots, correspondances recalées sur le texte d'origine, accents ignorés | PARTIEL | `conversation_search` (`server/src/agent/tools.ts:743`), `server/src/search.ts` | Qualité des extraits non vérifiée. | S |
| 27 | Compétences | Importer des **catalogues** de compétences ou des dossiers depuis GitHub, avec leurs ressources texte ; scripts **jamais exécutés** | FAIT | `server/src/skillsgithub.ts`, analyse (`server/src/skillscan.ts`) ; `server/test/skill-scan.test.ts`, `skills-library.test.ts` | — | — |
| 28 | Import | Import d'agent qui guide la configuration, reprend plus de routines et souvenirs, et **liste dans le chat du nouveau bot ce qui reste à configurer** | PARTIEL | Import Grok (`server/src/grokimport.ts`) ; `server/test/grok-import.test.ts` | Liste « reste à faire » dans le chat non vérifiée. | S |
| 29 | Travail ouvert | Le travail ouvert que personne ne touche pendant **14 jours** est mis de côté automatiquement | MANQUANT | Tâches de fond, objectifs (`server/src/agent/goals.ts`) | — | S |
| 30 | Tickets | Tableau de tickets et outils des bots (expérimental, activable par compte) | MANQUANT | `TasksView.tsx` | Déjà noté (COUVERTURE RKZ-250–251). | L |

### 2.5 Modèles, fiabilité du tour

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 31 | Modèles | **Réglages par modèle connecté** : limites de contexte et de sortie, images acceptées, réflexion ; liste cherchable ; page de réglages par modèle ; routage par projet ou région | PARTIEL | Modèles OpenRouter et compatibles OpenAI (`server/src/openrouter.ts`, `server/src/llm/openai-compat.ts`) | Limites et capacité « images » par modèle non réglables par l'utilisateur (non vérifié). | M |
| 32 | Modèles | **Sélecteur de modèle dans la zone de saisie** (web, bureau, mobile), réglage de réflexion à côté | MANQUANT | Modèle dans la fiche du bot (`web/src/components/BotSettings.tsx`) | — | S |
| 33 | Modèles | Refuser à la connexion une clé **sans crédit** ou au solde suspendu | MANQUANT | — | L'utilisateur découvre l'échec au premier message. | S |
| 34 | Modèles | Rappel dans sa langue au propriétaire qui n'a pas encore connecté de modèle | PARTIEL | Accueil (`web/src/components/Onboarding.tsx`) | — | S |
| 35 | Modèles | Bascule de modèle quand la limite de crédit est signalée **pendant** le flux | NON VÉRIFIÉ | `server/src/agent/reliability.ts` | — | S |
| 36 | Modèles | Nouvel essai sur une réponse **vide**, « réflexion seulement », interrompue ou inachevée, y compris pendant un appel d'outil ; raisonnement chiffré incompatible renvoyé sans lui | PARTIEL | Réponse vide relancée puis avis (`server/src/agent/loop.ts:1085-1088`) | « Réflexion seulement » et coupure en plein appel d'outil non vérifiées. | S |
| 37 | Fiabilité | Arrêter une boucle improductive quand **un outil renvoie toujours le même résultat** | FAIT | `server/src/agent/loop.ts:1105,1502` | — | — |
| 38 | Fiabilité | Garder les anciens appels d'outils, résultats et la dernière capture pour les tours suivants | FAIT | `server/src/agent/context.ts:36,91` (retrait mesuré) | — | — |
| 39 | Fiabilité | **Rappel puis expiration** d'un travail bloqué (délais réglables) | PARTIEL | Rappel (`server/src/config.ts:185`), veille (`server/src/agent/watch.ts`) | Pas d'expiration automatique (voir audit Timon T36). | S |
| 40 | Fiabilité | Reprise après une courte panne de base de données ; au déploiement, les tours en cours **finissent ou rendent la main entre deux étapes** | PARTIEL | Reprise au démarrage (`loop.ts:1678-1730`) ; `server/test/engine-queue.test.ts` | Pas d'arrêt « en douceur » qui attend la fin des tours. | M |
| 41 | Fiabilité | Rythme maximal d'appels pour un modèle local ; réglage du rognage de contexte pour les serveurs sans cache | MANQUANT | — | Utile pour Ollama sur petit serveur. | S |
| 42 | Usage | Consommation **par bot et par modèle** sur une période ; **jetons d'entrée en cache** par modèle | PARTIEL | Tableaux et CSV (`server/src/usage.ts`) ; `server/test/costs.test.ts` | Pas de jetons en cache ni de graphique par bot (COUVERTURE). | S |

### 2.6 Délégation, routines, messageries

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 43 | Délégation | Un bot délégué garde **ses propres consignes et capacités**, travaille de son côté pendant que le parent reste disponible, et renvoie résultats **et pièces jointes** dans la discussion d'origine | PARTIEL | Délégation entre bots (`server/src/agent/team.ts`), tâches de fond (`bgtasks.ts`) ; `server/test/room-routing.test.ts` | Retour des pièces jointes vers la discussion d'origine non vérifié. | S |
| 44 | Délégation | Un bot gestionnaire est prévenu que ses sous-agents n'ont pas les outils de gestion des bots | NON VÉRIFIÉ | `server/src/agent/tools-team.ts` | — | S |
| 45 | Routines | Routine lancée par **webhook, événement Git, message de messagerie ou e-mail** | PARTIEL | Webhook (`server/src/routes.ts:400`), e-mail et messages natifs (`server/src/native/triggers.ts`, `scheduler.ts:153-164`) ; GitHub (`server/src/githubactivity.ts`) | Vérifier qu'un événement Git peut lancer une routine (et pas seulement une issue). | S |
| 46 | Routines | Choisir si la routine tourne **à côté** de la discussion ou **comme un tour dedans** | MANQUANT | Les routines écrivent dans le fil du bot | — | S |
| 47 | Routines | Un bot peut **publier dans un groupe** dont il est membre depuis une autre discussion | PARTIEL | Salons (`server/src/agent/roomroutes.ts`, `tools-room.ts`) | Non vérifié depuis une routine. | S |
| 48 | Routines | Prochaine exécution juste au changement d'heure | NON VÉRIFIÉ | `server/src/cron.ts` | — | S |
| 49 | Messageries | Applis de messagerie à deux : la question en attente ou la demande de prise de main est envoyée **en texte avec un lien** vers l'appli ; dans un groupe, ces demandes restent privées | PARTIEL | Telegram : accords par 👍/👎 (`server/src/telegram.ts:184-188`) | Pas de lien vers la carte ; prise de main non relayée. | S |
| 50 | Messageries | Recevoir les **fichiers** envoyés en message direct ; WhatsApp : fichiers et images dans les réponses | MANQUANT | `server/src/telegram.ts:71` (texte seulement) | Déjà noté (audit Hermes l. 88-89). WhatsApp non repris. | M |
| 51 | Messageries | Longues réponses découpées sans casser mise en forme ni liens ; @tous ; mention d'un bot dans du code gardée | PARTIEL | `telegram.ts` | Découpage soigné non vérifié. | S |
| 52 | Messageries | Bot dans Slack, Teams, iMessage/SMS ; WhatsApp et Telegram en auto-hébergé | PARTIEL | Telegram complet, Slack comme appli (COUVERTURE « Canaux ») | Slack / Teams en canal : manquants (Teams bloqué par un fournisseur). | L |

### 2.7 E-mail du bot

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 53 | E-mail | Un e-mail entrant ne vaut **consigne du propriétaire** que s'il est **signé** pour le destinataire ; un SPF transmis par un relais ne suffit plus | FAIT (plus strict) | Tout e-mail entrant est contenu extérieur et ne donne jamais d'ordre (`server/src/botmail.ts:244`), SPF/DKIM/DMARC vérifiés (`botmail.ts:33,159,209`) ; `server/test/wave6-mail.test.ts` | — | — |
| 54 | E-mail | Envoi par le bot sur une connexion SMTP séparée avec **liste de destinataires autorisés** ; par défaut seulement au propriétaire vérifié | PARTIEL | Adresse du bot, 50 envois/jour (`server/src/botmail.ts`), relais d'envoi (migration 020) | Pas de « propriétaire seulement par défaut » ni de liste visible (COUVERTURE « Alias, liste d'exclusion »). | S |
| 55 | E-mail | Texte cité et répétitif retiré du contexte ; pièces jointes ouvertes **à la demande** | PARTIEL | `botmail.ts` | Retrait du texte cité non vérifié. | S |

### 2.8 Ordinateur du bot, fichiers

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 56 | Ordinateur | **Lire les fichiers d'un ordinateur arrêté** sans le réveiller ; un ordinateur inutile pendant un tour peut **dormir** | PARTIEL | Navigateur inactif fermé (`server/src/computer.ts:103-112`), disque de l'équipe (`server/src/disk.ts`) | Lecture à froid non vérifiée. | M |
| 57 | Ordinateur | Panneau du bot : écran en direct et progression de la connexion ; un seul modèle « voir / prendre la main / rendre » | FAIT | `web/src/components/ComputerViewer.tsx`, `LiveScreen.tsx` ; pas de test web | — | — |
| 58 | Ordinateur | Jamais l'écran d'un autre bot dans le panneau d'un bot | NON VÉRIFIÉ | `ComputerViewer.tsx` | — | S |
| 59 | Ordinateur | Sites choisis passés par un **proxy du navigateur** (fichier PAC) ; GPU exposés aux programmes (option, avertie) | NON REPRIS | — | Option d'opérateur avancée ; le pare-feu fixe suffit (`deploy/bots-firewall.sh`). | — |
| 60 | Ordinateur | Mobile : écran Ordinateurs (appareils liés, révocation), pavé tactile plein écran avec zoom | PARTIEL | Appli mobile (`mobile/`), appareils reliés (`server/src/relay.ts`) | Pavé tactile non vérifié. | S |
| 61 | Fichiers | Joindre QuickTime, 3GP, HEIC/HEIF, RAR, 7z ; copier un aperçu texte / Markdown ; collage long **joint comme fichier** ou gardé dans le message | PARTIEL | `server/src/uploads.ts`, `attachmentpreviews.ts` ; `server/test/large-attachments.test.ts` | HEIC et « collage long → fichier » non vérifiés. | S |
| 62 | Chat | **Citer le texte sélectionné** au clavier ; commandes `/` utilisables n'importe où dans le message | MANQUANT | `/skill` en début de message (`server/src/routes.ts:868`) | — | S |
| 63 | Pages | Pages : tableaux imbriqués, tri numérique, dates seules, écriture de droite à gauche, diagrammes en japonais / chinois | PARTIEL | Pages et artefacts (`server/src/pageroutes.ts`, `server/src/artifact-design.ts`) ; `server/test/pages-artifacts.test.ts` | Écriture de droite à gauche non vérifiée. | S |

### 2.9 Sécurité transversale, auto-hébergement, applis

| # | Zone | Nouveauté | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| 64 | Sécurité | Masquage de **plus de formats de secrets** dans les erreurs et journaux (valeurs entre guillemets ou encodées, en-têtes, mots de passe d'URL, cookies, JSON imbriqué) ; cartes Amex/Diners groupées | PARTIEL | Masquage (`server/src/shared.ts:1166-1181`, `loop.ts:1734`) ; `server/test/security-fixes.test.ts` | Couverture des formats encodés non vérifiée. | S |
| 65 | Sécurité | Noms d'expéditeur et de salon d'une messagerie **ne peuvent pas sortir de leur étiquette** dans la consigne | NON VÉRIFIÉ | `server/src/telegram.ts` | À tester (injection par nom d'affichage). | S |
| 66 | Sécurité | Limites de calcul contre les textes piégés (ReDoS) dans le Markdown, la lecture à voix haute, les pages, les erreurs, les réponses du modèle | NON VÉRIFIÉ | — | À auditer. | M |
| 67 | Sécurité | Collecteur d'erreurs en HTTP clair refusé | NON REPRIS | — | Sklubot n'envoie pas d'erreurs dehors. | — |
| 68 | Auto-hébergé | **Mises à jour stables programmées** ; durée de **conservation de l'historique** des discussions ; plusieurs conteneurs d'API et de travailleurs ; arrêt en douceur | PARTIEL | Sauvegardes (`server/src/autobackup.ts`) ; `server/test/auto-backup.test.ts` | Pas de rétention des discussions ni de mise à jour programmée (COUVERTURE « Politiques de conservation »). | M |
| 69 | Applis | Montre Apple ; notifications vers tous les appareils connectés ; bureau : quitter arrête le serveur local ; versions de bureau pour forks | NON REPRIS | — | iOS bloqué par un fournisseur (COUVERTURE) ; distribution de forks sans objet. | — |
| 70 | Accessibilité | Dizaines de corrections : « réduire les animations » respecté partout, noms accessibles des boutons, annonces pour lecteurs d'écran, saisie par méthode d'entrée respectée | PARTIEL | `web/src/components/*` | Aucun audit d'accessibilité récent de Sklubot (seul `docs/AUDIT-INTERFACE-2026-11-18.md`). | M |

Vu mais non compté (NON REPRIS ou sans objet) : facturation des heures d'ordinateur et crédits du produit, offres de crédits de modèle, stockage Azure, mise à l'échelle Kubernetes / Railway / E2B / Incus, environnement de code tiers relié par carte d'agent distant (cahier 02 RKZ-277 le décrit déjà), modèles recommandés de la semaine, page tierce sur les modèles « sans filtre » (hors périmètre).

Pages publiques : la page d'accueil confirme des fonctions déjà au cahier 02 (gabarits de bots, apprentissage par démonstration, mémoire partagée avec l'équipe, déclencheurs, délégation, appels, modèle par bot, routines quand l'ordinateur est éteint) et précise : jusqu'à 5 ordinateurs simultanés en hébergé, abonnement ChatGPT utilisable en hébergé, abonnement Claude seulement en auto-hébergé. La page tierce décrit l'auto-hébergement par images publiées et la connexion d'un serveur compatible OpenAI local ou loué ; elle recommande de **tester les outils et pas seulement la discussion** (lire une page, écrire et relire un fichier, vérifier le journal des outils) : bonne idée pour l'écran de diagnostic de Sklubot.

---

## 3. Écarts de comportement (court)

1. **Brouillon dans la carte** — la source laisse corriger le texte d'un e-mail ou d'un message dans la carte d'accord, puis envoie exactement ce texte. Sklubot crée un brouillon dans la boîte et demande oui/non (`server/src/native/tools.ts:244,266`) : une faute oblige à refuser et à redemander. **Correctif** : champ modifiable dans la carte, empreinte recalculée sur le texte corrigé (l'accord « exécution unique » existe déjà). M.
2. **Question qui reste ouverte** — la source garde une question jusqu'à la réponse ; Sklubot la fait expirer à 25 min. Pour une routine de nuit, la source risque de bloquer ; pour une discussion, Sklubot perd la question. **Correctif** : expiration seulement pour les tours sans témoin (avec compte à rebours, voir audit Timon T60), jamais dans une discussion. S.
3. **Coffre** — la source peut réserver un identifiant à certains bots et demander à chaque usage. Chez Sklubot tout bot du compte peut utiliser tout élément. **Correctif** : liste « bots autorisés » + interrupteur « demander à chaque fois » + historique. M.
4. **Arrêt en douceur** — la source laisse finir les tours lors d'un déploiement. Sklubot redémarre et reprend (`loop.ts:1678-1730`), ce qui peut refaire une action non protégée (voir audit Timon § 3.12). **Correctif** : à l'arrêt, attendre la fin de l'étape en cours (délai borné) avant de couper. M.
5. **Tester les outils, pas seulement le modèle** — idée de la page tierce : un bouton « vérifier ce bot » qui lui fait lire une page, écrire et relire un fichier, et montre le journal. S.

---

## 4. À faire (classé)

1. Brouillon modifiable dans la carte d'accord (e-mail, message). M.
2. Coffre : bots autorisés par élément, « demander à chaque fois », historique d'usage, import CSV. M.
3. Questions : pas d'expiration dans une discussion surveillée. S.
4. Sélecteur de modèle (et réflexion) dans la zone de saisie ; refus d'une clé sans crédit à la connexion. S.
5. Telegram : fichiers reçus et envoyés ; lien vers la carte en attente. M.
6. Routine « à côté » ou « dans » la discussion. S.
7. Bouton « vérifier ce bot » (page, fichier, journal des outils). S.
8. Citer la sélection au clavier ; `/` n'importe où. S.
9. Mise de côté automatique du travail ouvert après 14 jours sans activité. S.
10. Règle « oui et non à l'oral = pas d'accord » si les appels peuvent approuver. S.
11. Arrêt en douceur des tours au redémarrage. M.
12. E-mail du bot : propriétaire seul par défaut, liste de destinataires visible. S.
13. Rétention réglable de l'historique des discussions. S.
14. Audit ReDoS et injection par noms d'affichage (lignes 65-66). M.
15. Clés d'accès (passkeys) à la connexion. M.
16. Invités extérieurs par espace. M.
17. Mémoire partagée par espace (isolée par défaut). L.
18. Bot qui rejoint une réunion (bloqué par un fournisseur). L.

**À ajouter au cahier 02** (mise à jour du 22/11) : lignes 1-2, 5-6, 8, 10, 12-15, 18, 20-22, 25, 29, 31-33, 39-41, 43, 45-46, 49, 53-56, 61-62, 64-66, 68.

---

## 5. Non vérifié

- Comportement de Sklubot à l'annulation d'une exécution avec un accord en attente (ligne 11).
- « Coffre plein » (16), double « @ » à l'inscription (19), bascule sur limite de crédit en plein flux (35), outils de gestion chez les sous-agents (44), changement d'heure des routines (48), écran d'un autre bot (58).
- Injection par nom d'affichage Telegram (65) et limites anti-ReDoS (66).
- Aucun test Sklubot relancé pour ce dépôt. Le code de la source n'a pas été exécuté ; ses comportements viennent de son journal des changements et des titres de ses commits.
