---
name: Cahier des charges
description: Pour un projet que le patron confie (un site, une boutique, une campagne, un gros document), écrire un cahier des charges court - quoi, pour qui, scénarios par priorité, critères de réussite, hors périmètre, questions ouvertes -, le faire valider, relire le plan contre lui avant de commencer, et à la fin cocher chaque critère avec sa preuve.
---

> Adaptée de Spec Kit « specify », « analyze » et « converge » avec son modèle de spécification (© GitHub, Inc., MIT). Modifiée pour Sklubot (22/11/2026) : réécrite pour des projets non techniques menés par un bot Sklubot, étapes de fichiers et de git remplacées par un fichier Sklubot et le mode objectif, traduite en français.

# Cahier des charges

Un cahier des charges, c'est une promesse écrite avant le travail : il dit **quoi** et **pourquoi**, jamais **comment**. Il permet au patron de vérifier que tu as compris, et à toi de prouver à la fin que c'est fait.

## 1. Écrire le cahier

Enregistre-le dans un fichier (file_save, par exemple projets/<nom>/cahier.md). Un ou deux écrans au plus :

```
# Cahier des charges : <nom du projet>
Date : <date> · Demandé par : <patron>

## En une phrase
<le résultat, pour qui, pourquoi maintenant>

## Scénarios (par priorité)
1. [Indispensable] <qui> peut <faire quoi> — on le vérifie en <comment>
2. [Important] …
3. [Bonus] …

## Règles et contenu
- <ce que ça doit montrer, dire ou faire : prix, horaires, produits, ton>
- <contraintes : budget, date, marque, langues, mentions légales>

## Critères de réussite (mesurables)
- <ex. : un visiteur trouve le téléphone en moins de 5 secondes sur un téléphone>
- <ex. : le formulaire de commande arrive dans la boîte du patron>

## Hors périmètre
- <ce qu'on ne fait volontairement pas cette fois>

## Questions ouvertes
- [À PRÉCISER : …] (3 au plus ; pour le reste, fais un choix raisonnable et note-le dans « Choix faits »)

## Choix faits
- <un choix par défaut que tu as pris, pour que le patron puisse le changer>
```

Règles : des mots simples, pas de jargon technique ; chaque scénario se vérifie en regardant ; les adjectifs comme « moderne » ou « rapide » reçoivent un chiffre ou un exemple.

## 2. Le faire valider

Montre le cahier (file_send, ou une page privée). Pose les questions ouvertes une à une avec ta réponse conseillée (ask_user), mets le cahier à jour, et attends un oui clair avant de commencer. Pour un long travail, propose le mode objectif (goal_propose) avec les critères de réussite comme ligne d'arrivée.

## 3. Relire le plan contre le cahier (avant de commencer)

Lis ton plan ou ta liste de tâches à côté du cahier, sans rien changer, et cherche :
- un scénario qu'aucune étape ne livre ;
- une étape qui ne sert rien du cahier (travail en trop) ;
- deux parties qui se contredisent (prix, date, formulation) ;
- un mot flou encore sans chiffre.
Corrige le plan, puis commence.

## 4. À la fin : cocher chaque critère avec sa preuve

Pour chaque scénario et chaque critère de réussite, écris FAIT avec la preuve (un lien, une capture, un message d'essai reçu) ou MANQUE avec ce qui reste. Fais ce qui manque, ou dis clairement au patron ce qui reste et pourquoi. Ne dis jamais que le projet est fini tant qu'une ligne « Indispensable » manque.
