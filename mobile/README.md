# Sklubot — l’appli mobile (Android, puis iPhone)

Une vraie appli native (React Native + Expo SDK 58), cliente de ton serveur Sklubot : liste des bots, discussions en direct,
étapes de travail, toutes les cartes (autorisations, questions, secrets, prise en main de l’écran…), appels vocaux,
écran de l’ordinateur d’un bot, tâches, bibliothèque, notifications. Les bots tournent toujours sur le serveur ;
l’appli parle uniquement à son API HTTP (`/api/...`, voir `server/src/routes.ts`).

Deux variantes Android sortent du même code :

| Variante | Identifiant | Pour qui | Contrôle du téléphone |
|---|---|---|---|
| **complet** (par défaut) | `fr.sklubot.app.complet` | installation depuis un fichier (APK) | oui (module `modules/sklubot-relay`) + « Rester connecté en arrière-plan » (`modules/sklubot-live`) |
| **store** (`SKLUBOT_VARIANT=store`) | `fr.sklubot.app` | Google Play (puis App Store) | non : ni relais, ni service d’accessibilité, ni connexion permanente (les deux modules sont exclus) |

Les appels vocaux (`modules/sklubot-voice`) sont dans les deux variantes.

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
src/voice/             appels vocaux : protocole serveur (serverCall), voix du téléphone (deviceCall), état (call)
src/lib/               cardActions (requêtes des cartes), catalog (carte « connecter »), screen (écran du bot), …
src/relay.ts           pont vers le module natif du relais (absent dans la variante store)
src/live.ts            pont vers la connexion en arrière-plan (absente dans la variante store)
src/i18n/              textes fr (par défaut) / en
modules/sklubot-relay/ module Expo local : le relais Kotlin repris de android/ (+ ses tests unitaires)
modules/sklubot-voice/ module Expo local : micro PCM 16 kHz, lecture WAV, haut-parleur/écouteur, focus audio,
                       reconnaissance et synthèse vocales du téléphone, service de premier plan « microphone »
