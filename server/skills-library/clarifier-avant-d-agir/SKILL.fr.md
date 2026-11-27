---
name: Clarifier avant d'agir
description: Avant un travail long ou payant sur une demande floue, trouver ce que la personne veut vraiment - une hypothèse en une phrase avec un niveau de confiance, une question à la fois avec la réponse conseillée, les réponses gardées dans une note - et s'arrêter quand on peut prévoir ses réponses. Jamais dans une routine ni quand personne n'est là pour répondre.
---

> Adaptée de agent-skills « interview-me » (© 2025 Addy Osmani, MIT), mattpocock/skills « grilling » (© 2026 Matt Pocock, MIT) et Spec Kit « clarify » (© GitHub, Inc., MIT). Modifiée pour Sklubot (22/11/2026) : réunies en une méthode courte, réécrites pour les cartes ask_user et les notes de Sklubot, traduites en français.

# Clarifier avant d'agir

Ce que les gens demandent et ce qu'ils veulent sont souvent deux choses : « un site » veut parfois dire « une page qu'on trouve sur Google », « plus rapide » n'a pas de chiffre. Le moment le moins cher pour trouver l'écart, c'est avant tout travail, toute image, toute page et toute dépense.

## Quand l'utiliser

- Il manque au moins un de ces points : **pour qui**, **pourquoi** maintenant, à quoi on verra que **c'est réussi**, la **limite** qui compte (budget, date, ton).
- Le travail est long, coûte de l'argent (images, vidéos, recherche) ou partira chez d'autres personnes.
- La personne dit « pose-moi des questions d'abord », « challenge mon idée », « on est sûrs ? ».

**Pas** pour : une petite tâche claire (« renomme ce fichier »), une question de fait, une personne pressée, ou un tour que personne ne suit (routine, point du matin, tâche de fond). Là, fais un choix raisonnable, dis-le en une ligne et avance ; si une réponse manquante bloque vraiment, dis-le dans ton compte rendu au lieu de deviner.

## La méthode

1. **D'abord une hypothèse.** Écris pour toi une phrase : ce que tu crois qu'elle veut, avec une confiance honnête (0 à 100 %). Sous 70 %, note ce qui manque.
2. **Cherche les faits toi-même.** Ne demande jamais ce que tu peux trouver : son profil, tes souvenirs (memory_search), les discussions passées (conversation_search), ses fichiers, son site. Les questions servent aux **décisions** seulement.
3. **Une question à la fois, avec ta réponse conseillée.** Utilise ask_user avec 2 à 4 réponses prêtes, la conseillée en premier, marquée « (conseillé) ». Formule-la pour que « oui » accepte ton conseil. Ajoute une phrase simple sur l'enjeu. 5 questions au plus en tout ; la plus importante d'abord (celle qui change le plus le travail).
4. **Repère le « il faudrait ».** « Moderne », « professionnel », « comme tout le monde » ne sont pas des décisions. Demande : « Si tu n'avais à te justifier auprès de personne, tu voudrais quoi ? »
5. **Reformule avec ses mots**, en 5 ou 6 lignes courtes : le résultat, pour qui, pourquoi maintenant, comment on saura que ça marche, la limite, et **ce qu'on ne fera pas**. Demande un oui clair.
6. **Un vrai oui.** « Comme tu veux » ou « ça me va » n'est pas un oui : propose deux options concrètes et laisse-la choisir.
7. **Garde les réponses.** Enregistre la reformulation validée dans une note (file_save, par exemple notes/brief-<sujet>.md), ou en une phrase de mémoire si c'est une préférence durable, pour ne jamais redemander.

## Quand s'arrêter

Arrête de poser des questions quand tu peux prévoir ses réponses aux trois suivantes. Si après 5 questions tu n'y arrives pas, dis-le : « Quelque chose de fondamental reste flou : on prend deux minutes sur le but ? »

## Signes que ça dérape

- Plusieurs questions dans un même message, ou une question sans ta réponse conseillée.
- Demander un fait que tu pouvais trouver.
- Commencer le travail avant le oui sur la reformulation.
- Pas de ligne « ce qu'on ne fera pas ».
