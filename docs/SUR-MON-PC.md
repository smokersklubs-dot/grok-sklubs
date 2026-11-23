# Sklubot sur ton ordinateur (sans VPS)

Pour utiliser Sklubot sur ton propre ordinateur, par exemple quand le VPS ne répond pas.

## Ce qu'il faut, une seule fois

1. **Node.js**, version LTS (22.13 ou plus récente) : https://nodejs.org
2. **Git** : sur Windows, https://git-scm.com/download/win (choix par défaut). Sur Mac, tape `xcode-select --install` dans le Terminal.
3. **Facultatif, Docker Desktop**, pour que chaque bot ait son ordinateur Linux : https://www.docker.com/products/docker-desktop/ . Sans lui, Sklubot marche quand même, et les bots ont un navigateur à la place.

## Lancer

- **Windows** : télécharge le fichier `Lancer Sklubot sur mon PC.cmd` de la branche et double-clique dessus.
- **Mac** : télécharge `Lancer Sklubot sur mon PC.command`, puis dans le Terminal : `bash "Lancer Sklubot sur mon PC.command"`.

La première fois, compte 5 à 10 minutes. Ajoute 10 à 20 minutes si Docker est allumé, pour préparer l'ordinateur des bots. Le lanceur :

1. télécharge le code dans `Sklubot/code`, dans ton dossier personnel. Si GitHub te demande de te connecter, fais-le avec ton compte ;
2. crée un fichier de réglages avec un secret fabriqué sur ton ordinateur. Il n'est montré nulle part ;
3. installe et prépare l'application ;
4. ouvre http://localhost:8787 dans ton navigateur.

Ensuite :

- **Crée ton compte**, puis ajoute ta clé ou ton abonnement dans **Réglages → Mes comptes IA**.
- **Tes données** sont rangées dans `Sklubot/donnees`, dans ton dossier personnel.
- **Pour arrêter** : ferme la fenêtre.
- **Pour relancer et mettre à jour** : double-clique de nouveau. Le lanceur récupère la dernière version de la branche.

## À savoir

- Cette version locale est séparée de celle du VPS : elles ne partagent ni les comptes, ni les bots, ni les données.
- Tant que la fenêtre est ouverte, Sklubot est joignable depuis ton réseau local (même box). Si Windows te demande d'autoriser Node.js sur le réseau, choisis seulement « Réseaux privés ».
- Les liens qui viennent d'Internet ne marchent pas sur un ordinateur local : retour de connexion Google, webhooks, Telegram et Slack ou Discord en mode webhook. Le reste marche.
