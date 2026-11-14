# Sklubot Relais

Le Relais est un petit programme à installer **sur ton propre ordinateur** (Windows, macOS ou Linux). Il permet à tes bots Sklubot de voir ton écran et d'utiliser ta souris et ton clavier — **seulement quand tu l'acceptes, sur cet ordinateur**.

- Il se connecte à **ton** serveur Sklubot ; il n'ouvre aucun port sur ton ordinateur.
- Il ne tourne que quand tu le lances (démarrage automatique désactivé par défaut).
- Chaque bot doit te demander la permission la première fois ; chaque commande système t'est montrée avant d'être lancée.
- Un bandeau rouge reste affiché tant qu'un bot a la main. **Stop** (ou **Ctrl + Alt + Maj + S**, **⌘ ⌥ ⇧ S** sur Mac) arrête tout tout de suite et bloque le Relais jusqu'à ce que tu le réautorises.
- Tout ce que font les bots est noté dans un journal sur ton ordinateur (bouton « Ouvrir le journal »).
- « Mettre en pause » coupe la connexion : rien n'est envoyé pendant la pause.

## Installer

Télécharge le fichier qui correspond à ton ordinateur :

| Système | Fichier | Remarques |
|---|---|---|
| Windows 10/11 | `Sklubot-Relais-…-win-x64.exe` (installateur) ou `…-win-x64.zip` (sans installation) | voir « Windows » plus bas |
| macOS 11 ou plus récent (Intel et Apple Silicon) | `Sklubot-Relais-…-mac-universal.dmg` | voir « macOS » plus bas |
| Linux (Ubuntu, Debian…) | `Sklubot-Relais-…-linux-amd64.deb` (conseillé) | `sudo apt install ./Sklubot-Relais-…-linux-amd64.deb` |
| Linux (autres) | `Sklubot-Relais-…-linux-x86_64.AppImage` ou `….tar.gz` | rendre l'AppImage exécutable, puis double‑clic |

Aucune installation de Node.js n'est nécessaire.

## Première utilisation

1. Lance **Sklubot Relais**.
2. Tape l'adresse de ton serveur Sklubot (elle doit commencer par `https://`), puis **Continuer**.
3. Un code à 8 caractères s'affiche (par exemple `K7QM-2XPA`).
4. Dans l'application Sklubot : **Réglages › Ordinateurs › Relier un ordinateur**, tape ce code.
5. C'est relié. La prochaine fois, le Relais se reconnecte tout seul quand tu le lances.

Quand un bot demande la main, une fenêtre s'ouvre : **Autoriser cette fois**, **Toujours autoriser ce bot** ou **Refuser**. Sans réponse en 60 secondes, c'est refusé. Tu peux retirer une autorisation à tout moment dans la fenêtre du Relais (section « Bots »).

Pour tout effacer : **Oublier ce serveur** (l'adresse, l'accès et les autorisations des bots sont supprimés de cet ordinateur).

Fermer la fenêtre ne quitte pas le Relais : il reste dans la barre des tâches / la barre des menus. Pour le quitter : clic sur son icône › **Quitter le Relais**. Relancer le Relais rouvre sa fenêtre.

## Autorisations à donner selon ton système

### macOS

macOS demande deux autorisations, à donner une fois :

