# Publier Sklubot sur les boutiques

Ce document prépare la fiche Google Play (puis App Store) de la variante **store** (`fr.sklubot.app`, sans contrôle du
téléphone). La variante **complet** (`fr.sklubot.app.complet`) ne va pas sur les boutiques : elle s’installe depuis un
fichier APK (le service d’accessibilité utilisé pour piloter le téléphone est soumis à des règles Google Play strictes).

Fichiers à envoyer : `dist/sklubot-store-1.0.0.aab` (Play), icône `store/icon-512.png`, captures `store/*.png`.

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
> • Répondre aux questions de tes bots, suivre leurs tâches et leurs tâches de fond.
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
| Localisation, contacts, agenda, audio, santé, finance, historique web | **Non collectés.** |
| Données éphémères ? | Non (les messages sont gardés sur le serveur de l’utilisateur jusqu’à suppression). |

Remarque à mettre dans la fiche : « Les données sont envoyées au serveur Sklubot dont l’utilisateur saisit l’adresse et
qu’il (ou son organisation) gère. »

**Permissions déclarées par la variante store** (vérifiées avec `aapt2`, voir README) : Internet, notifications
(`POST_NOTIFICATIONS`), vibreur, démarrage du téléphone et état réseau (pour la vérification en arrière-plan,
WorkManager), appareil photo (prise de photo pour une pièce jointe, demandée au moment voulu). Pas d’accès au micro, à la
localisation, aux contacts ; **pas de service d’accessibilité**, **pas de service de premier plan**.

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
