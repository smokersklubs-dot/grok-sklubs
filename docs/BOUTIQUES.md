# Mettre Sklubot sur l'App Store et Google Play

Ce guide explique, étape par étape et sans Mac, comment envoyer l'appli mobile Sklubot (dossier `mobile/`) sur les deux
boutiques. Tout ce qui peut être préparé à l'avance l'est déjà : il ne reste que ce qui demande **tes** comptes.

Ce qui est prêt dans le dépôt :

| Quoi | Où |
|---|---|
| Profils de construction et d'envoi (`preview`, `production`) | `mobile/eas.json` |
| Réglages de l'appli (noms, icônes, permissions, confidentialité) | `mobile/app.config.ts` |
| Textes de la fiche en 7 langues (fr, en, es, de, it, pt-BR, zh-Hans) | `mobile/store/listing.json` |
| Captures aux tailles des boutiques, 7 langues | `mobile/store/shots/<langue>/iphone-6.9/` et `…/android-phone/` |
| Réponses « confidentialité » (Apple) et « sécurité des données » (Google) | [`mobile/STORE.md`](../mobile/STORE.md#sécurité-des-données-data-safety--conforme-au-code) et [plus bas](#confidentialité--ce-que-lappli-collecte) |
| Contrôle avant envoi | `cd mobile && npm run store:check` |
| Veille des règles des boutiques | `cd mobile && npm run store:rules` |

## Ce qu'il te faut (à créer une seule fois)

1. **Un compte Expo** (gratuit) : <https://expo.dev/signup>. Expo construit l'appli iPhone sur ses Mac à ta place.
2. **Un compte Apple Developer** (99 $ par an) : <https://developer.apple.com/programs/enroll/>. Apple vérifie ton
   identité ; pour une entreprise, il faut un numéro D-U-N-S. Compte quelques jours.
3. **Un compte Google Play Console** (25 $, une fois) : <https://play.google.com/console/signup>. Google vérifie ton
   identité. Un compte **personnel** récent doit faire un **test fermé avec au moins 12 testeurs pendant 14 jours** avant
   de pouvoir publier pour tout le monde (voir [`mobile/STORE.md`](../mobile/STORE.md#publier-sur-google-play--étapes-exactes)).
4. **Node.js 22** sur ton ordinateur (Windows, Mac ou Linux) : <https://nodejs.org>.

Rien de ces comptes ne va dans le dépôt : ni identifiant, ni mot de passe, ni clé. Expo les demande et les garde.

## Les identifiants de l'appli

L'appli s'appelle `fr.sklubot.app` sur les deux boutiques. Si ce nom est déjà pris, ou si tu veux le tien, choisis-en un
autre au moment de créer l'appli chez Apple et chez Google, puis donne-le avant chaque commande :

| Variable | Pour quoi | Par défaut |
|---|---|---|
| `SKLUBOT_IOS_BUNDLE_ID` | Identifiant iPhone (Bundle ID) | `fr.sklubot.app` |
| `SKLUBOT_ANDROID_PACKAGE` | Identifiant Android (nom du paquet) | `fr.sklubot.app` |
| `SKLUBOT_EAS_PROJECT_ID` | Le numéro du projet Expo (affiché par `eas init`) | aucun |
| `SKLUBOT_EXPO_OWNER` | Ton nom de compte Expo (seulement pour un compte d'équipe) | ton compte |
| `SKLUBOT_APPLE_TEAM_ID` | Ton « Team ID » Apple (seulement pour la Live Activity, plus bas) | aucun |

Dans un terminal : `export SKLUBOT_EAS_PROJECT_ID=…` (Mac, Linux) ou `set SKLUBOT_EAS_PROJECT_ID=…` (Windows). Pour que
les serveurs d'Expo les connaissent aussi, ajoute-les sur expo.dev : ton projet → **Environment variables** → **Add**,
environnement « production » (et « preview »), visibilité « Plain text »
(<https://docs.expo.dev/eas/environment-variables/>). Expo donne lui-même le numéro de projet à ses serveurs.

## Étape 1 — se connecter à Expo

Dans le dossier `mobile/` :

```
npm install
npx eas-cli@latest login
npx eas-cli@latest init
```

`login` demande ton e-mail et ton mot de passe Expo. `init` crée le projet chez Expo et affiche son numéro : garde-le
dans `SKLUBOT_EAS_PROJECT_ID` (voir au-dessus). Commandes : <https://docs.expo.dev/build/setup/>.

## Étape 2 — vérifier avant d'envoyer

```
npm run store:check
```

Chaque ligne dit OK, ATTENTION ou ÉCHEC. Il ne doit rester **aucun ÉCHEC**. Le script contrôle les versions, les icônes,
les textes des permissions, le manifeste de confidentialité, l'absence de clés, les textes de la fiche dans les 7
langues (longueurs maximales d'Apple et de Google), les captures, `eas.json` et la Live Activity.

## Étape 3 — construire

Expo construit sur ses machines (pas besoin de Mac) :

```
npx eas-cli@latest build --platform android --profile production
npx eas-cli@latest build --platform ios --profile production
```

- **Android** : le profil `production` fait un fichier **.aab** pour Google Play (variante « store », sans le contrôle du
  téléphone). Si tu as déjà envoyé une version signée avec `sklubot-release.jks`, donne cette clé à Expo **avant** la
  première construction : écris un fichier `mobile/credentials.json` (il est ignoré par git, ne le partage jamais) qui
  pointe vers ta clé et ses mots de passe, comme dans <https://docs.expo.dev/app-signing/local-credentials/#credentialsjson>,
  puis `npx eas-cli@latest credentials` → Android → « Update credentials on Expo servers with values from
  credentials.json » (<https://docs.expo.dev/app-signing/existing-credentials/>), puis efface `credentials.json`. Sans
  cela, Expo crée une clé neuve (c'est bien pour une toute première publication).
- **iPhone** : Expo demande de te connecter à ton compte Apple, puis crée seul les certificats et le profil.
- Le profil `preview` fait une version d'essai à installer directement (APK Android, ou iPhone enregistré chez Apple) :
  `--profile preview`.
- Une construction prend 15 à 40 minutes. Le lien s'affiche à la fin, et sur expo.dev.

Les profils sont décrits dans la documentation d'Expo : <https://docs.expo.dev/eas/json/>.

## Étape 4 — envoyer aux boutiques

```
npx eas-cli@latest submit --platform android --profile production
npx eas-cli@latest submit --platform ios --profile production
```

- **Google Play** : Expo a besoin d'une « clé de compte de service » Google. La créer une fois en suivant
  <https://expo.fyi/creating-google-service-account>, puis la donner à Expo (expo.dev → ton projet → Credentials → Android
  → « Google service account key for Expo Submit »). L'appli arrive sur la piste **test interne**, en brouillon : tu la
  publies toi-même depuis la Play Console (<https://docs.expo.dev/submit/android/>).
- **App Store** : Expo demande ton identifiant Apple la première fois et crée la fiche dans App Store Connect si elle
  n'existe pas. La version arrive dans **TestFlight** après 10 à 15 minutes de traitement
  (<https://docs.expo.dev/submit/ios/>).

## Étape 5 — remplir les fiches et demander l'examen

### Google Play Console

1. **Présence sur le Play Store → Fiche principale** : nom, description courte et description complète copiées de
   `mobile/store/listing.json` (champs `name`, `shortDescription`, `description`) ; ajoute chaque langue avec
   « Gérer les traductions ». Icône `mobile/store/icon-512.png`, captures `mobile/store/shots/<langue>/android-phone/`.
2. **Règles et programmes → Contenu de l'appli** : règles de confidentialité, accès pour l'examen (un compte de démo),
   annonces « Non », questionnaire de classification, public cible 18+, **sécurité des données** (réponses dans
   [`mobile/STORE.md`](../mobile/STORE.md#sécurité-des-données-data-safety--conforme-au-code)), services de premier
   plan (micro, pour les appels).
3. **Tests → Test fermé** (compte personnel récent : 12 testeurs, 14 jours), puis **Production → Créer une version →
   Envoyer pour examen**.

### App Store Connect

1. **Informations sur l'app** : nom (`name`), sous-titre (`subtitle`), catégorie Productivité, URL de confidentialité.
2. **Version** : texte promotionnel (`promotionalText`), description, mots-clés (`keywords`), nouveautés
   (`releaseNotes`), captures `mobile/store/shots/<langue>/iphone-6.9/` (1320 × 2868, le format 6,9 pouces ; Apple réduit
   lui-même pour les petits iPhone). Une langue = « + » à côté de la langue principale.
3. **Confidentialité de l'app** : réponses dans [`mobile/STORE.md`](../mobile/STORE.md#confidentialité-de-lapp-app-store-connect).
4. **Classification par âge** : réponses dans [`mobile/STORE.md`](../mobile/STORE.md#classification-par-âge-app-store).
5. **Informations pour l'examen** : adresse d'un serveur de démonstration, un compte de test et une phrase « Saisir
   l'adresse du serveur, puis se connecter ». Pendant l'examen, garder un œil sur ce serveur :
   `npm run demo:watch -- https://ton-serveur --every 5`.
6. Choisir la version TestFlight → **Ajouter pour vérification** → **Envoyer à l'App Review**.

### Combien de temps

- **Google Play** : en général de quelques heures à quelques jours ; un premier envoi ou un compte récent peut prendre
  une semaine ou plus.
- **Apple** : en général un à deux jours ; un refus arrive avec un message, on corrige et on renvoie.

Les comptes eux-mêmes : vérification Apple de 1 jour à 2 semaines, Google de quelques jours.

## Les captures

`npm run store:shots` refait les 70 captures (5 écrans × 7 langues × iPhone et Android) à partir des vraies captures de
l'appli dans `mobile/store/` (01-bots, 02-chat, 04-details, 05-tasks, 07-dark), avec la légende traduite au-dessus. Il
utilise Chromium (Playwright, déjà installé pour le site web).

Limites à connaître :
- l'appli elle-même est en français sur les captures (seule la légende change de langue) ;
- les écrans viennent de la version Android : avant l'envoi iPhone, refaire les captures sur un iPhone (version
  TestFlight) est plus sûr — Apple demande que les captures montrent l'appli telle qu'elle est (règle 2.3.3) ;
- les conversations sont celles du mode démo : de vraies conversations sont plus parlantes ;
- l'appli est en mode téléphone seulement (`supportsTablet: false`) : pas de captures iPad à fournir. Pour une vraie
  version iPad, remettre `true` et ajouter des captures 13 pouces (2064 × 2752).

## Confidentialité : ce que l'appli collecte

Les réponses complètes (Apple et Google) sont dans [`mobile/STORE.md`](../mobile/STORE.md#sécurité-des-données-data-safety--conforme-au-code),
écrites d'après le code : e-mail et nom (compte), messages aux bots, photos et fichiers seulement si tu les joins, son
seulement pendant un appel (Android), position seulement quand tu touches « Partager ma position ». Pas de publicité, pas
de mesure d'audience, pas de pistage, rien n'est partagé avec des tiers : tout va au serveur dont tu as tapé l'adresse.

Live Activity (si tu l'allumes, plus bas) : l'iPhone donne au serveur un jeton de notification **propre à chaque Live
Activity** ; il ne sert qu'à mettre à jour cette Live Activity, il est effacé quand elle se termine, et il n'est pas un
identifiant de l'appareil. Rien à ajouter aux étiquettes de confidentialité ; le mentionner dans la page de
confidentialité du serveur.

## Veille des règles des boutiques

```
npm run store:rules
```

Le script lit seulement la date de dernière mise à jour des règles officielles : les « App Review Guidelines » d'Apple
(<https://developer.apple.com/app-store/review/guidelines/>, ligne « Last Updated ») et le centre des règles Google Play
(<https://play.google/developer-content-policy/>, bandeau « We're updating our policies »). Il la compare à
`mobile/store/rules-watch.json`. Si une date a changé, il le dit et s'arrête avec le code 2 : lis les changements, adapte
si besoin, puis `npm run store:rules -- --save` enregistre la nouvelle date. Code 1 : une page n'a pas pu être lue ou a
changé de forme ; regarde à la main. Le lancer une fois par semaine (tâche planifiée) suffit.

## Live Activity sur iPhone (éteinte par défaut)

Une **Live Activity** affiche sur l'écran verrouillé et dans la Dynamic Island la tâche en cours d'un bot : son nom,
l'étape, le temps écoulé et un bouton **Arrêter** (qui ouvre l'appli et demande confirmation avant d'arrêter).

**Attention : jamais essayée sur un vrai iPhone** (il faut un compte Apple et un Mac ou une construction Expo). Le code
suit la documentation d'Apple et d'Expo ; les parties TypeScript et serveur sont testées, la partie iPhone (Swift) n'a
pas pu être compilée ici. À essayer d'abord avec une version `preview` ou TestFlight.

Pour l'allumer :

1. Dans `mobile/` : `npx expo install @bacons/apple-targets@5.0.0` (module de Evan Bacon, licence MIT,
   <https://github.com/EvanBacon/expo-apple-targets> ; il ajoute le petit programme « widget » qui dessine la Live
   Activity, dans `mobile/targets/sklubot-live`).
2. Ajouter `SKLUBOT_LIVE_ACTIVITY=1` et `SKLUBOT_APPLE_TEAM_ID` (ton Team ID, sur
   <https://developer.apple.com/account> → Membership) aux variables d'environnement Expo (voir plus haut), puis
   reconstruire l'iPhone. Le profil `production` met la bonne valeur de notifications (`SKLUBOT_APS_ENV`).
3. Côté **serveur** : créer une clé APNs chez Apple (Certificates, Identifiers & Profiles → **Keys** → « + » → cocher
   « Apple Push Notifications service (APNs) » → télécharger le fichier `.p8`, une seule fois). Puis dans le `.env` du
   serveur :

   | Variable | Valeur |
   |---|---|
   | `LIVE_ACTIVITY_PUSH` | `1` (sans elle : éteint) |
   | `APNS_KEY_FILE` | chemin du fichier `.p8` sur le serveur (le garder hors du dépôt, lisible par le serveur seulement) |
   | `APNS_KEY_ID` | l'identifiant de la clé (10 caractères) |
   | `APNS_TEAM_ID` | ton Team ID (10 caractères) |
   | `APNS_BUNDLE_ID` | l'identifiant iPhone de l'appli (`fr.sklubot.app` ou le tien) |
   | `APNS_SANDBOX` | `1` seulement pour une version de développement |

4. Redémarrer le serveur. Sur l'iPhone : Réglages → Sklubot → **Activités en direct** doit être autorisé.

Comment ça marche : quand un bot travaille, l'appli démarre la Live Activity et envoie son jeton au serveur ; le serveur
la met à jour par Apple (au plus toutes les 15 secondes, tout de suite quand le bot attend ton accord) et la termine à la
fin de la tâche. Code : `mobile/src/liveActivity.ts`, `mobile/modules/sklubot-liveactivity`, `mobile/targets/sklubot-live`,
`server/src/liveactivity.ts`. Documentation suivie : <https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications>.
