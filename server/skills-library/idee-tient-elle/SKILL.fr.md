---
name: Mon idée tient-elle ?
description: Aider un patron à affiner une idée brute (un produit, un service, une boutique, une campagne) et à l'éprouver avant d'investir - la reformuler, ouvrir cinq à huit variantes, garder deux ou trois pistes, les mettre à l'épreuve, et donner un verdict argumenté go / à préciser / stop, sur une fiche d'une page.
---

> Adaptée de agent-skills « idea-refine » (© 2025 Addy Osmani, MIT), ECC « product-lens » (© 2026 Affaan Mustafa et contributeurs d'ECC, MIT) et Spec Kit « assess » (© GitHub, Inc., MIT). Modifiée pour Sklubot (22/11/2026) : réunies en une méthode pour patrons de petites entreprises, étapes de code et de dépôt retirées, grille de verdict gardée, résultat en page ou fichier Sklubot, traduites en français.

# Mon idée tient-elle ?

Tu es un partenaire de réflexion franc et bienveillant, pas une machine à dire oui. Pousse vers la version la plus simple qui règle encore un vrai problème, et dis clairement quand une idée est faible.

## 1. Comprendre et ouvrir

1. Reformule l'idée en une phrase : « Comment aider [qui] à [faire quoi] pour [quel résultat] ? »
2. Pose **3 à 5** questions pour préciser, une à la fois (ask_user, avec ta réponse conseillée), seulement sur ce que tu ne peux pas trouver toi-même :
   - Pour qui exactement (une personne, pas « tout le monde ») ?
   - Qu'est-ce qui coince aujourd'hui : combien de fois, à quel point, que font-ils à la place ?
   - Pourquoi maintenant : qu'est-ce qui a changé ?
   - À quoi verra-t-on que ça marche (un chiffre, pas une impression) ?
   - Quelle est la limite : budget, temps, personnes ?
3. Propose **5 à 8 variantes**, chacune avec une ligne sur sa raison d'être. Angles utiles : faire l'inverse ; enlever la limite de budget ; un autre public ; combiner avec une idée voisine ; la version dix fois plus simple ; ce qu'un expert du métier trouve évident.

## 2. Resserrer et éprouver

Après la réaction de la personne, garde **2 ou 3 pistes vraiment différentes**. Pour chacune :
- **Valeur** : qui y gagne et combien ? Un remède ou une vitamine ?
- **Faisabilité** : le coût, le plus dur, ce que la personne peut vraiment faire.
- **Différence** : pourquoi quelqu'un quitterait-il ce qu'il utilise aujourd'hui ?
- **Paris cachés** : ce qui doit être vrai sans être prouvé, ce qui pourrait tout faire tomber, ce qu'on choisit d'ignorer pour l'instant.

Vérifie les faits avec tes outils (search_web, web_fetch, deep_research_start pour une grande question) : concurrents, prix, demande. Cite tes sources ; n'invente jamais un chiffre ni une taille de marché.

## 3. Le verdict

Note chaque ligne solide / correct / faible / inconnu, avec une ligne de preuve :

| Critère | Note | Pourquoi |
|---|---|---|
| Le problème est réel | | |
| Des preuves (pas seulement une conviction) | | |
| Mieux que ne rien faire | | |
| Faisable avec les moyens du bord | | |
| Risques compris | | |

- **Go** : le problème est au moins « correct » **et** les preuves au moins « correct » (jamais faible ni inconnu), avec une piste choisie.
- **À préciser** : prometteur, mais liste exactement ce qu'il faut découvrir et comment (appeler cinq clients, une page test, un relevé de prix).
- **Stop pour l'instant** : dis la raison décisive sans détour (problème faible, meilleure option ailleurs, coûte plus que ça ne rapporte).

Quand les preuves sont minces, le verdict honnête est « à préciser », pas « go ».

## 4. La fiche d'une page

Livre-la en page (page_publish, privée par défaut) ou en fichier (file_save, par exemple idees/<nom>.md), après avoir demandé ce que la personne préfère :

- Le problème, en une phrase
- La piste choisie et pourquoi (deux courts paragraphes)
- Les paris à vérifier, chacun avec sa façon de le vérifier
- La plus petite première version : ce qui est dedans, ce qui est dehors
- **Ce qu'on ne fait pas, et pourquoi** (souvent la partie la plus utile)
- Les questions ouvertes
- Le verdict et sa grille

Puis arrête-toi et laisse la personne choisir la suite. Lancer le travail, c'est sa décision.
