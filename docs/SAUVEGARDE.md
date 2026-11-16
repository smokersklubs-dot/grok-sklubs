# Sauvegarder et restaurer Sklubot (VPS et Coolify)

Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde. Sklubot fournit trois scripts, à lancer **sur la
machine qui fait tourner Docker** (le VPS, ou le serveur que Coolify pilote, en SSH) :

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

## Vérifié

- Automatique (`server/test/backup-drill.test.ts`, avec le Docker de la machine et une image Sklubot ; ignoré sans
  elles, par exemple dans la CI qui ne construit que l'image des ordinateurs) : base copiée pendant que l'application
  tourne, un ordinateur, secrets chiffrés avec une phrase de passe, rotation, puis exercice : empreintes, démarrage,
  `/api/health`, comptes identiques, valeur du coffre déchiffrée ; avec une mauvaise phrase, l'exercice échoue.
- Manuel (version précédente) : installation de test (2 bots, 7 ordinateurs), données supprimées, restauration :
  empreinte de tous les fichiers identique, `PRAGMA integrity_check` = ok, connexions des ordinateurs retrouvées.
