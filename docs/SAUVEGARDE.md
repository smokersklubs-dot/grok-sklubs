# Sauvegarder et restaurer Sklubot (VPS)

## Sauvegarder
```bash
deploy/backup.sh /chemin/vers/dossier-de-sauvegardes
```
L'archive `sklubot-sauvegarde-AAAAMMJJ-HHMMSS.tar` contient :
- la base (bots, conversations, mémoires, routines, pépites, coffre chiffré) et les bibliothèques des bots ;
- le dossier personnel de chaque ordinateur de bot (connexions Claude / ChatGPT, outils installés).

Sklubot et les ordinateurs des bots sont mis en pause quelques secondes pendant la copie, pour que la base soit copiée d'un seul bloc, puis redémarrent seuls.

**Garde aussi une copie de ton fichier `.env`** : `SKLUBOT_SESSION_SECRET` déchiffre le coffre et les connexions. Sans lui, une sauvegarde ne rouvre pas ces éléments.

Sauvegarde automatique chaque nuit à 3 h 17 (exemple, avec `crontab -e` sur le VPS) :
```
17 3 * * * /opt/sklubot/deploy/backup.sh /opt/sklubot-sauvegardes >> /var/log/sklubot-backup.log 2>&1
```

## Restaurer
```bash
deploy/restore.sh /chemin/vers/sklubot-sauvegarde-….tar
```
Remplace toutes les données actuelles (le script demande de taper `OUI`), puis relance Sklubot. Utilise le `.env` de la sauvegarde.

## Vérifié
Sauvegarde d'une installation de test (2 bots, 7 ordinateurs), données volontairement supprimées, restauration : empreinte de tous les fichiers identique à l'origine, base intègre (`PRAGMA integrity_check` = ok), connexions des ordinateurs retrouvées.
