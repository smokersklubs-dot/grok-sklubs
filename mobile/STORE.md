# Publier Sklubot sur les boutiques

Ce document prépare la fiche Google Play (puis App Store) de la variante **store** (`fr.sklubot.app`, sans contrôle du
téléphone). La variante **complet** (`fr.sklubot.app.complet`) ne va pas sur les boutiques : elle s’installe depuis un
fichier APK (le service d’accessibilité utilisé pour piloter le téléphone est soumis à des règles Google Play strictes).

Fichiers à envoyer : `dist/sklubot-store-1.1.0.aab` (version 1.1.0, versionCode 2) (Play), icône `store/icon-512.png`, captures `store/*.png`.

## Fiche Google Play

**Nom de l’appli (30 car. max)** : `Sklubot – ton équipe de bots IA` (30)

**Description courte (80 car. max)** :
`Discute avec tes bots IA hébergés chez toi : réponses en direct, tâches, fichiers.` (80)

**Description complète** :

> Sklubot, c’est ta propre équipe de bots IA — chacun avec sa mémoire, ses compétences, ses routines et son ordinateur —
> qui tourne sur **ton** serveur. Cette appli est le client mobile de ton serveur Sklubot.
>
> **Ce que tu peux faire**
> • Voir tous tes bots et salons, avec leurs messages non lus et ce qu’ils sont en train de faire.
> • Discuter avec un bot et suivre sa réponse en direct, étape par étape (recherche, lecture, commande…).
> • Joindre une photo, une image prise avec l’appareil photo ou un fichier.
> • Autoriser ou refuser une action en un geste quand un bot te demande la permission (une fois, toujours, ou non).
> • Répondre aux questions de tes bots, leur donner une clé d’API en toute sécurité (elle va directement dans le coffre
>   de ton serveur), connecter une appli, suivre leurs tâches et leurs tâches de fond.
> • Appeler un bot et lui parler à voix haute, même écran verrouillé.
> • Regarder l’écran de l’ordinateur d’un bot et prendre la main quand il a besoin de toi (CAPTCHA, code…).
> • Parcourir la bibliothèque de chaque bot (rapports, notes, images) et partager un fichier.
> • Recevoir une notification quand un bot t’attend ou a fini de répondre.
> • Thème clair ou sombre, en français ou en anglais.
>
> **Tes données restent chez toi**
> L’appli ne parle qu’au serveur dont tu saisis l’adresse. Pas de publicité, pas de mesure d’audience, pas de traceur.
> Ta session est gardée chiffrée sur le téléphone.
>
> **Il te faut un serveur Sklubot**
> Sklubot est un logiciel libre que tu installes sur ton serveur (ou celui de ton organisation). Les réglages avancés
> (applis connectées, coffre, routines, consommation) se font sur le site web de ton serveur.

**Catégorie** : Productivité. **Tags** : assistant, productivité, IA.
**Coordonnées** : une adresse e-mail de contact (obligatoire, à choisir par l’utilisateur), site web : l’adresse du serveur.
**Règles de confidentialité (URL)** : `https://sklubot.sklubs.fr/confidentialite` (servie par le serveur, en anglais :
`/privacy`). Elle décrit exactement ce que fait l’appli.

### Classification du contenu (questionnaire IARC)

Catégorie « Utilitaire / productivité / communication ». Réponses : pas de violence, pas de contenu sexuel, pas de
langage grossier fourni par l’appli, pas de substances, pas de jeux d’argent. **Contenu généré par l’utilisateur /
interaction** : l’appli affiche des textes produits par des modèles d’IA configurés sur le serveur de l’utilisateur ; il
n’y a pas d’échange entre utilisateurs inconnus (pas de réseau social). Attendu : PEGI 3 / Tout public, éventuellement
« 12+ » selon les réponses sur le contenu généré par l’IA. Public cible : 18 ans et plus (pas destiné aux enfants).

### Sécurité des données (Data safety) — conforme au code

