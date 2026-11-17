# Sauvegarder et restaurer Sklubot (VPS et Coolify)

Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde. Deux façons, complémentaires :

- **la sauvegarde automatique de l'application** (Réglages → Compte → « Sauvegarde automatique ») : se règle depuis
  un téléphone, sans SSH, et envoie chaque nuit une copie **chiffrée** hors du serveur, vers un stockage S3
  (OVHcloud, Hetzner, Scaleway…). Elle ne contient pas les ordinateurs des bots (voir [plus bas](#sauvegarde-automatique-depuis-lapplication-sans-ssh)) ;
- **les scripts** ci-dessous, en SSH sur la machine : sauvegarde complète, ordinateurs des bots compris.

Sklubot fournit trois scripts, à lancer **sur la machine qui fait tourner Docker** (le VPS, ou le serveur que Coolify
pilote, en SSH) :

| Script | Rôle |
|---|---|
| `deploy/backup.sh` | sauvegarde complète, **sans arrêter Sklubot** |
| `deploy/restore-drill.sh` | exercice : restaure la dernière sauvegarde dans une copie isolée, la vérifie, puis la détruit |
| `deploy/restore.sh` | vraie restauration (remplace les données en service) |

## Ce que contient une sauvegarde

L'archive `sklubot-sauvegarde-AAAAMMJJ-HHMMSS.tar` contient :

- `db.sqlite` : la base (comptes, bots, conversations, mémoires, routines, coffre chiffré…), **copiée en ligne** de façon
  cohérente avec `VACUUM INTO` ([doc SQLite](https://www.sqlite.org/lang_vacuum.html#vacuuminto)) par le Node de l'image
  Sklubot (`node:sqlite`) : pas besoin de `sqlite3` sur le serveur, et Sklubot continue de répondre ;
- `data.tar.gz` : le reste du volume `sklubot_data` (bibliothèques des bots, dossier d'équipe, `botlink`, pages…) ;
- `homes/sklubot-home-*.tar.gz` : le dossier personnel de chaque ordinateur (bots **et** ordinateurs partagés :
  connexions Claude / ChatGPT, outils installés). Un ordinateur allumé est mis en pause (`docker pause`) le temps de sa
  seule copie, puis repart là où il en était ;
- les **secrets** qui déchiffrent le coffre et les connexions (`SESSION_SECRET`, clés d'API) : le fichier `.env` du VPS,
  et l'environnement du conteneur Sklubot (sous Coolify, c'est là que sont les variables saisies dans Coolify) —
  **chiffrés** dans `secrets.env.age` ou `secrets.env.enc` (voir ci-dessous) ;
- `manifest.json` (date, intégrité de la base, nombre de comptes / bots / messages…, version du schéma) et
  `SHA256SUMS` (empreintes de chaque fichier, vérifiées à la restauration).

Ne sont pas sauvegardés : les certificats HTTPS (`caddy_data`, réémis seuls) et les modèles de voix (retéléchargés).

## Chiffrer les secrets (à faire une fois)

Sans `SESSION_SECRET`, une sauvegarde ne rouvre ni le coffre ni les connexions. Mais il ne doit pas traîner en clair à
côté des archives. Deux façons, à mettre dans le `.env` de `/opt/sklubot` (ou en variables d'environnement du cron) :

**Recommandé : une clé `age`** (`apt install age`). La clé **privée** reste hors du serveur (ton ordinateur, un
gestionnaire de mots de passe) ; le serveur n'a que la clé publique, il peut chiffrer mais pas relire.
```bash
age-keygen -o sklubot-sauvegarde.key        # SUR TON ORDINATEUR ; garde ce fichier précieusement
# il affiche « Public key: age1… » : sur le serveur, dans .env :
SKLUBOT_BACKUP_AGE_RECIPIENT=age1xxxxxxxx…
```

**Sinon : une phrase de passe** (openssl, présent partout) :
```bash
sudo install -m 600 /dev/null /root/.sklubot-backup-pass && sudo nano /root/.sklubot-backup-pass   # une longue phrase
SKLUBOT_BACKUP_PASSPHRASE_FILE=/root/.sklubot-backup-pass
```
Garde aussi une copie de cette phrase **hors du serveur** : si le serveur disparaît, le fichier aussi.

Sans aucun des deux, le script écrit les secrets **à part, en clair** dans `DOSSIER/secrets/` (droits 600, jamais
envoyés à la copie distante) et affiche un avertissement à chaque sauvegarde.

## Sauvegarder

```bash
bash deploy/backup.sh /opt/sklubot-sauvegardes
```
Réglages (variables d'environnement ou `.env`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `SKLUBOT_BACKUP_DIR` | `./sauvegardes` | dossier des archives (ou 1er argument) |
| `SKLUBOT_BACKUP_KEEP_DAILY` | 7 | les N archives les plus récentes sont gardées |
| `SKLUBOT_BACKUP_KEEP_WEEKLY` | 4 | en plus, la plus récente de chacune des N semaines précédentes |
| `SKLUBOT_BACKUP_REMOTE` | (vide) | copie hors du serveur : `rclone:<remote>:<chemin>` ou `rsync:<user@hôte:/chemin>` |
| `SKLUBOT_BACKUP_AGE_RECIPIENT` / `SKLUBOT_BACKUP_PASSPHRASE_FILE` | (vide) | chiffrement des secrets (ci-dessus) |
| `SKLUBOT_DATA_VOLUME` | `sklubot_data` | volume des données |
| `SKLUBOT_APP_IMAGE` | image du conteneur Sklubot | image utilisée pour la copie (contient Node) |

Options : `--keep-daily N`, `--keep-weekly N`, `--remote CIBLE`, `--no-homes` (sans les ordinateurs).

**Copie hors du serveur (fortement conseillée, facultative).** Une sauvegarde sur le même disque ne protège pas d'une
panne du serveur. Avec [rclone](https://rclone.org/docs/) (S3, Backblaze B2, Google Drive, SFTP…) : `rclone config` une
fois pour créer un « remote », puis `SKLUBOT_BACKUP_REMOTE=rclone:monremote:sklubot`. Avec rsync vers une autre machine
(clé SSH sans mot de passe) : `SKLUBOT_BACKUP_REMOTE=rsync:sauvegarde@autre-serveur:/srv/sklubot`. La rotation de la
copie distante se règle chez elle (cycle de vie du bucket, ou un `rclone delete --min-age 60d`).

Chaque sauvegarde écrit aussi son résultat dans le volume (`backup-status.json`) : `/api/health` passe en
« degraded » (`backup_old`) si la dernière sauvegarde réussie a plus de 26 h, ou (`backup_failed`) si elle a échoué.

**Automatique, chaque nuit** (`crontab -e` en root sur le VPS) :
```
17 3 * * * cd /opt/sklubot && bash deploy/backup.sh /opt/sklubot-sauvegardes >> /var/log/sklubot-backup.log 2>&1
```
`deploy/update.sh` fait aussi une sauvegarde **avant** chaque mise à jour (et s'arrête si elle échoue).

## Vérifier qu'une sauvegarde se restaure : l'exercice

```bash
SKLUBOT_BACKUP_AGE_IDENTITY=/chemin/vers/sklubot-sauvegarde.key bash deploy/restore-drill.sh /opt/sklubot-sauvegardes
# (avec une phrase de passe : SKLUBOT_BACKUP_PASSPHRASE_FILE=… ; sans rien, elle est demandée au clavier)
```
Le script prend la dernière archive, vérifie ses empreintes, déchiffre ses secrets, la restaure dans un **projet Docker
Compose isolé** (`sklubot-drill-…`, son propre volume, **sans aucun réseau** : il ne peut joindre ni Internet, ni les
bots, ni l'installation en service ; planificateur, Telegram, courrier et ordinateurs coupés), le démarre avec l'image
actuelle (ce qui essaie aussi les migrations de base sur tes vraies données), attend `/api/health`, compare le nombre de
comptes, bots, messages, mémoires, routines… au manifeste, vérifie `PRAGMA integrity_check`, **déchiffre une valeur du
coffre ou d'une connexion** avec le `SESSION_SECRET` de la sauvegarde, puis détruit tout. Rapport à l'écran et dans
`DOSSIER/restore-drill-dernier.txt` ; code de sortie 0 seulement si tout est vert. La clé privée age n'a besoin d'être
sur le serveur que le temps de l'exercice.

Fréquence conseillée : **sauvegarde chaque nuit, exercice chaque semaine**, par exemple le dimanche (la clé privée ne
devant pas rester sur le serveur, l'exercice hebdomadaire se fait à la main, ou avec une phrase de passe dédiée) :
```
47 4 * * 0 cd /opt/sklubot && SKLUBOT_BACKUP_PASSPHRASE_FILE=/root/.sklubot-backup-pass bash deploy/restore-drill.sh /opt/sklubot-sauvegardes >> /var/log/sklubot-drill.log 2>&1
```

## Restaurer pour de vrai

```bash
bash deploy/restore.sh /opt/sklubot-sauvegardes/sklubot-sauvegarde-….tar
```
Vérifie les empreintes, puis remplace toutes les données actuelles (le script demande de taper `OUI`) et relance
Sklubot (VPS). Remets ensuite le `SKLUBOT_SESSION_SECRET` de la sauvegarde dans `.env` (le script affiche la commande pour
relire les secrets chiffrés : `tar xOf <archive> ./secrets.env.age | age -d -i <clé>`). Les archives de l'ancien format
(base dans `data.tar.gz`) se restaurent aussi.

## Coolify

Les volumes portent les mêmes noms (`sklubot_data`, `sklubot-home-*`) : les scripts marchent tels quels **sur la
machine** que Coolify pilote. Ils trouvent seuls le conteneur Sklubot (le service compose `sklubot`, quel que soit le
nom que Coolify lui donne) et lisent les secrets dans son environnement (les variables saisies dans Coolify).

1. En SSH sur le serveur, une fois : récupérer les scripts (pas besoin du reste) et régler le chiffrement :
   ```bash
   sudo git clone --depth 1 <adresse-du-dépôt> /opt/sklubot-ops   # ou copier deploy/ seulement
   sudo apt install -y age && sudo nano /opt/sklubot-ops/.env      # SKLUBOT_BACKUP_AGE_RECIPIENT=age1… (+ REMOTE)
   ```
2. Sauvegarde chaque nuit (`sudo crontab -e`) :
   ```
   17 3 * * * cd /opt/sklubot-ops && bash deploy/backup.sh /opt/sklubot-sauvegardes >> /var/log/sklubot-backup.log 2>&1
   ```
3. Exercice : `cd /opt/sklubot-ops && SKLUBOT_BACKUP_AGE_IDENTITY=… bash deploy/restore-drill.sh /opt/sklubot-sauvegardes`
   (chaque semaine, voir plus haut). Mets à jour `/opt/sklubot-ops` (`git pull`) quand tu mets Sklubot à jour.
4. **Tâche planifiée Coolify (complément, pas un remplacement).** Les tâches planifiées de Coolify lancent une commande
   *dans* un conteneur du service ([doc Coolify](https://coolify.io/docs/applications/operations/scheduled-tasks)) : elles
   ne voient ni les autres volumes ni le disque de l'hôte. Elles peuvent faire une copie cohérente de la base dans le
   volume, utile contre une mauvaise mise à jour ou un fichier abîmé (pas contre la perte du serveur) :
   Coolify → ton application → **Scheduled Tasks** → *Add* : nom `copie-base`, commande
   `node server/dist/backupcheck.js snapshot 7`, conteneur `sklubot`, fréquence `30 2 * * *`. Les copies vont dans
   `sklubot_data/db-snapshots/` (les 7 dernières) ; vérifie avec **Execute Now**.
5. Restaurer sous Coolify : arrête l'application dans Coolify, `SKLUBOT_RESTORE_YES=OUI bash deploy/restore.sh <archive>`
   en SSH, remets le même `SKLUBOT_SESSION_SECRET` dans les variables Coolify, puis redémarre depuis Coolify.

## Sauvegarde automatique depuis l'application (sans SSH)

Réglages → **Compte** → **Sauvegarde automatique** (visible du seul propriétaire du serveur : le premier compte créé).
Chaque nuit à l'heure choisie (dans ton fuseau horaire ; rattrapée dans les 6 heures si le serveur était arrêté), et
quand tu appuies sur **Sauvegarder maintenant**, Sklubot :

1. copie la base de façon cohérente (`VACUUM INTO`, dans un fil à part : l'application continue de répondre) ;
2. met en archive (tar, au fil de l'eau) la copie de la base, le dossier de données et les **secrets** du conteneur
   (`SESSION_SECRET`, clés d'API… : sans eux, coffre et connexions ne se rouvrent pas) ;
3. compresse (gzip) et **chiffre** l'archive avant qu'elle ne quitte le serveur ([format age v1](https://age-encryption.org/v1),
   destinataire X25519) ;
4. l'envoie en plusieurs morceaux (envoi « multipart » S3 : un seul morceau de 16 Mo en mémoire à la fois ; fichiers
   temporaires seulement dans `DATA_DIR/.backup-app-tmp`, effacés après) ;
5. supprime les anciennes : garde les **N plus récentes** et la plus récente de chacune des **M semaines** d'avant (les
   autres fichiers du bucket ne sont jamais touchés) ;
6. écrit son résultat dans `backup-status.json` (le même que lit `/api/health` : `backup_old` après 26 h,
   `backup_failed` après un échec). **Deux échecs de suite** : un message dans ta conversation principale et une
   notification sur ton téléphone.

Une seule sauvegarde à la fois, en arrière-plan ; chaque requête vers le stockage a un délai maximal, la sauvegarde
entière aussi (`AUTO_BACKUP_TIMEOUT_HOURS`, 6 h). Taille des morceaux : `AUTO_BACKUP_PART_MB` (16, minimum 5).

**Contenu de l'archive** `sklubot-auto-AAAAMMJJ-HHMMSS.tar.gz.age` (heure UTC) : `manifest.json` (format 3, comptes de
lignes comme celles de `backup.sh`), `secrets.env`, `db.sqlite`, `data/…` (bibliothèques des bots, dossiers d'équipe,
profils de navigateur sans leurs caches, enregistrements…), puis `SHA256SUMS`. Laissés de côté : les fichiers vivants
de la base (remplacés par la copie), les copies `db-snapshots/` et d'avant migration, `botlink/` (prises des bots),
`desk-test/`, les caches des navigateurs.

**Pas dedans : les ordinateurs des bots** (volumes `sklubot-home-*`). Le conteneur de l'application ne les voit pas, et
ne doit pas les voir (il n'a accès à Docker qu'à travers le proxy filtrant). Après une restauration, les installations
et les connexions faites sur ces ordinateurs (Claude Code, Codex…) sont à refaire. `deploy/backup.sh` (SSH) les inclut :
les deux se complètent.

### La clé : pourquoi une paire de clés et pas une phrase de passe

Le serveur doit chiffrer la nuit, sans toi. Avec une phrase de passe, il devrait la garder lisible (scellée avec
`SESSION_SECRET`) : qui prend le serveur aurait à la fois les accès au stockage **et** de quoi lire toutes les
sauvegardes. Ici, ton navigateur fabrique une paire de clés age (WebCrypto X25519) : la **clé privée**
(`AGE-SECRET-KEY-1…`) t'est donnée à télécharger et ne quitte jamais ton appareil ; le serveur ne reçoit que la **clé
publique** (`age1…`), qui sait chiffrer mais pas déchiffrer. Ni le fournisseur du stockage, ni quelqu'un qui volerait
les clés du bucket ou le serveur lui-même ne peut lire les sauvegardes. En contrepartie : **sans la clé privée, personne
ne peut restaurer.** Garde le fichier dans un gestionnaire de mots de passe et sur un second support. Tu peux aussi
coller la clé publique d'une clé faite avec `age-keygen` (la même que `SKLUBOT_BACKUP_AGE_RECIPIENT`).

Les clés d'accès du bucket sont chiffrées dans la base (`seal`, avec `SESSION_SECRET`) et ne sont jamais renvoyées au
navigateur. Donne de préférence une clé qui n'a accès qu'à ce bucket.

### Régler depuis un téléphone

**OVHcloud** ([premiers pas](https://docs.ovhcloud.com/fr/guides/storage-and-backup/object-storage/s3-getting-started-with-object-storage),
[adresses par région](https://docs.ovhcloud.com/fr/guides/storage-and-backup/object-storage/s3-location)) — adresse
`https://s3.<région>.io.cloud.ovh.net` (ex. `gra`, `rbx`, `sbg`, `eu-west-par`, `de`, `uk`, `waw`…) :
1. Espace client → Public Cloud → ton projet → Stockage → **Object Storage** ;
2. onglet **Utilisateurs** : crée un utilisateur Object Storage ; note la clé d'accès et la clé secrète (bouton `…` →
   *Afficher la clé secrète*) ;
3. onglet **Conteneurs** → *Créer un conteneur d'objets* : type *API compatible S3*, nom en minuscules
   (ex. `sklubot-sauvegardes`), région, associe l'utilisateur, *Créer*.

**Hetzner** ([créer un bucket](https://docs.hetzner.com/storage/object-storage/getting-started/creating-a-bucket),
[créer les clés](https://docs.hetzner.com/storage/object-storage/getting-started/generating-s3-keys)) — adresse
`https://<emplacement>.your-objectstorage.com` (`fsn1`, `nbg1`, `hel1`) :
1. Hetzner Console → ton projet → **Object Storage** → *Create Bucket* : emplacement, nom unique, visibilité *private* ;
2. **Security** → onglet **S3 Credentials** → *Generate credentials* ; copie tout de suite les deux clés (la clé
   secrète n'est affichée qu'une fois).

**Scaleway** ([créer un bucket](https://www.scaleway.com/fr/docs/object-storage/how-to/create-a-bucket/),
[clés d'API](https://www.scaleway.com/en/docs/iam/how-to/create-api-keys/), [adresses](https://www.scaleway.com/en/docs/object-storage/concepts/))
— adresse `https://s3.<région>.scw.cloud` (`fr-par`, `nl-ams`, `pl-waw`, `it-mil`) :
1. Console → **Object Storage** → *+ Create bucket* : région, nom, *Private* ;
2. menu du compte → **IAM & API keys** → onglet *API keys* → *+ Generate API key* ; pour Object Storage, choisis le
   projet du bucket comme projet préféré ; copie les deux clés (la secrète n'est affichée qu'une fois).

Puis dans Sklubot : **1.** *Créer ma clé de sauvegarde* → télécharge le fichier → coche « J'ai enregistré… » → *Utiliser
cette clé* ; **2.** fournisseur, région, nom du bucket, clé d'accès, clé secrète → *Tester la connexion* (écrit, relit,
liste et supprime un petit fichier) ; **3.** heure et nombre à garder → *Enregistrer* → *Sauvegarder maintenant*.
Les trois fournisseurs documentent l'adressage « virtual-hosted » (`https://<bucket>.<adresse>`), utilisé par défaut ;
pour un autre stockage (MinIO…), « Autre stockage compatible S3 » propose l'adressage de type chemin.

### Restaurer une sauvegarde automatique

Il faut : le fichier de la clé privée, les accès au bucket, et un serveur où Sklubot est installé (même vide). Les
commandes tournent **dans l'image de Sklubot** (elle contient Node et l'outil) ; aucune n'a besoin d'`age`, mais
`age -d -i cle.txt <archive>` marche aussi (format standard).

1. Télécharger et vérifier la dernière sauvegarde (déchiffrement complet + empreintes de chaque fichier). Les accès au
   bucket passent par l'environnement, pas par la ligne de commande :
   ```bash
   mkdir -p /root/restauration && cp cle.txt /root/restauration/ && chmod 600 /root/restauration/cle.txt
   docker run --rm -v /root/restauration:/r \
     -e SKLUBOT_S3_ENDPOINT=https://s3.gra.io.cloud.ovh.net -e SKLUBOT_S3_REGION=gra \
     -e SKLUBOT_S3_BUCKET=sklubot-sauvegardes -e SKLUBOT_S3_PREFIX=sklubot/ \
     -e SKLUBOT_S3_ACCESS_KEY -e SKLUBOT_S3_SECRET_KEY \
     sklubot-server node server/dist/backupcheck.js restore-from-s3 --identity /r/cle.txt --out /r
   ```
   (exporte d'abord `SKLUBOT_S3_ACCESS_KEY` et `SKLUBOT_S3_SECRET_KEY` dans le terminal ; `--name sklubot-auto-….tar.gz.age`
   pour une autre que la dernière ; `s3-list` les liste ; sous Coolify, l'image est celle du conteneur Sklubot).
2. Exercice sans risque, dans une copie isolée sans réseau :
   `SKLUBOT_BACKUP_AGE_IDENTITY=/root/restauration/cle.txt bash deploy/restore-drill.sh /root/restauration/sklubot-auto-….tar.gz.age`
3. Vraie restauration (Sklubot arrêté sous Coolify) :
   `SKLUBOT_BACKUP_AGE_IDENTITY=/root/restauration/cle.txt bash deploy/restore.sh /root/restauration/sklubot-auto-….tar.gz.age`
   — l'archive est entièrement vérifiée **avant** que les données soient remplacées ; les volumes des ordinateurs des
   bots sont laissés tels quels. Remets le même `SESSION_SECRET` que la sauvegarde (le script affiche la commande pour
   le relire), puis redémarre. La sauvegarde automatique reprend seule (ses réglages sont dans la base).

Sans scripts ni Docker Compose (n'importe quel serveur avec l'image) : `node server/dist/backupcheck.js extract
--identity cle.txt <archive> <dossier de données vide> --meta <dossier hors des données>` restaure le dossier de
données et écrit `manifest.json` et `secrets.env` (droits 600) dans le dossier `--meta`. `verify` vérifie sans rien
écrire, `decrypt` donne le `.tar.gz` en clair.

## Vérifié

- Automatique (`server/test/backup-drill.test.ts`, avec le Docker de la machine et une image Sklubot ; ignoré sans
  elles, par exemple dans la CI qui ne construit que l'image des ordinateurs) : base copiée pendant que l'application
  tourne, un ordinateur, secrets chiffrés avec une phrase de passe, rotation, puis exercice : empreintes, démarrage,
  `/api/health`, comptes identiques, valeur du coffre déchiffrée ; avec une mauvaise phrase, l'exercice échoue.
- Automatique, sauvegarde de l'application (`server/test/auto-backup.test.ts`, avec un faux stockage S3 local qui
  vérifie chaque signature) : signature V4 contrôlée sur les exemples de la documentation AWS ; fichiers age ouverts
  par l'outil `age` officiel et inversement ; clé du navigateur valide pour `age-keygen` ; réglages réservés au
  propriétaire, clés jamais renvoyées ; envoi en plusieurs morceaux, interrompu proprement si le stockage tombe ;
  archive ouverte par `age` et `tar`, `sha256sum -c` vert, exclusions respectées ; restauration par `restore-from-s3`
  dans un dossier vide : base intègre, comptes identiques, valeur du coffre rouverte avec le `SESSION_SECRET` de
  l'archive ; un octet changé ou une mauvaise clé sont refusés ; rotation ; alerte après deux échecs ; planning dans le
  fuseau du propriétaire ; et, avec Docker et une image à jour (`SKLUBOT_TEST_APP_IMAGE`), `deploy/restore-drill.sh`
  sur l'archive : copie isolée démarrée, `/api/health`, comptes, valeur scellée.
- Manuel (version précédente) : installation de test (2 bots, 7 ordinateurs), données supprimées, restauration :
  empreinte de tous les fichiers identique, `PRAGMA integrity_check` = ok, connexions des ordinateurs retrouvées.
