# Mettre Sklubot en ligne, et l'avoir sur ton téléphone

## 1. Mise en ligne (Coolify ou tout serveur avec Docker)

Il te faut un serveur Linux avec Docker, et un nom de domaine. Compte 2 Go de mémoire par ordinateur de bot
éveillé (4 au maximum par défaut), plus environ 1 Go pour Sklubot lui-même.

**Avec Coolify**

1. Nouveau projet → *Docker Compose* → ce dépôt, branche de ton choix, fichier `docker-compose.coolify.yml`.
2. Dans les variables d'environnement, recopie `.env.coolify.example` et remplis :
   - `SKLUBOT_PUBLIC_URL` : l'adresse publique, par exemple `https://bots.exemple.fr` (exactement celle que tu
     tapes dans le navigateur : les connexions OAuth aux applications reviennent sur
     `<adresse>/api/connectors/oauth/callback`) ;
   - `SKLUBOT_SESSION_SECRET` : le résultat de `openssl rand -hex 32` ;
   - une clé de modèle (`ANTHROPIC_API_KEY`), ou `SKLUBOT_DEMO_MODE=1` pour essayer sans clé ;
   - `SKLUBOT_SETUP_CODE` : un code au hasard (par exemple le résultat de `openssl rand -hex 6`), demandé
     pour créer le premier compte.
3. Associe ton domaine au service `sklubot`, port `3000`. Coolify s'occupe du HTTPS.
4. Déploie. La première fois, la construction de l'image de l'ordinateur des bots prend quelques minutes.
5. Ouvre l'adresse et crée ton compte avec le code `SKLUBOT_SETUP_CODE` : le premier compte créé est le tien,
   les inscriptions se ferment ensuite (le code ne sert plus ensuite).

**Sans Coolify**

```bash
cp .env.coolify.example .env        # puis remplis-le
docker compose -f docker-compose.coolify.yml up -d --build
```

Sklubot écoute alors sur le port 3000 du conteneur ; place un proxy HTTPS (Caddy, Traefik, nginx) devant.

**À savoir**

- Sklubot crée l'ordinateur Linux de chaque bot à travers le service `docker-proxy`, le seul à monter
  `/var/run/docker.sock` : il n'ouvre que la partie de l'API Docker utile (conteneurs, exec, volumes, images,
  réseaux), sur un réseau interne que les ordinateurs des bots ne voient pas. Cela reste un accès puissant au
  Docker du serveur : réserve ce serveur à Sklubot.
- L'application tourne sans privilège Linux et sur un système de fichiers en lecture seule (seuls `/data` et
  `/tmp` s'écrivent).
- Le point d'accès `/mcp/…` sert uniquement aux ordinateurs des bots (réseau interne) : Sklubot refuse toute
  requête qui y arrive par un proxy. Avec le fichier VPS, Caddy le bloque aussi.
- Toutes les données sont dans le volume `sklubot_data` (base, fichiers des bots). Sauvegarde-le.
- Le HTTPS est nécessaire pour le micro (dictée, appel vocal) et pour l'installation sur iPhone.

## 2. iPhone et iPad

1. Ouvre l'adresse de ton Sklubot dans **Safari**.
2. Touche **Partager**, puis **Sur l'écran d'accueil**.
3. Sklubot apparaît comme une application et s'ouvre en plein écran.

## 3. Android

1. Sur le téléphone, ouvre Sklubot dans le navigateur → **Réglages → Général → Sur ton téléphone →
   Télécharger l'APK** (ou directement `https://ton-adresse/download/sklubot.apk`).
2. Ouvre le fichier et autorise l'installation depuis cette source.
3. Au premier lancement, saisis l'adresse de ton Sklubot. Pour en changer plus tard : appui long sur
   l'icône de l'application → **Changer de serveur**.

L'application Android affiche ton Sklubot en plein écran et gère l'envoi de fichiers, les téléchargements
et le bouton retour. La dictée et l'appel vocal n'y fonctionnent pas (la reconnaissance vocale du
navigateur n'existe pas dans ce type d'application) : utilise Chrome pour cela.

### Recompiler l'APK

Il faut le kit de développement Android (plateforme 35) et Java 17 ou plus récent.

```bash
cd android
echo "sdk.dir=/chemin/vers/android-sdk" > local.properties
gradle assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../web/public/download/sklubot.apk
```

Pour signer, crée `android/keystore.properties` (jamais commité) :

```properties
storeFile=/chemin/vers/sklubot-release.jks
storePassword=…
keyAlias=sklubot
keyPassword=…
```

**Garde précieusement le fichier de clé et son mot de passe** : une mise à jour de l'application ne
s'installe par-dessus l'ancienne que si elle est signée avec la même clé.