| Question | Réponse |
|---|---|
| L’appli collecte ou partage-t-elle des données ? | **Oui, collecte** (envoyées au serveur choisi par l’utilisateur). **Aucun partage** avec des tiers. |
| Données chiffrées en transit ? | Oui (HTTPS ; le http n’est accepté que pour un serveur local de développement). |
| L’utilisateur peut-il demander la suppression ? | Oui : dans l’appli (Réglages → Supprimer mon compte) et sur le site (Réglages → Compte). |
| Informations personnelles | **Adresse e-mail**, **Nom** — collectées, obligatoires (e-mail) / facultatif (nom), finalité : *gestion du compte*. |
| Messages | **Autres messages dans l’appli** (messages aux bots) — collectés, obligatoires, finalité : *fonctionnalités de l’appli*. |
| Photos et vidéos | Collectées **seulement si l’utilisateur en joint** — facultatif, finalité : *fonctionnalités de l’appli*. |
| Fichiers et documents | Idem, seulement les pièces jointes choisies — facultatif. |
| Identifiants de l’appli / appareil | Non (aucun identifiant publicitaire, pas d’identifiant d’appareil envoyé). |
| Audio (enregistrements vocaux) | **Collecté seulement pendant un appel vocal** lancé par l’utilisateur — facultatif, finalité : *fonctionnalités de l’appli*. Avec les services vocaux du serveur, le son du micro est envoyé au serveur de l’utilisateur (transcrit puis jeté, seul le texte de l’appel est gardé) ; sinon la reconnaissance vocale du téléphone le transcrit et seul le texte part au serveur. Chiffré en transit, non partagé. |
| Position (localisation précise) | **Collectée seulement quand l'utilisateur touche « Partager ma position »** sur une demande d'un de ses bots (L177) : la position est lue par la page du navigateur du téléphone (le système redemande l'autorisation), envoyée une fois au serveur de l'utilisateur. Facultatif, finalité : *fonctionnalités de l'appli*. Jamais en arrière-plan. |
| Contacts, agenda, santé, finance, historique web | **Non collectés.** |
| Données éphémères ? | Non (les messages sont gardés sur le serveur de l’utilisateur jusqu’à suppression). |

Remarque à mettre dans la fiche : « Les données sont envoyées au serveur Sklubot dont l’utilisateur saisit l’adresse et
qu’il (ou son organisation) gère. »

**Permissions déclarées par la variante store** (vérifiées avec `aapt2`, voir README) : Internet, notifications
(`POST_NOTIFICATIONS`), vibreur, démarrage du téléphone et état réseau (pour la vérification en arrière-plan,
WorkManager), appareil photo (prise de photo pour une pièce jointe, demandée au moment voulu), **micro**
(`RECORD_AUDIO`, demandé au premier appel vocal) avec `MODIFY_AUDIO_SETTINGS` (haut-parleur / écouteur) et un **service
de premier plan de type « microphone »** (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`) qui ne tourne que
pendant un appel. Pas d’accès direct à la localisation (la position, seulement sur demande, passe par une page du navigateur) ni aux contacts ; **pas de service d’accessibilité**, **pas de service
« special use »**, pas de connexion permanente.

### Nouveauté 1.1.0 : déclaration du service de premier plan (Play Console)

Depuis la 1.1.0 la variante store déclare un service de premier plan de type **microphone** (appel vocal qui continue
écran verrouillé). Google Play demande, pour toute appli ciblant Android 14+ qui en déclare un : Play Console → Règles et
programmes → Contenu de l’appli → **Services de premier plan** → cocher « Microphone » et décrire l’usage, par exemple :
« Pendant un appel vocal que l’utilisateur lance avec un de ses bots, le service garde le micro et le son actifs quand
l’écran est verrouillé ou que l’utilisateur change d’appli. Il s’arrête dès qu’il raccroche (bouton dans l’appli ou dans
la notification). » Joindre une **courte vidéo** (lien YouTube non répertorié ou Drive) montrant : lancer un appel, verrouiller
l’écran, la notification « Appel avec … » et Raccrocher. Mettre aussi à jour la **Sécurité des données** (ligne Audio
ci-dessus) et la page de confidentialité du serveur (`/confidentialite`), qui doit mentionner les appels vocaux.
Si Play refusait ce type de service, retirer `CallService` de la variante store limiterait les appels à l’appli ouverte.

**Accès pour l’examen Google** : Play demande des identifiants de test si l’appli nécessite une connexion. Fournir dans
la Play Console (Contenu de l’appli → Accès aux applis) : l’adresse d’un serveur de démonstration accessible en https,
un compte de test (e-mail + mot de passe) et une phrase d’explication (« Saisir l’adresse du serveur, puis se connecter »).
Un serveur avec `DEMO_MODE=1` répond sans clé d’IA.

## Captures d’écran (prises sur l’émulateur Android 14, recadrées en 1080 × 2160)

Google Play : 2 à 8 captures téléphone, côté long au plus le double du côté court (d’où le recadrage 1080 × 2160 ; les
captures brutes de l’émulateur font 1080 × 2340). Dans `store/` :

1. `00-signin.png` — création de compte / connexion
2. `01-bots.png` — la liste des bots et des salons
3. `02-chat.png` — une discussion (réponse en Markdown, en direct)
4. `04-details.png` — détails d’un bot (Activité : routines, ordinateur)
5. `05-tasks.png` — les tâches
6. `06-settings.png` — les réglages
7. `07-dark.png` — le thème sombre

À ajouter avant la publication : **une carte d’autorisation** prise sur un vrai serveur (par exemple un e-mail à envoyer
via une appli connectée), car le serveur de démonstration local n’en produit que pour le contrôle du téléphone.
`store/complet/` contient les captures du **contrôle du téléphone** (code d’appairage, consentement sur le téléphone,
carte d’autorisation, bannière rouge avec Stop) : elles concernent uniquement la version complète et **ne doivent pas**
être utilisées sur la fiche Play (la version store n’a pas cette fonction). Les textes des démos sont ceux du mode démo
du serveur ; pour la fiche, refaire les captures avec de vraies conversations est préférable.

## Image de présentation (feature graphic)

**1024 × 500 px**, JPG ou PNG 24 bits, sans transparence. Proposition : fond `#f4f2ee`, à gauche le logo (carré orange
`#e2552d`, « S » blanc) et « Sklubot » en gras `#1e2024`, sous-titre « Ton équipe de bots IA, sur ton serveur » ; à droite
trois personnages de bots (formes et couleurs de l’appli) ou une capture de discussion inclinée. Garder le texte important
dans la zone centrale (Play peut rogner les bords). À produire avec l’outil graphique de ton choix.

## Publier sur Google Play — étapes exactes

1. **Créer le compte développeur** : https://play.google.com/console/signup — compte Google, frais uniques de 25 $,
   vérification d’identité (pièce d’identité ; pour une organisation, numéro D-U-N-S). Les **comptes personnels récents**
   doivent faire un **test fermé avec au moins 12 testeurs pendant 14 jours** avant de pouvoir publier en production.
2. **Créer l’appli** : Play Console → « Créer une application » → nom « Sklubot », langue par défaut français, type
   « Application », gratuite ; accepter les déclarations.
3. **Play App Signing** : au premier envoi, garder l’option par défaut (Google génère et garde la clé de signature de
   l’appli) ; l’AAB que tu envoies est signé avec `sklubot-release.jks`, qui devient la **clé d’importation**.
4. **Configurer la fiche** (Présence sur le Play Store → Fiche principale) : textes ci-dessus, icône `store/icon-512.png`,
   image de présentation 1024×500, captures `store/*.png`.
5. **Contenu de l’appli** (menu « Règles et programmes ») : règles de confidentialité (URL), accès aux applis (compte de
   test), annonces : « Non », classification du contenu (questionnaire), public cible (18+), sécurité des données
   (tableau ci-dessus), applis gouvernementales : non, fonctionnalités financières : non, santé : non.
6. **Test interne d’abord** : Tests → Tests internes → Créer une version → importer `dist/sklubot-store-1.0.0.aab` →
   notes de version (« Première version ») → enregistrer → examiner → déployer. Ajouter ta propre adresse Gmail comme
   testeur, ouvrir le lien d’inscription sur le téléphone et installer depuis Play. Vérifier : connexion, discussion,
   notifications.
7. **Test fermé** (obligatoire pour un compte personnel récent) : Tests → Test fermé → créer une piste, ajouter au moins
   12 testeurs (liste d’e-mails ou groupe Google), publier la même version, attendre 14 jours d’utilisation.
8. **Production** : Production → Créer une version → reprendre l’AAB testé → « Envoyer pour examen ». L’examen prend de
   quelques heures à quelques jours.
9. **Mises à jour** : augmenter `VERSION_CODE` (et `VERSION`) dans `app.config.ts`, reconstruire la variante store,
   importer le nouvel AAB dans une nouvelle version.

## iPhone plus tard (App Store)

- **Compte Apple Developer** (99 $/an) : https://developer.apple.com/programs/ — identité vérifiée ; pour une
  organisation, D-U-N-S.
- **Build sans Mac** avec le service de build d’Expo (gratuit avec limites) : `npx eas-cli@latest login` (compte Expo
  gratuit), `npx eas-cli build:configure`, puis `SKLUBOT_VARIANT=store npx eas-cli build -p ios --profile production`.
  Le service crée les certificats et profils Apple avec ton compte. Envoi : `npx eas-cli submit -p ios` (vers App Store
  Connect / TestFlight). Avec un Mac : `npx expo run:ios --configuration Release` puis Xcode → Archive.
- **Ce qui change** : `ios.bundleIdentifier` = `fr.sklubot.app` (déjà dans `app.config.ts`) ; textes d’autorisation
  photos/appareil photo déjà fournis (plugin expo-image-picker) ; pas de relais (Android seulement, iOS ne le permet
  pas) ; la vérification en arrière-plan utilise BGTaskScheduler (iOS décide de la fréquence) ; le vrai push demande une
  clé APNs (voir README, section Notifications) ; fiche App Store Connect : mêmes textes, « Confidentialité de l’app »
  avec les mêmes réponses que la sécurité des données Play ; captures 6,9" (1320 × 2868) et 6,5" ; compte de démonstration
  pour l’examen Apple (règle 2.1) ; la suppression de compte dans l’appli est exigée (règle 5.1.1(v)) — c’est fait.
- TestFlight pour les testeurs avant la publication.

## Contrôle avant envoi (`npm run store:check`)

Avant chaque envoi (Play ou App Store), dans `mobile/` : `npm run store:check`. Le script (`scripts/store-check.mjs`, sans
réseau ni compte) vérifie et écrit une ligne OK / ATTENTION / ÉCHEC par point ; il s'arrête en erreur s'il y a un ÉCHEC :

- **versions** : `VERSION` et `VERSION_CODE` de `app.config.ts`, `ios.buildNumber` et `android.versionCode` qui les
  suivent, ce document qui cite le même fichier `.aab` et le même versionCode, le projet Android généré à jour ;
- **icônes et images** : `assets/icon.png` 1024 × 1024 **sans aucun pixel transparent** (exigé par l'App Store), couches
  de l'icône adaptative 1024 × 1024, `store/icon-512.png` 512 × 512, 2 à 8 captures aux bonnes proportions ;
- **textes des permissions** (photos, appareil photo, micro) présents et qui disent pourquoi (règle Apple 5.1.1) ;
- **manifeste de confidentialité iOS** (voir ci-dessous) : à jour, sans pistage, et qui couvre toutes les « API à raison
  obligatoire » déclarées par les bibliothèques installées ;
- **aucune clé** (clé d'API, jeton, clé privée) dans le code de l'appli, et aucun fichier de signature dans `assets/` ;
  `npm run store:check -- --bundle <fichier.js>` cherche aussi dans un bundle exporté (`npx expo export`) ;
- **« Signaler cette réponse »** toujours branché dans la discussion, avec ses textes en français et en anglais.

## iPhone : manifeste de confidentialité (`PrivacyInfo.xcprivacy`)

Apple exige un manifeste qui déclare les données collectées et la raison de chaque « API à raison obligatoire »
(https://developer.apple.com/documentation/bundleresources/privacy-manifest-files et
https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api). Source unique :
`store/privacy-manifest.json`, donnée à Expo par `ios.privacyManifests` dans `app.config.ts` (Expo l'écrit dans
`PrivacyInfo.xcprivacy` à la génération du projet iOS : https://docs.expo.dev/guides/apple-privacy/) ; la même chose au
format Apple est dans `store/PrivacyInfo.xcprivacy` (réécrite par `npm run store:check -- --write`).

- **Pistage** : non (`NSPrivacyTracking` = false, aucun domaine de pistage).
- **Données collectées** (toutes liées au compte, jamais pour du pistage, finalité « fonctionnalités de l'appli ») :
  adresse e-mail, nom, autres contenus de l'utilisateur (messages aux bots), photos ou vidéos (seulement les pièces
  jointes choisies), position précise (seulement « Partager ma position », L177). Pas d'audio sur iPhone : les appels
  vocaux n'y existent pas encore (`src/voice/call.ts`, Android seulement) ; les ajouter le jour où ils arrivent.
- **API à raison obligatoire** : reprises des manifestes des bibliothèques installées (React Native, expo-constants,
  expo-file-system, expo-application, expo-localization, expo-notifications, expo-system-ui, expo-task-manager), car Apple
  ne lit pas toujours ceux des bibliothèques statiques (note d'Expo) — `UserDefaults` CA92.1, `FileTimestamp` C617.1 /
  0A2A.1 / 3B52.1, `DiskSpace` E174.1 / 85F4.1, `SystemBootTime` 35F9.1. Le contrôle échoue si une mise à jour d'une
  bibliothèque en ajoute une nouvelle.
- **Point à régler avant l'envoi iOS** (signalé « ATTENTION » par le contrôle) : le texte du micro parle d'appels vocaux,
  absents sur iPhone. Soit écrire un texte vrai sur les deux systèmes, soit retirer la permission micro de la
  construction iOS.

## Confidentialité de l'app (App Store Connect)

Mêmes réponses que le manifeste : **Données utilisées pour vous suivre : aucune.** Données liées à vous : Coordonnées
(adresse e-mail, nom), Contenu utilisateur (photos ou vidéos, autre contenu), Localisation (précise). Pour chacune :
finalité « Fonctionnalités de l'app », pas de pistage. Pas d'identifiants, pas de diagnostics, pas de données d'usage
(aucune mesure d'audience). Ajouter « Contenu audio » le jour où les appels vocaux arrivent sur iPhone.

## Classification par âge (App Store)

Questionnaire d'App Store Connect (App Information → Age Ratings → Set Up Age Ratings ; catégories et définitions :
https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/).
Réponses proposées, à relire au moment de l'envoi :

| Section | Question | Réponse |
|---|---|---|
| Contrôles dans l'appli | Contrôle parental | Non |
| Contrôles dans l'appli | Vérification de l'âge | Non |
| Capacités | Accès web sans restriction | **Non** : l'appli n'ouvre dans son navigateur intégré que le serveur de l'utilisateur et les pages de connexion d'une appli à relier ; les liens des messages s'ouvrent dans Safari |
| Capacités | Contenu généré par les utilisateurs | **Non** : rien n'est diffusé à d'autres personnes ; chacun ne voit que ses bots et ses salons |
| Capacités | Réseaux sociaux | Non |
| Capacités | Messagerie et discussion | **Oui** : on discute avec ses bots et, dans un salon partagé de son organisation, avec ses collègues |
| Capacités | Position partagée | **Non** au sens d'Apple (pas de position partagée avec d'autres personnes) ; la position envoyée une fois à son propre serveur est déclarée dans la confidentialité |
| Capacités | Publicité | Non |
| Thèmes pour adultes | Grossièretés, horreur, alcool / tabac / drogues, rencontres et relations | Aucun (l'appli n'en fournit pas ; les réponses des modèles d'IA suivent les règles du serveur) |
| Médical ou bien-être | Informations médicales, santé et bien-être | Aucun |
| Sexualité ou nudité | Toutes | Aucun |
| Violence | Toutes | Aucune |
| Jeux de hasard | Jeux d'argent, simulés, concours, coffres à butin | Non / Aucun |

Résultat attendu : **4+** calculé par Apple. Comme la fiche Play (public cible 18+) et parce que des modèles d'IA
répondent librement, choisir **« Override to Higher Age Rating » → 18+** (ou au moins 13+) ; « Made for Kids » : non.
La règle Apple 1.2 (contenu généré) est couverte par « Signaler cette réponse » sur chaque réponse d'un bot.
