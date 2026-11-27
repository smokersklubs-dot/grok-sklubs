---
name: Écrire un article avec toi
description: Écrire un article, une lettre d'info ou un long post avec la personne en trois temps - recueillir ses fragments bruts, les mettre dans l'ordre qu'un lecteur peut suivre (chaque idée expliquée avant d'être utilisée), puis rédiger paragraphe par paragraphe après qu'elle a choisi un début parmi deux ou trois - en enregistrant au fur et à mesure.
---

> Adaptée de mattpocock/skills « writing-fragments », « writing-beats » et « writing-shape » (© 2026 Matt Pocock, MIT). Modifiée pour Sklubot (22/11/2026) : les trois compétences d'écriture réunies en une méthode en trois temps, fichiers enregistrés avec file_save dans la bibliothèque du bot, exemples pour des patrons, traduite en français.

# Écrire un article avec toi

La personne a des choses à dire mais pas le temps de les organiser. Tu fais sortir la matière, puis tu la façonnes avec elle. Ses mots et son expérience sont le fond ; toi, tu es l'éditeur.

Demande une fois où enregistrer (par défaut : articles/<sujet>/) et garde deux fichiers : **matiere.md** (la matière brute) et **article.md** (le texte). Relis le fichier avant chaque enregistrement : la personne a pu le modifier. N'écrase jamais ses changements.

## 1er temps : les fragments (explorer, pas encore de structure)

Interroge la personne sur le sujet, une question à la fois : ce qui s'est passé, ce que demandent les clients, ce qui l'agace, ce qu'elle dirait à un ami. Chaque morceau qui pourrait servir va dans matiere.md, séparé par une ligne de trois tirets :
- une phrase qui fait mouche, une affirmation avec sa raison, une anecdote, un chiffre, une phrase de client, une demi-idée « quelque chose sur… » ;
- surtout, une **image clé** : une courte expression qui nomme toute l'idée (comme « la vitrine vide » pour un site que personne ne met à jour). Si elle apparaît, marque-la.

Ajoute chaque fragment au fichier au fil de l'eau, en disant « je note » au passage. Pas de titres, pas d'ordre. Arrête quand la personne trouve qu'il y a assez de matière.

## 2e temps : le chemin (l'ordre pour le lecteur)

1. Mettez-vous d'accord sur ce que le lecteur **sait déjà** en arrivant (un client de la boutique ? un autre boulanger ?). Tout le reste doit être expliqué avant d'être utilisé.
2. Propose **2 ou 3 débuts possibles**, chacun avec un angle différent, tirés de la matière.
3. Après le choix, propose à chaque fois 2 ou 3 **étapes suivantes** possibles. Une étape ne peut utiliser que des idées déjà expliquées ; note quelle idée nouvelle elle apporte.
4. Une étape peut faire une phrase ou quelques paragraphes ; si elle a besoin d'intertitres, c'est qu'il y en a deux.

## 3e temps : la rédaction (paragraphe par paragraphe)

1. Écris le début choisi dans article.md, puis demande-toi « qu'est-ce que le lecteur a besoin d'entendre maintenant ? » et puise dans la matière pour y répondre.
2. Écris chaque paragraphe validé tout de suite, pour que l'article grandisse sous ses yeux.
3. Ne laisse pas passer les liens faibles : « Qu'apporte ce paragraphe ? », « Si on le coupe, qu'est-ce qui casse ? », « Le début promettait X, on a dérivé vers Y. »
4. S'il manque quelque chose dans la matière (« il faut un exemple ici »), demande-le ou coupe la partie. N'invente jamais une anecdote, un chiffre ou une citation.
5. Choisis la forme à voix haute : de la prose pour un raisonnement, une liste pour des éléments vraiment parallèles, un tableau quand la même forme revient trois fois ou plus.

L'article se termine quand le chemin est complet, pas quand la matière est épuisée : il reste toujours des chutes, c'est normal. Applique ensuite « Écrire comme un humain » pour un dernier nettoyage, et propose d'en faire une page (page_publish) ou un brouillon de lettre d'info.
