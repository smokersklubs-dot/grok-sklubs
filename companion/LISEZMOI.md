# Sklubot pour ordinateur

L'application **Sklubot** (Windows, macOS, Linux) montre **ton Sklubot dans sa propre fenêtre**, avec les notifications, une icône dans la barre des tâches / la barre des menus et le nombre de messages non lus. Elle contient aussi le **Relais** (l'ancienne application « Sklubot Relais ») : tes bots peuvent voir ton écran et utiliser ta souris et ton clavier — **seulement quand tu l'acceptes, sur cet ordinateur**.

Une seule application au lieu de deux. Le Relais reste éteint tant que tu ne l'allumes pas.

## Télécharger et installer

Les fichiers sont sur la page **Télécharger Sklubot** de ton serveur (`https://ton-adresse/telecharger`, lien en bas de la page de connexion et dans **Réglages › Général**), ou sur la [page des versions GitHub](https://github.com/smokersklubs-dot/grok-sklubs/releases) (versions `desktop-v…`).

| Système | Fichier | Remarques |
|---|---|---|
| Windows 10/11 | `Sklubot-…-win.exe` (installateur) ou `Sklubot-…-win.zip` (sans installation : décompresse, puis lance `Sklubot.exe`) | voir « Windows » plus bas |
| macOS 11 ou plus récent (Intel et Apple Silicon) | `Sklubot-…-mac.dmg` | ouvre-le et glisse Sklubot dans Applications ; voir « macOS » plus bas |
| Linux (Ubuntu, Debian…) | `Sklubot-…-linux.deb` (conseillé) | `sudo apt install ./Sklubot-…-linux.deb` |
| Linux (autres) | `Sklubot-…-linux.AppImage` | `chmod +x Sklubot-…-linux.AppImage`, puis double‑clic |

Aucune installation de Node.js n'est nécessaire. Pour vérifier un fichier téléchargé depuis GitHub : son empreinte SHA‑256 est dans `SHA256SUMS.txt` sur la même page.

### Premier lancement sous Windows (SmartScreen)

Tant que l'application n'est pas signée avec un certificat de signature de code, Windows peut afficher **« Windows a protégé votre ordinateur »** : clique **Informations complémentaires**, puis **Exécuter quand même**. Ça ne se fait qu'une fois. Une version signée avec un certificat de signature de code évite ou réduit cet avertissement.

### Premier lancement sous macOS (Gatekeeper)

Tant que l'application n'est pas signée et notarisée par Apple, macOS refuse de l'ouvrir la première fois : ouvre **Réglages Système › Confidentialité et sécurité**, descends jusqu'à **Sécurité** et clique **Ouvrir quand même** à côté de « Sklubot », puis confirme. ([aide Apple](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac)) Une version signée et notarisée n'a pas besoin de cette étape.

## Ce que fait l'application

1. **Au premier lancement**, elle demande l'adresse de ton serveur Sklubot (pré‑remplie avec `https://sklubot.sklubs.fr`). L'adresse doit commencer par `https://` (sauf pour un serveur sur cet ordinateur : `http://localhost…`). Elle vérifie qu'un Sklubot répond ; sinon, appuie encore sur **Continuer** pour l'utiliser quand même.
2. Ensuite, elle ouvre **ton Sklubot** comme dans le navigateur. Tu restes connecté d'une fois sur l'autre. La taille et la position de la fenêtre sont retenues.
3. **Menu Sklubot** : Recharger · Changer de serveur… · Ouvrir dans le navigateur · Relais… · Lancer au démarrage · Rechercher une mise à jour · Quitter.
4. **Notifications** : active‑les dans Sklubot (**Réglages › Notifications**), comme dans un navigateur ; elles s'affichent comme celles du système. Un clic dessus ramène la fenêtre. Les notifications « push » du navigateur (quand Sklubot est fermé) n'existent pas dans l'application : elle affiche les notifications tant qu'elle tourne, même fenêtre fermée si le Relais est allumé.
5. **Non lus** : le nombre de messages non lus s'affiche sur l'icône (Dock sur macOS, barre des tâches sur Windows, lanceurs qui le permettent sous Linux) et dans l'info‑bulle de l'icône de la barre.
6. **Micro** (appel vocal), **notifications** et **presse‑papiers** ne sont autorisés qu'à ton serveur Sklubot. La caméra, la localisation et le reste sont refusés.
7. **Liens** : seul ton serveur s'ouvre dans la fenêtre. Tout autre lien s'ouvre dans ton navigateur habituel (seulement les liens `https://`, `http://` et `mailto:`).
8. **Fermer la fenêtre** :
   - si le **Relais est allumé**, Sklubot reste dans la barre des tâches / la barre des menus pour que tes bots puissent te joindre ; pour quitter : icône › **Quitter Sklubot** ;
   - sinon, fermer la fenêtre quitte l'application sur Windows et Linux ; sur macOS, l'application reste dans le Dock comme les autres applications Mac (⌘ Q pour quitter).
9. **Lancer au démarrage** est désactivé par défaut.
10. **Mises à jour** : l'application regarde (au démarrage, puis via le menu) s'il existe une version plus récente sur la page des versions GitHub et te propose de **la télécharger** ; elle ne s'installe jamais toute seule. (Une mise à jour automatique n'est sûre qu'avec des fichiers signés : sans certificat de signature, ce n'est pas activé.)
11. Une seule fenêtre Sklubot à la fois : relancer l'application ramène la fenêtre déjà ouverte.

