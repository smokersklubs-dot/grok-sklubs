# Audit : guide public « bot + jumeau numérique » (Google Docs) comparé à Sklubot

Date : 22/11/2026. Lecture seule, par récupération web de la version publique « mobilebasic » du document. Rien n'a été modifié dans Sklubot.

- Document : guide de mise en place « bot + jumeau numérique », version 1, daté du 09/10/2026, rédigé par un créateur de vidéos indépendant, pour accompagner un épisode. Pas de licence indiquée : **idées seulement**, rien n'est recopié.
- Sujet : faire fabriquer par un bot généraliste (celui d'un grand fournisseur d'IA) un **jumeau numérique** de soi : voix clonée chez un fournisseur de synthèse vocale, avatar vidéo chez un fournisseur d'avatars, les deux reliés, puis une première vidéo interne. Le guide décrit aussi la mise en place du bot (appli de bureau, téléphone, ordinateur dans le nuage, connecteurs, prise de main).
- Méthode : chaque étape ou fonction du guide (47 au total) est reprise ci-dessous avec nos mots, et comparée au code de Sklubot.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 16 |
| PARTIEL | 11 |
| MANQUANT | 7 |
| DIFFÉRENT | 3 |
| Sans objet (conseil d'enregistrement, info éditoriale) | 10 |
| **Total** | **47** |

Lecture rapide : **toute la partie « mettre en place le bot » existe déjà dans Sklubot** (bureau, téléphone, ordinateur du bot, connecteurs, @mention, prise de main pour mots de passe et captchas, clés dans le coffre, accord avant publication). Ce qui manque est **la chaîne « jumeau numérique »** : clone de voix de l'utilisateur, avatar vidéo qui parle, et la boucle « brief → essais → bac des ratés → oui/non sur le téléphone ». Sklubot peut déjà faire faire tout cela **par le navigateur de son bot** sur les sites des fournisseurs (comme le guide le recommande), mais sans connecteurs dédiés ni garde-fous propres au clonage (consentement, étiquette « généré par IA »).

---

## Tableau : chaque étape du guide et l'équivalent Sklubot

### Présentation et prérequis

| # | Étape / fonction du guide | Statut | Équivalent Sklubot (fichier:ligne) | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 1 | Chaîne : voix + avatar, puis autorisations, connecteurs, une vidéo interne | — | Sans objet (sommaire) | — | — |
| 2 | Guide de branchement, mis à jour quand les outils changent | — | Sans objet | — | — |
| 3 | Compte sur le service de bot (offre éligible) | DIFFÉRENT | Sklubot auto-hébergé ou hébergé, bots sur clé, OpenRouter ou abonnement (`web/src/components/AiAccounts.tsx`, `server/src/subscriptionconnect.ts`) | Rien de perdu. | — |
| 4 | Compte chez un fournisseur d'avatars vidéo (création du jumeau et API selon l'offre) | MANQUANT | Aucun connecteur d'avatar vidéo (grep : rien) ; le bot peut utiliser le site par son navigateur | Connecteur API facultatif (clé de l'utilisateur dans le coffre). | M |
| 5 | Compte chez un fournisseur de voix (clone instantané sur petites offres, professionnel sur offres plus hautes) | PARTIEL | Voix des bots par fournisseurs (`server/src/voice/providers.ts`, `fish.ts` : « aucune voix n'est clonée ici ») ; clé ElevenLabs reconnue par le contrôle de santé (`server/src/health.ts:48-49`) | Pas de clone de la voix de l'utilisateur. | M |
| 6 | Tournage : ~2 min, une seule prise 1080p, face caméra, pièce calme | — | Sans objet (conseil) ; pourrait devenir une compétence « préparer un tournage » | — | — |
| 7 | Son : 1-2 min propres (instantané) ou 30 min et plus (professionnel), une voix, sans musique ni écho | — | Sans objet (conseil) | — | — |
| 8 | Appli téléphone (versions minimales d'iOS et d'Android) | PARTIEL | Appli Expo Android (`mobile/`) ; iOS bloqué par un compte Apple (COUVERTURE) | iOS. | L |

### Partie 1 : mettre en place le bot

| # | Étape / fonction du guide | Statut | Équivalent Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 9 | Installer l'appli de bureau (3 systèmes), connexion par le navigateur | FAIT | Appli Relais Electron (`companion/`), publications GitHub (`.github/workflows/desktop.yml`) ; `companion/test` | Mise à jour automatique manquante (COUVERTURE). | — |
| 10 | Installer l'appli téléphone avec le même compte ; bots, conversations, connecteurs et ordinateur synchronisés | FAIT | `mobile/`, même serveur ; `server/test/phone.test.ts` | — | — |
| 11 | Créer un premier bot en décrivant son métier en langage courant (ex. : assistant contenu et opérations, un seul fil, demande avant toute publication en ton nom) | FAIT | Création de bot et recruteur (`server/src/agent/recruit.ts`, `web/src/components/Modals.tsx`) ; `server/test/recruiter.test.ts` | — | — |
| 12 | Trois « où » : il pense chez le fournisseur, agit sur un ordinateur persistant (navigateur, fichiers, terminal), livre dans tes outils par les connecteurs | FAIT | Modèle choisi, ordinateur Linux par bot (`docker/desktop`, `server/src/computer.ts`), connecteurs (`server/src/connectors.ts`) ; `server/test/linux.test.ts` | — | — |
| 13 | Accès facultatif à ton propre ordinateur, sous ta politique d'accord, **accords donnés à distance depuis le téléphone** | FAIT | Relais (`server/src/relay.ts`, `server/src/agent/mycomputer.ts`), cartes d'accord sur mobile ; `server/test/relay.test.ts` | Voir audit nod : liste d'applis refusées d'office à ajouter. | — |
| 14 | Le travail continue sur la machine qui peut le faire, même ordinateur portable fermé | FAIT | Serveur toujours actif, reprise (`server/src/agent/loop.ts:1678-1730`) ; `server/test/engine-queue.test.ts` | — | — |

### Partie 2 : connecteurs

| # | Étape / fonction du guide | Statut | Équivalent Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 15 | Ouvrir la place de marché, ajouter Gmail, Slack, Notion, Drive, Dropbox, autoriser chacun dans le navigateur | FAIT | Catalogue et connexions OAuth (`server/src/catalog.ts`, `server/src/oauth.ts`, `web/src/components/NativeApps.tsx`) ; `server/test/oauth.test.ts`, `apps.test.ts` | — | — |
| 16 | Un connecteur ne fait que ce que le compte permet déjà ; il ne change pas les partages | FAIT | Jetons de l'utilisateur, accords sur les écritures (`server/src/native/tools.ts`) ; `server/test/wave5.test.ts` | — | — |
| 17 | Taper @ dans une tâche pour joindre un connecteur | FAIT | `web/src/components/ComposerMentions.tsx:52-63` (`@[Appli]`) ; pas de test web | @ d'un groupe ou d'une routine : partiel (COUVERTURE). | — |
| 18 | Préférer les connecteurs aux clics sur les sites ; sinon le navigateur de l'ordinateur ; **tu reprends l'écran pour mot de passe, double facteur, captcha**, puis tu rends la main | FAIT | Prise de main avec bail (`web/src/components/ComputerViewer.tsx:172-178`, `server/src/takeover.ts`), bot prévenu au retour (`loop.ts:388,649`) ; codes reçus par e-mail tapés sans que le modèle les voie (COUVERTURE spec 07 A11) | Consigne « connecteur d'abord » à vérifier dans `prompt.ts` (audit nod l. 2). | S |

### Partie 3 : fabriquer le jumeau

| # | Étape / fonction du guide | Statut | Équivalent Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 19 | Boucle : script → voix → avatar → retours → publication | PARTIEL | Studio vidéo (`server/src/videostudio.ts`, `server/src/videoworkflows.ts`, `docs/STUDIO-VIDEO.md`) ; `server/test/studio-workflows.test.ts` | Pas d'étape « avatar parlant ». | M |
| 20 | Choisir les enregistrements les plus propres (un locuteur, bon micro, pas d'écho) | MANQUANT | — | Une vérification automatique de la qualité d'un fichier son (bruit, écho, plusieurs voix) avant envoi au fournisseur serait utile. | M |
| 21 | Clone instantané : 1-2 min du meilleur son ; au-delà de 2-3 min rarement mieux, parfois moins stable | MANQUANT | — | Compétence « cloner ma voix » + carte de choix des extraits. | S |
| 22 | Clone professionnel : au moins 30 min, idéalement 2-3 h, quelques heures d'entraînement ; meilleur pour les accents | MANQUANT | Tâches de fond longues existent (`server/src/agent/bgtasks.ts`) | Suivi d'un entraînement de plusieurs heures chez le fournisseur : faisable par tâche de fond + routine de vérification. | S |
| 23 | Nommer la voix, la tester sur une phrase qui révèle l'accent | PARTIEL | Essai de voix (`web/src/components/VoicePicker.tsx:195`) | Pas pour une voix clonée de l'utilisateur. | S |
| 24 | Régler vitesse, stabilité, style | PARTIEL | Réglages de voix des bots (`web/src/components/BotVoices.tsx`, `server/src/voice/botvoice.ts`) ; `server/test/voice-fish-kokoro.test.ts` | Stabilité / style selon le fournisseur. | S |
| 25 | Chez le fournisseur d'avatars : nouvel avatar → cloner une vraie personne | DIFFÉRENT | Faisable par le navigateur du bot avec prise de main ; pas d'intégration | — | — |
| 26 | Envoyer une prise unique ~2 min, 1080p, sans coupe (toux et mouvements se retrouvent dans le jumeau) | PARTIEL | Envoi de gros fichiers (`server/src/uploadparts.ts`), téléchargement par le bot ; `server/test/large-attachments.test.ts` | Vérification « une seule prise, 1080p, durée » avant envoi. | S |
| 27 | Enregistrer la courte vidéo de **consentement** demandée par le fournisseur (doit être la personne) | MANQUANT | — | Aucun garde-fou Sklubot sur le consentement au clonage (voir 42). | S |
| 28 | Garder la parole dans la vidéo d'entraînement même avec une voix externe (synchronisation des lèvres) | — | Sans objet (conseil) | — | — |
| 29 | Créer chez le fournisseur de voix une clé avec des droits limités (synthèse, voix, génération de voix, modèles, historique, utilisateur) | PARTIEL | Coffre et relais de clés (`server/src/egress.ts`, `VaultSection.tsx`), contrôle de santé ElevenLabs (`server/src/health.ts:48-49`) ; `server/test/connector-errors.test.ts` | Pas d'aide « quels droits donner à la clé ». | S |
| 30 | Chez le fournisseur d'avatars : intégrer une voix tierce, coller la clé | DIFFÉRENT | Opération sur le site du fournisseur ; si le bot la fait, la clé passe par la carte secret (`server/src/pastedsecrets.ts`) | — | — |
| 31 | La voix clonée devient une option de voix du jumeau | — | Sans objet (résultat chez le fournisseur) | — | — |
| 32 | **Clés = secrets** : seulement dans le champ sécurisé du fournisseur ou le coffre, jamais dans le chat, un document ou une capture ; les ajouter soi-même avant, pour que le bot ne les demande jamais dans le chat | FAIT | Carte secret, clés collées détectées et masquées (`server/src/pastedsecrets.ts`, `routes.ts` `/cards/:seq/secret`), masquage (`loop.ts:1734`) ; `server/test/security-fixes.test.ts` | — | — |
| 33 | Donner au bot **un brief détaillé** (accent, sourire, rythme, tenue, fond), ce qu'il faut éviter, et une **comparaison côte à côte** avant tout usage | PARTIEL | Objectifs avec preuve (`server/src/agent/goals.ts`), studio vidéo | Pas de carte de comparaison côte à côte de deux essais. | M |
| 34 | Garder un **bac des ratés** (mauvais accent, sourire, rythme, tenue) pour juger chaque essai contre le précédent | MANQUANT | Versions de pages (`server/src/migrations/017-page-versions.ts`, `web/src/components/PageVersions.tsx`) | Pas de « versions rejetées avec raison » pour les médias. | S |
| 35 | Relire sur le téléphone, retour court, recommencer ; le bot itère, toi tu dis oui ou non | FAIT | Appli mobile, cartes et fils de tâches (`mobile/`, `server/src/agent/bgtasks.ts`) ; `server/test/wave9.test.ts` | — | — |
| 36 | Échec courant : l'image va, mais le son, les lèvres ou le fond ratent (là où beaucoup abandonnent) | PARTIEL | Relecture par un autre bot (`server/src/peerreview.ts`) ; `server/test/security-review.test.ts` | Pas de liste de contrôle « son / lèvres / fond » pour la relecture d'une vidéo. | S |

### Partie 4 : une première vidéo interne

| # | Étape / fonction du guide | Statut | Équivalent Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 37 | Ne pas commencer par la pub ; une vidéo interne qui fait gagner du temps | FAIT | Idées de premières tâches (COUVERTURE spec 07 A19), modèles d'équipe (`server/templates/`) | — | — |
| 38 | Idées : tutoriel d'un outil interne, vidéo d'accueil, visite d'une base de connaissances racontée par le jumeau | PARTIEL | Studio vidéo, explications voxel (`server/src/videostudio.ts`) | Pas de narration par l'avatar de l'utilisateur. | M |
| 39 | Ordre : gain de temps interne, puis explications pour clients, puis contenu qui rapporte | — | Sans objet (conseil) ; pourrait aller dans une compétence | — | — |

### Règles de conduite et fin

| # | Étape / fonction du guide | Statut | Équivalent Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 40 | **Étiqueter** clairement le contenu du jumeau comme généré par IA | PARTIEL | Mention « contenu généré par IA » dans les conditions hébergées (`server/src/hostedpages.ts:128`) | Pas d'étiquette posée automatiquement sur une vidéo ou une voix de synthèse publiée par un bot. | S |
| 41 | Rien ne sort en ton nom sans ton accord : le bot prépare, tu approuves | FAIT | Plancher déterministe (envoi, publication) (`server/src/agent/irreversible.ts:8`, COUVERTURE spec 07 A1) ; `server/test/irreversible-skills-localtools.test.ts` | — | — |
| 42 | **Ne cloner que soi-même**, ou quelqu'un qui a explicitement donné son accord | MANQUANT | — | Règle à ajouter : refus ou carte « consentement de la personne » avant toute création de clone de voix ou d'avatar. | S |
| 43 | Considérer que les données partent chez les fournisseurs ; ne rien y mettre qu'on ne mettrait pas soi-même | FAIT | Page vie privée et avertissements de connecteurs (`server/src/privacy.ts`, `hostedpages.ts`) ; `server/test/privacy.test.ts` | — | — |
| 44 | S'attendre à refaire le jumeau quand les outils progressent | — | Sans objet | — | — |
| 45 | Pas de sponsor ni de lien d'affiliation | — | Sans objet | — | — |
| 46 | Étapes valables à la date du guide ; vérifier l'aide des fournisseurs si les écrans changent | FAIT | Règle Sklubot : citer la doc officielle des fournisseurs (en-têtes de `server/src/voice/fish.ts:7`, `health.ts:48`) | — | — |
| 47 | Questions en commentaire de l'épisode | — | Sans objet | — | — |

---

## Ce qui serait utile à Sklubot (classé)

1. **Garde-fou de clonage** : avant de créer un clone de voix ou d'avatar, carte « c'est ta voix / ton visage, ou la personne a donné son accord écrit ? » ; refus sinon. Étiquette « généré par IA » proposée sur tout média de synthèse publié. S.
2. **Compétence « jumeau numérique »** dans la bibliothèque (nos mots) : conseils d'enregistrement (lignes 6-7, 20-28), boucle brief → essais → bac des ratés → oui/non, ordre « interne d'abord ». S.
3. **Bac des ratés / comparaison côte à côte** pour les médias produits (vidéos, voix, images) : garder les versions rejetées avec leur raison, afficher deux essais côte à côte sur le téléphone. M.
4. **Connecteurs API facultatifs** voix clonée et avatar parlant, avec la clé de l'utilisateur dans le coffre et l'aide « quels droits donner à la clé ». M.
5. **Contrôle qualité d'un fichier son** (une voix, bruit, écho, durée) avant envoi à un fournisseur. M.
6. Consigne « connecteur d'abord, navigateur ensuite » (déjà proposée dans l'audit nod). S.

## Non vérifié

- La version « mobilebasic » peut omettre des images ou des encadrés du document original.
- Aucun essai réel chez les fournisseurs de voix et d'avatars ; aucun test Sklubot relancé.