modules/sklubot-live/  module Expo local (complet) : service de premier plan qui garde /api/events et notifie
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
   cp app/build/outputs/apk/release/app-release.apk ../dist/sklubot-complet-1.1.0.apk
   ```

3. Variante **store** (AAB pour Google Play, APK pour tester) :

   ```bash
   SKLUBOT_VARIANT=store npx expo prebuild -p android --clean
   cd android && ./gradlew :app:bundleRelease :app:assembleRelease
   cp app/build/outputs/bundle/release/app-release.aab ../dist/sklubot-store-1.1.0.aab
   cp app/build/outputs/apk/release/app-release.apk ../dist/sklubot-store-1.1.0.apk
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
   $B/apksigner verify --print-certs dist/sklubot-complet-1.1.0.apk
   $B/aapt2 dump badging dist/sklubot-store-1.1.0.apk | head
   # la variante store ne doit déclarer ni service d'accessibilité, ni service "special use", ni démarrage au boot du
   # module live (elle déclare en revanche FOREGROUND_SERVICE_MICROPHONE pour les appels) :
   $B/aapt2 dump xmltree --file AndroidManifest.xml dist/sklubot-store-1.1.0.apk | grep -E "BIND_ACCESSIBILITY_SERVICE|FOREGROUND_SERVICE_SPECIAL_USE|sklubot.live|android.relay" && echo "PROBLÈME" || echo "OK"
   ```

### Numéros de version

Dans `app.config.ts` : `VERSION` (affichée, actuellement 1.1.0, versionCode 2) et `VERSION_CODE` (entier). **Chaque envoi sur Google Play
doit avoir un `VERSION_CODE` plus grand que le précédent** (1, 2, 3…), même pour une simple correction. Puis
`prebuild --clean` et rebuild.

### La clé de signature : à garder précieusement

- `sklubot-release.jks` + son mot de passe signent l’APK « complet ». **Si tu la perds, les téléphones qui ont l’appli
  ne pourront plus la mettre à jour** (il faudra désinstaller puis réinstaller, et perdre la connexion enregistrée).
- Sauvegarde-la à deux endroits sûrs (gestionnaire de mots de passe + clé USB chiffrée), jamais dans git ni sur le serveur.
- Pour Google Play, cette même clé sert de **clé d’importation** ; Google garde la clé de signature finale (Play App
  Signing). Une clé d’importation perdue se remplace via l’assistance Play Console, pas la clé finale : laisse Google la garder.

## Tests

- `npm test` (jest-expo) : client API (cookie de session, erreurs, 401, octets de l’écran), parseur SSE et reconnexion,
  réducteurs d’événements, discussion, Markdown, origine, cookie, vérification en arrière-plan ; **cartes** (chaque requête
  comparée à celle du site et à la route du serveur, aucun journal ni stockage des secrets), catalogue de la carte
  « connecter », écran du bot (taille JPEG, base64, clic → pixels), **appels** (protocole serveur avec faux WebSocket :
  hello 16 kHz, trames, WAV, played, atténuation, barge-in, sourdine, reconnexion, refus 409/401 ; voix du téléphone :
  messages vocaux, lecture des seules nouvelles réponses, pas d’écoute pendant que le bot parle, erreurs, compte rendu),
  notifications sans doublon, invite « contrôle du téléphone coupé ».
- Modules Kotlin (JVM), après `prebuild` de la variante complet : `cd android && ./gradlew :sklubot-relay:testDebugUnitTest
  :sklubot-voice:testDebugUnitTest :sklubot-live:testDebugUnitTest` (relais : 32 tests dont les captures Robolectric,
  `-Dscreens.dir=/un/dossier` pour les enregistrer ; voix : lecture WAV, niveau, octets ; live : règles de notification,
  SSE, attente entre reconnexions).
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

**Après une mise à jour.** Vérifié sur l’émulateur Android 14 (image AOSP « Google APIs ») : passer de la 1.0.0 à la
1.1.0 (`adb install -r`, même clé) **ne désactive pas** le service d’accessibilité (il reste dans
`enabled_accessibility_services`), et un `am force-stop` non plus ; l’appairage (préférences privées + clé du Keystore)
est conservé. Ce qui s’arrêtait vraiment : le service de premier plan du relais (Android tue les processus de l’appli à
la mise à jour) — il restait « allumé » sans connexion jusqu’à la réouverture de son écran. Corrigé : un récepteur
`MY_PACKAGE_REPLACED` le relance, et l’appli le relance aussi à chaque démarrage. La désactivation observée vient donc
d’ailleurs : surcouches de certains constructeurs (Samsung, Xiaomi… non vérifiable ici), économiseurs de batterie, ou
l’utilisateur. Dans tous ces cas l’appli affiche maintenant, sur l’écran des bots, « Le contrôle du téléphone est
coupé » quand le téléphone est appairé, le relais allumé et le service coupé, avec un bouton qui ouvre directement la
page Sklubot des réglages d’accessibilité (`Settings.ACTION_ACCESSIBILITY_DETAILS_SETTINGS`, Android 11+, sinon la liste)
et un lien vers « Autoriser les paramètres restreints » (Android 13+, appli installée depuis un fichier). L’appli ne
réactive jamais l’accessibilité elle-même et ne contourne aucun consentement.

## Cartes spéciales

Toutes les cartes du site se gèrent dans l’appli, avec les mêmes appels au serveur (`src/lib/cardActions.ts`, vérifié
par les tests contre `web/src/components/*.tsx` et `server/src/routes.ts`) : autorisation, question, **secret à saisir**
(champ masqué `secureTextEntry`, sans saisie automatique ni suggestions, envoyé une seule fois à
`POST /bots/:id/cards/:seq/secret` puis effacé ; jamais journalisé ni enregistré sur le téléphone), **connecter une
appli** (catalogue du serveur, jeton masqué, connexion OAuth dans le navigateur du système, ou serveur MCP à la main ;
les applis intégrées Gmail/Outlook… restent à configurer sur le site, comme leur client OAuth), **prise en main**
(voir ci-dessous), action incertaine, tâche de fond (Arrêter, répondre, autorisation), suggestion, point d’étape de
dépense, compétence apprise (modifiable), connecteur d’API (jeton masqué), question de mémoire, e-mail reçu (Libérer).

**Discussion en plus (L184).** Sous un message : l’aperçu de son premier lien (titre et description lus par le serveur,
`GET /link-preview`, sans image) et « Citer » (ou un appui long) qui met ses mots en citation en haut de la saisie. Sous
une vue dessinée par un bot : « Épingler au tableau de bord ». Réglages → « Tableau de bord et chiffres » : les vues
épinglées (en texte) et les chiffres du compte (`GET /dashboard/pins`, `GET /usage-metrics`). Le thème appliqué sur le
site (Réglages → Général → Thèmes proposés) colore aussi l’appli ; Réglages → « Thème du bot » le coupe sur ce téléphone.

**Écran du bot / prise en main.** L’écran « Ordinateur de … » (Détails → Voir son ordinateur, ou « Ouvrir son écran et
prendre la main » sur la carte) affiche l’écran du bot (`GET /bots/:id/screen`, une image par seconde) ; en prenant la
main : toucher = clic au bon pixel, texte à taper, touches (Entrée, Effacer, Tab, Échap, flèches), défilement,
adresse ; le serveur est prévenu (`/desktop/control` toutes les 30 s, `/desktop/handback` en sortant) et « J’ai fini,
rends-lui la main » termine la demande. Le site propose en plus un flux vidéo en direct des ordinateurs Linux (noVNC sur
le WebSocket `/api/bots/:id/vnc`, protocole RFB) : il n’existe pas de client RFB maintenu pour React Native, donc l’appli
utilise le mode capture d’écran, que le site utilise lui-même en repli et qui marche pour les deux types d’ordinateur.

## Appels vocaux

Bouton téléphone dans l’en-tête d’une discussion (bots, pas les salons ; les deux variantes). Comme sur le site :
- si le serveur a des services vocaux (`GET /bots/:id/voice` → `server`, ex. whisper.cpp + Piper) : WebSocket
  `/api/voice/:botId` avec le cookie de session en en-tête, micro en PCM 16 kHz 16 bits mono par trames de 20 ms
  (`AudioRecord`, source `VOICE_COMMUNICATION` = annulation d’écho du téléphone), réponses WAV lues l’une après l’autre
  (`AudioTrack`) et acquittées (`played`), atténuation dès que tu parles, coupure sur `barge_in`, Interrompre, sourdine ;
  en plus du site : reconnexion automatique (1, 2, 4, 8, 15 s) si le réseau coupe ;
- sinon : la reconnaissance vocale et la synthèse vocale du téléphone (`SpeechRecognizer`, `TextToSpeech`), comme le
  mode navigateur du site (message vocal envoyé à chaque phrase, réponses lues, compte rendu de l’appel au serveur).

Micro demandé au premier appel (refus et refus définitif gérés, bouton vers les réglages), focus audio (un appel
téléphonique coupe le micro), haut-parleur / écouteur (casque filaire ou Bluetooth s’il y en a un), Raccrocher (aussi
depuis la notification). Pendant l’appel, un **service de premier plan de type « microphone »** garde l’appel actif écran
verrouillé (le site accepte des appels jusqu’à 1 h). Limite : la reconnaissance vocale du téléphone (mode sans services
vocaux) peut refuser d’écouter écran éteint selon le service installé ; le mode serveur n’a pas cette limite.

## Notifications

- **Appli ouverte** (ou récemment en arrière-plan) : le flux en direct `/api/events` déclenche une notification quand un
  bot répond ou attend ta réponse (pas pour la discussion ouverte à l’écran).
- **Variante complet — « Rester connecté en arrière-plan »** (Réglages → Notifications, désactivé par défaut) : un service
  de premier plan (`modules/sklubot-live`) garde `/api/events` ouvert (le serveur n’a pas de long-polling ; le SSE avec un
  ping toutes les 20 s est déjà le plus léger) et notifie **instantanément, appli fermée, sans Firebase**. Une
  notification discrète « Sklubot reste connecté » (importance minimale, bouton Arrêter) reste affichée, comme Android
  l’exige. Économe : une seule connexion, aucune interrogation périodique, attente croissante entre deux reconnexions
  (2 s → 5 min), attente du réseau quand il n’y en a pas ; s’arrête et efface sa copie de session à la déconnexion, à
  la suppression du compte, ou si le serveur répond 401. Option « Relancer au démarrage du téléphone » (`BOOT_COMPLETED`,
  seulement si tu l’as choisie) ; relancé aussi après une mise à jour de l’appli s’il était actif. Pas de doublon : le
  service ne notifie pas quand l’appli est au premier plan, l’appli ne notifie pas quand elle est en arrière-plan et que
  le service est actif, et la vérification toutes les 15 min est alors coupée.
  Type de service : **specialUse** (déclaré avec sa justification, `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`). `dataSync` ne
  convient pas : sous Android 15 (targetSdk 35+) il est limité à 6 h par 24 h
  (https://developer.android.com/develop/background-work/services/fgs/timeout) et ne peut plus démarrer depuis
  `BOOT_COMPLETED` (https://developer.android.com/about/versions/15/behavior-changes-15#fgs-boot-completed) ;
  `specialUse` n’a ni l’un ni l’autre (https://developer.android.com/develop/background-work/services/fgs/service-types#special-use).
  La session est gardée chiffrée par une clé du Keystore Android, uniquement tant que l’option est active.
- **Variante store** : pas de connexion permanente ; quand le système a arrêté l’appli, une tâche d’arrière-plan
  (WorkManager, environ toutes les 15 min) interroge `GET /api/bots` et annonce les nouveaux messages non lus et les
  bots qui attendent.
- **Plus tard : vrai push** (instantané même appli fermée, pour la variante store). Le serveur a déjà le Web Push
  (`server/src/push.ts`, types `PushKind`) ; il faut ajouter un canal natif :
  1. Créer un projet Firebase (gratuit) avec l’appli `fr.sklubot.app`, télécharger `google-services.json`, l’indiquer dans
     `app.config.ts` (`android.googleServicesFile`) ; pour iPhone, une clé APNs (compte Apple Developer).
  2. Dans l’appli : `Notifications.getDevicePushTokenAsync()` (jeton FCM/APNs brut, pas besoin du service Expo) puis
     l’envoyer au serveur.
  3. Côté serveur : une route `POST /api/push/native {platform, token}` stockée comme un appareil de `push.ts`, et un
     envoi via l’API HTTP v1 de FCM (compte de service Google, gardé dans le `.env` du serveur) et APNs (clé .p8).
     Mêmes réglages qu’aujourd’hui (types, heures calmes), même `notePresence` pour ne pas notifier une appli ouverte.
  Rien de cela n’est fait ici : il faut les comptes Firebase / Apple de l’utilisateur.

## Ce qui reste sur le site web

Réglages des bots, applis connectées (gestion, applis intégrées), coffre, routines (création), consommation, espaces de
travail, réglages de la voix, et le flux vidéo en direct (noVNC) des ordinateurs Linux : l’appli ouvre le site dans le
navigateur du système.

## iPhone (plus tard)

Même code. Il faut un Mac ou le service de build Expo, et un compte Apple Developer (99 €/an). Voir `STORE.md`.
Le relais (contrôle du téléphone) n’existe pas sur iPhone (iOS ne le permet pas) : le module est Android seulement.