L'application **dans le navigateur** n'est pas touchée : tout reste utilisable aussi depuis Chrome, Firefox, Safari…

Limite connue : la **dictée** qui s'appuie sur la reconnaissance vocale intégrée au navigateur peut ne pas fonctionner dans l'application (Electron n'inclut pas le service de reconnaissance vocale de Google) ; l'**appel vocal** de Sklubot, lui, passe par ton serveur et fonctionne.

## Le Relais (laisser tes bots piloter cet ordinateur)

Quand tu donnes la main, un pointeur violet porte le nom du bot. Il marque l’endroit où le bot pointe, clique, défile ou dépose un élément. Il s’efface après deux secondes d’inactivité. Le bandeau reste affiché pendant toute la prise de contrôle. **Stop** dans le bandeau ou **Ctrl + Alt + Maj + S** sous Windows rend immédiatement la main.

Essaie « Montre-moi où cliquer pour ouvrir les réglages, puis rends-moi la main ». Le bot observe ton écran avec `my_screen`, utilise `my_point` pour désigner le bouton et termine avec `my_release`. Pour un clic demandé, `my_click` renvoie une nouvelle capture afin que le bot vérifie le résultat. Les coordonnées se lisent depuis le coin supérieur gauche de la dernière capture. Par exemple, le centre d’une capture de 800 × 450 pixels est `{"x":400,"y":225}`, quel que soit le zoom de Windows.

Menu **Sklubot › Relais…** (ou l'icône de la barre › **Relais…**) ouvre le panneau du Relais.

- Il se connecte à **ton** serveur Sklubot ; il n'ouvre aucun port sur ton ordinateur.
- Il est **éteint** tant que tu ne l'as pas relié. **Oublier ce serveur** l'éteint à nouveau.
- Chaque bot doit te demander la permission la première fois ; chaque commande système t'est montrée avant d'être lancée.
- Un bandeau rouge reste affiché tant qu'un bot a la main. **Stop** (ou **Ctrl + Alt + Maj + S**, **⌘ ⌥ ⇧ S** sur Mac) arrête tout tout de suite et bloque le Relais jusqu'à ce que tu le réautorises.
- Tout ce que font les bots est noté dans un journal sur ton ordinateur (bouton « Ouvrir le journal »).
- « Mettre en pause » coupe la connexion : rien n'est envoyé pendant la pause.
- **Règles de sécurité** (vérifiées par le serveur, puis encore ici) : fenêtres de terminal, réglages du système, gestionnaires de mots de passe et Sklubot lui-même sont refusés aux clics et à la frappe ; jamais de saisie dans un champ mot de passe, sauf un identifiant de ton coffre rempli par Sklubot sur le bon site ; la fenêtre au premier plan est relue juste avant chaque clic ou touche ; raccourcis dangereux refusés ; touches toujours relâchées à la fin. **Commandes** : activées par défaut (désactivables dans Sklubot, Réglages → Ordinateurs → Règles de sécurité) ; chacune est montrée sur une carte dans Sklubot, et ici la première de chaque session ; les commandes sensibles (supprimer, sudo, installer, `curl | sh`…) et celles qui lancent un script (40 premières lignes + empreinte) sont demandées ici à chaque fois. Détails : `docs/ORDINATEUR.md`.

### Relier le Relais à ton serveur Sklubot

1. Ouvre **Relais…**. L'adresse est pré‑remplie avec celle de la fenêtre Sklubot ; **Continuer**.
2. Un code à 8 caractères s'affiche (par exemple `K7QM-2XPA`).
3. Dans Sklubot : **Réglages › Ordinateurs › Relier un ordinateur**, tape ce code.
4. C'est relié. La prochaine fois, le Relais se reconnecte tout seul quand l'application démarre.

- **Le code** vaut 10 minutes et ne sert qu'une fois ; s'il expire, le Relais en affiche un nouveau tout seul. Ne tape jamais un code que quelqu'un t'a donné.
- Une fois relié, l'ordinateur apparaît dans **Réglages › Ordinateurs** (connecté, en pause, verrouillé, bot aux commandes) et dans le panneau de chaque bot, section **Mon ordinateur**. **Retirer** le déconnecte aussitôt : le Relais efface son accès et propose « Relier à nouveau ».
- Côté Sklubot, un bot doit aussi obtenir **ton accord dans l'appli** (une carte dans la discussion) pour prendre le contrôle et pour chaque commande — en plus de la fenêtre du Relais. Le bouton **Stop** de l'appli termine la session à distance.
- Tu peux couper les outils « Mon ordinateur » pour un bot dans ses réglages (Outils).

Quand un bot demande la main, une fenêtre s'ouvre : **Autoriser cette fois**, **Toujours autoriser ce bot** ou **Refuser**. Sans réponse en 60 secondes, c'est refusé. Tu peux retirer une autorisation à tout moment dans le panneau du Relais (section « Bots »).

### Tu avais déjà « Sklubot Relais » ?

Au premier lancement, Sklubot reprend une fois les réglages de l'ancien Relais (adresse du serveur, autorisations des bots, dossiers partagés, journal) ; l'ancien dossier n'est pas modifié.

- **Windows** : l'accès est repris tel quel, rien à refaire.
- **macOS et Linux** : l'accès de l'ancien Relais était chiffré par le trousseau du système au nom de « Sklubot Relais » ; la nouvelle application (« Sklubot ») ne peut pas le relire. Le Relais affiche alors un nouveau code : tape‑le dans **Réglages › Ordinateurs** (et retire l'ancien ordinateur de la liste). Les autorisations des bots et les dossiers partagés sont conservés.
- **Désinstalle l'ancien « Sklubot Relais »** ensuite (et décoche son démarrage automatique) : deux Relais avec le même accès se renverraient la connexion.

## Autorisations à donner selon ton système (pour le Relais)

### macOS

macOS demande deux autorisations, à donner une fois :

1. **Enregistrement de l'écran** (pour que le bot voie l'écran) : menu Pomme › Réglages Système › Confidentialité et sécurité › **Enregistrement de l'écran et de l'audio du système** › active « Sklubot ». ([aide Apple](https://support.apple.com/guide/mac-help/mchld6aa7d23/mac))
2. **Accessibilité** (pour la souris et le clavier) : menu Pomme › Réglages Système › Confidentialité et sécurité › **Accessibilité** › active « Sklubot ». ([aide Apple](https://support.apple.com/guide/mac-help/mh43185/mac))

Le panneau du Relais indique si elles sont accordées et propose un bouton « Ouvrir les réglages ». Après les avoir activées, quitte et relance Sklubot. Le **micro** (appel vocal) est demandé par macOS la première fois que tu lances un appel.

### Windows

- Aucune autre autorisation n'est nécessaire. Limite de Windows : le Relais ne peut pas piloter les fenêtres lancées « en tant qu'administrateur » (ni l'écran de confirmation UAC) s'il ne tourne pas lui‑même en administrateur — et il ne faut pas lancer Sklubot en administrateur.

### Linux

- **Session X11 (Xorg) : tout fonctionne.**
- **Session Wayland : soyons honnêtes, le Relais n'y marche presque pas.** Wayland interdit volontairement à une application de voir tout l'écran ou de simuler la souris et le clavier dans les autres fenêtres. Sklubot tourne en mode X11 (XWayland) : le Relais ne voit et ne pilote au mieux que les applications X11, et la capture d'écran peut demander ton accord à chaque fois ou rester noire. Le raccourci Stop global peut aussi ne pas être disponible (utilise le bouton Stop du bandeau). **Solution :** à l'écran de connexion, choisis une session « Xorg » (sur Ubuntu : roue dentée › « Ubuntu sur Xorg »). La fenêtre Sklubot elle‑même fonctionne sous Wayland comme sous X11.
- `window.focus` (mettre une fenêtre au premier plan) a besoin du petit outil `wmctrl` : `sudo apt install wmctrl`.
- Sur certaines distributions récentes, l'AppImage peut refuser de démarrer (FUSE ou bac à sable Chromium). Dans ce cas, utilise le paquet `.deb`.
- L'icône dans la barre du haut demande, sous GNOME, l'extension « AppIndicator ». Sans elle, la fenêtre, le bandeau Stop et le panneau du Relais fonctionnent quand même (relance l'application pour retrouver la fenêtre).

## Où sont mes données ?

Dans le dossier de configuration de ton compte :

- Windows : `%APPDATA%\Sklubot\`
- macOS : `~/Library/Application Support/Sklubot/`
- Linux : `~/.config/Sklubot/`

`sklubot.json` : adresse du serveur de la fenêtre et taille de la fenêtre. `relais.json` : adresse du serveur du Relais, autorisations des bots, dossiers partagés et jeton d'accès (chiffré par le trousseau du système quand il est disponible ; fichier lisible par toi seul). `logs/actions.log` : journal des actions du Relais. Le reste (cookies de connexion, cache) appartient au moteur de la fenêtre. Pour tout effacer : quitte Sklubot et supprime ce dossier.

---

## Pour les développeurs

Choix techniques : **Electron** (fenêtres, icône, raccourci global, capture d'écran avec `desktopCapturer`, chiffrement avec `safeStorage`, paquets via **electron-builder**) et **[@jitsi/robotjs](https://github.com/jitsi/robotjs)** pour la souris et le clavier (MIT, binaires N‑API précompilés pour Windows, macOS universel et Linux — aucune compilation à l'installation, compatible Electron sans reconstruction).

Organisation :

- `src/main/main.js` : processus principal (Relais + branchement de la fenêtre) ; `app-window.js` : fenêtre Sklubot, écran du premier lancement, menu, badge, recherche de mise à jour ; `desktop-core.js` : règles pures et testées (adresse du serveur, origine autorisée, liens externes, permissions, versions, migration) ; `app-settings.js` : `sklubot.json`.
- `src/preload/web-preload.js` : seul pont donné au site (`window.sklubotDesktop.setBadge(n)`, `.focus()`), accepté uniquement depuis la fenêtre principale affichant l'origine du serveur. Côté web : `web/src/lib/desktop.ts` (sans effet dans un navigateur).
- Sécurité de la fenêtre : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, partition persistante dédiée `persist:sklubot` (les fenêtres locales du Relais gardent la session par défaut où tout est refusé), navigation limitée à l'origine du serveur (`will-navigate`, `will-redirect`, `setWindowOpenHandler`), permissions accordées à cette origine seulement (`setPermissionRequestHandler` / `setPermissionCheckHandler`). La fenêtre de connexion des applications connectées (`sklubot-oauth`, `web/src/lib/oauth.ts`) peut parcourir les pages `https` du fournisseur, sans pont ni permission.
- Icônes : `npm run icons` (sous Linux sans écran : `xvfb-run -a npm run icons`) les régénère à partir du logo `web/public/icon.svg` : `build/icon.png`, `build/icons/*.png`, `build/icon.ico`, `build/icon.icns`, `assets/icon.png`, `assets/tray-*.png`, `assets/badge.png`.

```bash
cd companion
npm ci
npm start                      # lance Sklubot (mode développement)
node test/fake-server.js 8787  # faux serveur Sklubot local pour le Relais ; adresse : http://127.0.0.1:8787
npm test                       # tests unitaires (Node)
npm run typecheck
npm run test:e2e               # bout en bout sous Xvfb (Linux) : Xvfb, ImageMagick, openbox, wmctrl, xdotool
npm run test:e2e:server        # le vrai Relais face au vrai serveur Sklubot (../server, lancé avec tsx, modèle démo)
npm run dist:linux             # AppImage + .deb dans dist/
npm run dist:linux:dir && npm run test:packaged   # bout en bout sur la version empaquetée
npm run dist:win               # sur Windows (NSIS + zip) ; depuis Linux, NSIS demande Wine
npm run dist:win:zip           # Windows sans installation, constructible depuis Linux
npm run dist:mac               # sur macOS uniquement
```

- Les fichiers produits s'appellent `Sklubot-<version>-<os>.<ext>` (`linux`, `win`, `mac`). Copiés dans `web/public/download/`, le serveur les propose sur `/telecharger` et dans **Réglages › Ordinateurs** (`GET /api/downloads`, public).
- Publication : workflow GitHub Actions à relire, [`.github-workflow-example.yml`](.github-workflow-example.yml) (tag `desktop-vX.Y.Z` → construction Linux, Windows, macOS sur leurs propres machines → Release GitHub avec les fichiers et `SHA256SUMS.txt`).
- Protocole du Relais : [`docs/RELAIS-PROTOCOLE.md`](../docs/RELAIS-PROTOCOLE.md) (inchangé ; l'application s'annonce toujours `sklubot-relais` dans le `hello`).
- Sous Linux en root (conteneurs), Electron exige `--no-sandbox` ; les scripts de test l'ajoutent.
- `SKLUBOT_RELAIS_TEST_AUTOCONFIRM=1` accepte automatiquement les demandes de consentement **uniquement** en développement (`app.isPackaged === false`) ; une version empaquetée l'ignore. Le serveur ne peut pas le régler.
- Variables pour les tests : `SKLUBOT_DATA_DIR` (ou `SKLUBOT_RELAIS_DATA_DIR`) : dossier de données ; `SKLUBOT_RELAIS_SERVER` : adresse pré‑remplie du Relais (l'appairage reste obligatoire) ; `SKLUBOT_NO_UPDATE_CHECK=1` : pas de recherche de mise à jour.
- Signature : macOS — `CSC_LINK`/`CSC_KEY_PASSWORD` (certificat « Developer ID Application ») et, pour la notarisation, `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (ou `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`) ([electron-builder](https://www.electron.build/docs/notarization)) ; Windows — `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`. Sans ces variables, les paquets sont produits non signés.
- Mise à jour automatique (electron-updater) volontairement absente : sur macOS elle exige une application signée, et sur Windows la vérification de signature de l'installateur n'a de sens qu'avec un certificat ([electron-builder, Auto Update](https://www.electron.build/docs/auto-update)). À reconsidérer une fois les certificats en place.
