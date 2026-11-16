# Sklubot — l’appli mobile (Android, puis iPhone)

Une vraie appli native (React Native + Expo SDK 58), cliente de ton serveur Sklubot : liste des bots, discussions en direct,
étapes de travail, cartes d’autorisation, tâches, bibliothèque, notifications. Les bots tournent toujours sur le serveur ;
l’appli parle uniquement à son API HTTP (`/api/...`, voir `server/src/routes.ts`).

Deux variantes Android sortent du même code :

| Variante | Identifiant | Pour qui | Contrôle du téléphone |
|---|---|---|---|
| **complet** (par défaut) | `fr.sklubot.app.complet` | installation depuis un fichier (APK) | oui (module `modules/sklubot-relay`) |
| **store** (`SKLUBOT_VARIANT=store`) | `fr.sklubot.app` | Google Play (puis App Store) | non : ni code, ni service d’accessibilité, ni permission |

Pourquoi deux identifiants : Google Play signe l’appli publiée avec sa propre clé (Play App Signing). Une appli installée
depuis un fichier avec le même identifiant mais une autre signature bloquerait l’installation depuis Play (et inversement).
Avec `fr.sklubot.app.complet` à part, les deux peuvent cohabiter sur un téléphone, sans conflit ni désinstallation.
L’ancienne appli WebView (`android/`, `fr.sklubot.android`) reste indépendante.

## Organisation

```text
App.tsx, index.ts      navigation (onglets Bots / Tâches / Réglages + écrans Discussion et Détails), démarrage
src/api/               client HTTP (session en en-tête Cookie, pas de cookie jar), flux en direct SSE, origine, cookie
src/state/             store (zustand), réducteurs purs (événements, lignes), éléments de discussion, session sécurisée
src/components/        personnages des bots (SVG), Markdown natif, bulles, étapes, cartes, zone de saisie
src/screens/           Bienvenue (serveur, connexion), Bots, Discussion, Détails, Tâches, Réglages
src/notify/            notifications locales + vérification en arrière-plan (expo-background-task)
src/relay.ts           pont vers le module natif du relais (absent dans la variante store)
src/i18n/              textes fr (par défaut) / en
modules/sklubot-relay/ module Expo local : le relais Kotlin repris de android/ (+ ses tests unitaires)
plugins/               plugins de configuration : http seulement en local, signature, variante store
__tests__/             tests unitaires (jest-expo)
```

Les types de l’API viennent directement de `server/src/shared.ts` (imports de types seulement).

## Lancer en développement

Prérequis : Node 22.13+, Java 17+, Android SDK (variable `ANDROID_HOME`), un émulateur ou un téléphone.

```bash
cd mobile
npm install
npm run qa                       # types + tests unitaires
npx expo run:android             # build debug + installation + Metro
```

Pour un serveur local : `npm run build` à la racine, puis
`SESSION_SECRET=$(openssl rand -hex 32) DATA_DIR=/tmp/sk PORT=8799 OPEN_SIGNUP=1 DEMO_MODE=1 node server/dist/index.js`.
Dans l’appli, adresse `http://10.0.2.2:8799` (émulateur → ordinateur) ou `http://localhost:8799` après
`adb reverse tcp:8799 tcp:8799`. Le http n’est accepté que pour ces adresses locales (code de l’appli **et**
configuration réseau Android, `plugins/withDevCleartext.js`) ; tout le reste doit être en https.

## Construire les versions de publication

1. Le fichier `mobile/keystore.properties` (ignoré par git, **jamais commité**) indique la clé de signature :

   ```properties
   storeFile=/chemin/absolu/sklubot-release.jks
   storePassword=...
   keyAlias=sklubot
   keyPassword=...
   ```

2. Variante **complet** (APK à installer) :

   ```bash
   npx expo prebuild -p android --clean
   cd android && ./gradlew :app:assembleRelease :app:bundleRelease
   cp app/build/outputs/apk/release/app-release.apk ../dist/sklubot-complet-1.0.0.apk
   ```

3. Variante **store** (AAB pour Google Play, APK pour tester) :

   ```bash
   SKLUBOT_VARIANT=store npx expo prebuild -p android --clean
   cd android && ./gradlew :app:bundleRelease :app:assembleRelease
   cp app/build/outputs/bundle/release/app-release.aab ../dist/sklubot-store-1.0.0.aab
   cp app/build/outputs/apk/release/app-release.apk ../dist/sklubot-store-1.0.0.apk
   ```

   `android/` est généré (Continuous Native Generation) : ne le modifie pas à la main, tout passe par `app.config.ts`
   et `plugins/`. Il faut refaire `prebuild --clean` à chaque changement de variante.

   Cibles actuelles (Expo SDK 58) : minSdk 24, targetSdk 36, compileSdk 37 (Android 15+ dessine sous les barres
   système : l’appli gère les marges avec `react-native-safe-area-context`) ; ABI arm64-v8a, armeabi-v7a et x86_64.
   L’APK universel fait ~75 Mo ; Google Play découpe l’AAB (~50 Mo) et chaque téléphone ne télécharge que sa partie.
   R8 (minification) est désactivé : il retirait le constructeur de la base Room de WorkManager (plantage au démarrage).
   Si Maven Central répond 429, relancer Gradle (le dépôt local est mis en cache).

4. Vérifications :

   ```bash
   B=$ANDROID_HOME/build-tools/35.0.0
   $B/apksigner verify --print-certs dist/sklubot-complet-1.0.0.apk
   $B/aapt2 dump badging dist/sklubot-store-1.0.0.apk | head
   # la variante store ne doit déclarer ni service d'accessibilité ni service de premier plan "special use" :
   $B/aapt2 dump xmltree --file AndroidManifest.xml dist/sklubot-store-1.0.0.apk | grep -E "BIND_ACCESSIBILITY_SERVICE|FOREGROUND_SERVICE_SPECIAL_USE" && echo "PROBLÈME" || echo "OK"
   ```

