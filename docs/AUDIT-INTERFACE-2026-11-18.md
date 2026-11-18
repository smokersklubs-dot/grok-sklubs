# Revue de l’interface Sklubot

18 novembre 2026. Cette revue suit le parcours d’une personne qui crée un deuxième bot, choisit son modèle, lui confie une tâche et cherche à comprendre un échec de connexion. Elle s’appuie sur les captures de l’application, le code des parcours et un essai dans Chromium avec un compte de test.

## Choisir un modèle et le connecter

L’écran « Modèles » montrait d’abord des fournisseurs API, puis une liste de secours où « Demo (no model) » pouvait être le seul choix. Ce menu répondait à la question « Que tenter si l’API échoue ? ». La personne cherchait le modèle utilisé pour la prochaine réponse. Le catalogue des abonnements existait déjà dans la fiche individuelle du bot.

La page présente désormais les connexions ChatGPT et Claude ainsi que le modèle de chaque bot. La création manuelle reprend le modèle du bot principal. Lorsqu’un bot en crée un autre, le créateur transmet son propre choix. Le sélecteur permet de choisir une exception dès la création ou de modifier un bot existant. Cela évite d’écraser les réglages d’une équipe lors de la mise à jour.

L’écran de connexion vérifie l’état déclaré par le client officiel sur le bureau choisi. Un utilisateur peut sélectionner un modèle avant de se connecter. Le mode personnel ChatGPT permet au propriétaire d’autoriser une fois son installation puis de faire travailler plusieurs bots sur leurs bureaux respectifs. Les connexions natives individuelles, notamment Claude Code, se vérifient sur chaque bureau. La preuve de bout en bout reste une réponse reçue du fournisseur.

## Comprendre l’activité du bot

Dans la capture de discussion, le nom du bot apparaît dans la carte latérale, l’en-tête et la fiche de droite. Pourtant, le seul indice sur son modèle était le mot « abonnement ». L’étiquette affiche maintenant le fournisseur et le modèle choisi lorsqu’il est explicite. Le conseil après une erreur de connexion renvoie à « Réglages → Modèles ». La réponse de démonstration indique aussi cette action. Les réglages détaillés de voix s’ouvrent à la demande dans la fiche de droite.

Deux problèmes restent visibles sur la capture. Une phrase de progression est répétée au début de la réponse finale. Le texte « Connecté » du PC relié peut également être compris comme un état du modèle. Pour le premier point, il faut suivre les événements d’un tour avant de modifier le rendu, car un aperçu et un message final peuvent avoir des contenus légitimement différents. Pour le second, le prochain essai doit demander à l’utilisateur de désigner le bureau sur lequel une action va s’exécuter avant de la lancer.

## Retrouver un réglage

Les anciennes entrées « Ordinateur » et « Ordinateurs » désignaient respectivement les bureaux virtuels et les appareils reliés. Le nombre grammatical portait presque toute la distinction. Elles ont maintenant des noms explicites. La navigation est répartie en quatre groupes. Sur grand écran, la recherche accepte les anciens mots et des synonymes, dont « cerveau », « abonnement » et « ChatGPT ». Sur petit écran, une liste groupée permet de changer directement de section. Les raccourcis affichés sont reliés aux actions clavier existantes.

| Tâche montrée dans les références | Réponse actuelle dans Sklubot | Essai à effectuer pour aller plus loin |
| --- | --- | --- |
| Retrouver un modèle et un compte | Modèles regroupe les abonnements et les choix individuels | Créer un bot, le faire répondre, changer son modèle et demander une deuxième réponse |
| Comprendre ce qui va s’exécuter | La conversation, les étapes et les autorisations existent | Retrouver depuis une approbation le bot, la commande, le bureau visé et le résultat |
| Retrouver une discussion terminée | La recherche et les vues d’équipe couvrent une partie du besoin | Tester un parcours explicite d’archivage, de recherche et de restauration avant d’ajouter un menu |
| Configurer les intégrations | Les applis, le coffre et les appareils ont des entrées dédiées | Tester la révocation et vérifier que l’état affiché change après la révocation |
| Travailler dans un dépôt | Le bot dispose de son environnement de travail | Avant d’ajouter « Git », « Revue » ou « Worktrees », prévoir le choix du dépôt et de la branche, un diff consultable et une validation avant publication |
| Suivre les coûts | La consommation et les limites existent | Distinguer la limite de l’abonnement, les crédits du service et les dépenses API dans un même scénario |

La capture de Codex sert ici à comparer l’organisation des réglages. Les contrôles parentaux, contacts de confiance et services cloud supposent des fonctionnalités et des responsabilités propres au produit. Leur simple présence dans un menu ne remplirait aucune de ces fonctions.

## Vérification et reprise du travail

Dans Chromium, le parcours a été exercé avec deux bots de test, à 1 440 et 390 pixels de large. La recherche « abonnement » mène à Modèles. Modifier le deuxième bot sauvegarde sa configuration et conserve celle du principal. Sur téléphone, la liste groupée ouvre les cinq raccourcis. Aucun débordement horizontal n’a été mesuré sur le panneau Modèles à ces deux largeurs. Pour cet essai, le catalogue des deux fournisseurs était simulé et la sauvegarde utilisait le véritable serveur applicatif local.

Le travail de conception commencé dans Claude comporte aussi l’échange d’une équipe complète au format Markdown, le curseur visible pendant une action sur un appareil relié, la revue des compétences importées, l’utilisation de la mémoire, les routines et les espaces par sujet. Ces pistes ont des critères de validation distincts. Pour l’échange d’équipe, réimporter un export dans un compte vierge et comparer les membres, les rôles et les relations. Pour le curseur, suivre une action autorisée sur l’appareil cible et vérifier que l’indication disparaît à la fin de l’action.