1. **Enregistrement de l'écran** (pour que le bot voie l'écran) : menu Pomme › Réglages Système › Confidentialité et sécurité › **Enregistrement de l'écran et de l'audio du système** › active « Sklubot Relais ». ([aide Apple](https://support.apple.com/guide/mac-help/mchld6aa7d23/mac))
2. **Accessibilité** (pour la souris et le clavier) : menu Pomme › Réglages Système › Confidentialité et sécurité › **Accessibilité** › active « Sklubot Relais ». ([aide Apple](https://support.apple.com/guide/mac-help/mh43185/mac))

La fenêtre du Relais indique si elles sont accordées et propose un bouton « Ouvrir les réglages ». Après les avoir activées, quitte et relance le Relais.

Si le Relais n'est pas signé et notarisé par Apple, macOS refuse de l'ouvrir la première fois : Réglages Système › Confidentialité et sécurité › section Sécurité › **Ouvrir quand même**. ([aide Apple](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac)) Une version signée et notarisée n'a pas besoin de cette étape.

### Windows

- Au premier lancement, si l'installateur n'est pas signé, Windows peut afficher « Windows a protégé votre ordinateur » (SmartScreen) : clique **Informations complémentaires** puis **Exécuter quand même**. Une version signée avec un certificat de signature de code évite ou réduit cet avertissement.
- Aucune autre autorisation n'est nécessaire. Limite de Windows : le Relais ne peut pas piloter les fenêtres lancées « en tant qu'administrateur » (ni l'écran de confirmation UAC) s'il ne tourne pas lui‑même en administrateur — et il ne faut pas le lancer en administrateur.

### Linux

- **Session X11 (Xorg) : tout fonctionne.**
- **Session Wayland : soyons honnêtes, ça ne marche presque pas.** Wayland interdit volontairement à une application de voir tout l'écran ou de simuler la souris et le clavier dans les autres fenêtres. Le Relais tourne en mode X11 (XWayland) : il ne voit et ne pilote au mieux que les applications X11, et la capture d'écran peut demander ton accord à chaque fois ou rester noire. Le raccourci Stop global peut aussi ne pas être disponible (utilise le bouton Stop du bandeau). **Solution :** à l'écran de connexion, choisis une session « Xorg » (sur Ubuntu : roue dentée › « Ubuntu sur Xorg »). La fenêtre du Relais affiche un avertissement si une session Wayland est détectée.
- `window.focus` (mettre une fenêtre au premier plan) a besoin du petit outil `wmctrl` : `sudo apt install wmctrl`.
- Sur certaines distributions récentes, l'AppImage peut refuser de démarrer (FUSE ou bac à sable Chromium). Dans ce cas, utilise le paquet `.deb` ou le `.tar.gz`.
- L'icône dans la barre du haut demande, sous GNOME, l'extension « AppIndicator ». Sans elle, le bandeau Stop et la fenêtre du Relais fonctionnent quand même.

## Où sont mes données ?

Dans le dossier de configuration de ton compte :

- Windows : `%APPDATA%\Sklubot Relais\`
- macOS : `~/Library/Application Support/Sklubot Relais/`
- Linux : `~/.config/Sklubot Relais/`

`relais.json` contient l'adresse du serveur, les autorisations des bots et le jeton d'accès (chiffré par le trousseau du système quand il est disponible ; fichier lisible par toi seul). `logs/actions.log` est le journal des actions.

---

## Pour les développeurs

Choix techniques : **Electron** (fenêtres, icône, raccourci global, capture d'écran avec `desktopCapturer`, chiffrement avec `safeStorage`, paquets via **electron-builder**) et **[@jitsi/robotjs](https://github.com/jitsi/robotjs)** pour la souris et le clavier (MIT, maintenu par Jitsi pour le contrôle à distance de Jitsi Meet, binaires N‑API précompilés pour Windows x64/arm64/ia32, macOS universel et Linux x64/arm64 — aucune compilation à l'installation, compatible Electron sans reconstruction). `@nut-tree-fork/nut-js` a été écarté : dernière publication en mars 2025.

```bash
cd companion
npm ci
npm start                      # lance le Relais (mode développement)
node test/fake-server.js 8787  # faux serveur Sklubot local ; adresse : http://127.0.0.1:8787
npm test                       # tests unitaires (Node)
npm run typecheck
npm run test:e2e               # bout en bout sous Xvfb (Linux) : Xvfb, ImageMagick ; openbox + wmctrl conseillés
npm run dist:linux             # AppImage + .deb + .tar.gz dans dist/
npm run dist:linux:dir && npm run test:packaged   # bout en bout sur la version empaquetée
npm run dist:win               # sur Windows (ou Linux avec Wine 32+64 bits pour NSIS)
npm run dist:win:zip           # Windows portable, constructible depuis Linux
npm run dist:mac               # sur macOS uniquement
```

- Protocole : [`docs/RELAIS-PROTOCOLE.md`](../docs/RELAIS-PROTOCOLE.md).
- Sous Linux en root (conteneurs), Electron exige `--no-sandbox` ; les scripts de test l'ajoutent.
- `SKLUBOT_RELAIS_TEST_AUTOCONFIRM=1` accepte automatiquement les demandes de consentement **uniquement** en développement (`app.isPackaged === false`) ; une version empaquetée l'ignore. Le serveur ne peut pas le régler.
- `SKLUBOT_RELAIS_DATA_DIR` (dossier de données) et `SKLUBOT_RELAIS_SERVER` (adresse pré‑remplie, l'appairage reste obligatoire) servent aux tests.
- Signature : macOS — `CSC_LINK`/`CSC_KEY_PASSWORD` (certificat « Developer ID Application ») et, pour la notarisation, `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (ou `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`) ([electron-builder](https://www.electron.build/docs/notarization)) ; Windows — `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`. Sans ces variables, les paquets sont produits non signés. Exemple de CI : [`.github-workflow-example.yml`](.github-workflow-example.yml).