### Numéros de version

Dans `app.config.ts` : `VERSION` (affichée, ex. 1.0.1) et `VERSION_CODE` (entier). **Chaque envoi sur Google Play
doit avoir un `VERSION_CODE` plus grand que le précédent** (1, 2, 3…), même pour une simple correction. Puis
`prebuild --clean` et rebuild.

### La clé de signature : à garder précieusement

- `sklubot-release.jks` + son mot de passe signent l’APK « complet ». **Si tu la perds, les téléphones qui ont l’appli
  ne pourront plus la mettre à jour** (il faudra désinstaller puis réinstaller, et perdre la connexion enregistrée).
- Sauvegarde-la à deux endroits sûrs (gestionnaire de mots de passe + clé USB chiffrée), jamais dans git ni sur le serveur.
- Pour Google Play, cette même clé sert de **clé d’importation** ; Google garde la clé de signature finale (Play App
  Signing). Une clé d’importation perdue se remplace via l’assistance Play Console, pas la clé finale : laisse Google la garder.

## Tests

- `npm test` (jest-expo) : client API (cookie de session, erreurs, 401), parseur SSE et reconnexion, réducteurs
  d’événements, construction de la discussion, Markdown, origine du serveur, cookie, vérification en arrière-plan.
- Relais Android (Kotlin, JVM + Robolectric) : après `prebuild` de la variante complet,
  `cd android && ./gradlew :sklubot-relay:testDebugUnitTest` (32 tests, dont les captures Robolectric des écrans du relais ;
  `-Dscreens.dir=/un/dossier` pour les enregistrer).
- Serveur : `npm test` à la racine (inclut la page de confidentialité `/confidentialite`).

## Contrôle du téléphone (variante complet)

Le relais Kotlin de `android/` (`app.sklubot.android.relay`) est repris tel quel dans `modules/sklubot-relay` (module
Expo local, autolinké), avec ses ressources, son manifeste (service d’accessibilité, service de premier plan « special
use », tuile Stop, écran de consentement) et ses tests. Le pont `SklubotRelayModule` ne fait que : donner l’adresse du
serveur au relais (`setServer`), ouvrir l’écran natif du relais (`openRelay`), lire son état. Tout le reste (allumer,
appairer, activer l’accessibilité, consentement par session, Stop, applis bloquées) reste un geste de l’utilisateur
dans les écrans natifs, exactement comme dans l’ancienne appli. Entrées : Réglages → Contrôle du téléphone, et le lien
`sklubot://relay` (bouton « Relier ce téléphone » du site). Les écrans natifs du relais suivent la langue du téléphone
(ressources Android fr/en), pas le choix de langue fait dans l’appli.

Après une mise à jour de l’APK, Android désactive le service d’accessibilité : il faut le réactiver (l’écran du relais
le signale). Comme avant, sur Android 13+ une appli installée depuis un fichier doit d’abord passer par
« Autoriser les paramètres restreints » (bouton dans l’écran du relais).

## Notifications

- **Maintenant (sans compte tiers)** : notifications locales. Tant que l’appli tourne (au premier plan ou peu après),
  le flux en direct `/api/events` déclenche une notification quand un bot répond ou attend ta réponse (pas pour la
  discussion ouverte à l’écran). Quand le système a arrêté l’appli, une tâche d’arrière-plan (WorkManager, environ toutes
  les 15 min) interroge `GET /api/bots` et annonce les nouveaux messages non lus et les bots qui attendent.
- **Plus tard : vrai push** (instantané même appli fermée). Le serveur a déjà le Web Push (`server/src/push.ts`,
  types `PushKind`) ; il faut ajouter un canal natif :
  1. Créer un projet Firebase (gratuit) avec l’appli `fr.sklubot.app`, télécharger `google-services.json`, l’indiquer dans
     `app.config.ts` (`android.googleServicesFile`) ; pour iPhone, une clé APNs (compte Apple Developer).
  2. Dans l’appli : `Notifications.getDevicePushTokenAsync()` (jeton FCM/APNs brut, pas besoin du service Expo) puis
     l’envoyer au serveur.
  3. Côté serveur : une route `POST /api/push/native {platform, token}` stockée comme un appareil de `push.ts`, et un
     envoi via l’API HTTP v1 de FCM (compte de service Google, gardé dans le `.env` du serveur) et APNs (clé .p8).
     Mêmes réglages qu’aujourd’hui (types, heures calmes), même `notePresence` pour ne pas notifier une appli ouverte.
  Rien de cela n’est fait ici : il faut les comptes Firebase / Apple de l’utilisateur.

## Ce qui reste sur le site web

Réglages des bots, applis connectées, coffre, routines (création), consommation, espaces de travail, vue en direct de
l’ordinateur d’un bot et cartes spéciales (secret à saisir, prise en main, etc.) : l’appli ouvre le site dans le
navigateur du système. **Appels vocaux : pas encore dans l’appli** (TODO : capture micro en PCM natif + WebSocket
`/api/voice/:botId`, voir `web/src/lib/voice.ts`) ; l’appli l’indique et renvoie vers le site.

## iPhone (plus tard)

Même code. Il faut un Mac ou le service de build Expo, et un compte Apple Developer (99 €/an). Voir `STORE.md`.
Le relais (contrôle du téléphone) n’existe pas sur iPhone (iOS ne le permet pas) : le module est Android seulement.
