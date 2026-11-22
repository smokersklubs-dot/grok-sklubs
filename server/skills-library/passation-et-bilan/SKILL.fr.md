---
name: Note de passation et bilan de la semaine
description: Faire tourner une équipe de bots sans accroc - écrire une note de passation quand on passe le travail à un autre bot ou avant une remise à zéro (but, état, ce qui a échoué et pourquoi, prochaines étapes), écrire le bilan hebdomadaire de l'équipe à partir de ce qui s'est vraiment passé, et, quand le patron le demande, proposer ses objectifs et ses règles en citant ses propres mots.
---

> Adaptée de claude-mem « handoff », « weekly-digests » et « owner-goals » (© 2026 Alex Newman, Apache License 2.0). Modifiée pour Sklubot (22/11/2026) : réécrite pour les bots Sklubot (bot_message, room_handoff, conversation_search, rule_propose, goal_propose) au lieu du serveur de mémoire, des transcriptions et des scripts d'origine ; les trois méthodes condensées en une compétence ; traduite en français.

# Note de passation et bilan de la semaine

## 1. La note de passation

Écris-en une quand tu passes le travail à un autre bot (bot_message, room_handoff), quand le patron veut repartir de zéro, ou quand tu remarques que tu refais toujours la même chose. Écris-la **pour quelqu'un qui n'a rien vu** de cette conversation. Enregistre-la (file_save, par exemple passations/<sujet>-<date>.md) et donne son nom dans le message.

```
# Passation : <sujet>
Date : <date> · De : <toi> · À : <le bot suivant ou « plus tard »>

## But
<le résultat final voulu par le patron, pas la petite étape du moment>

## Où on en est
Ce qui marche : <confirmé, avec preuve>
Ce qui ne marche pas : <symptôme exact, message d'erreur exact>

## Ce qui a été essayé et pourquoi ça a échoué
1. <quoi> — échec parce que <la vraie cause, pas seulement « ça n'a pas marché »>

## Meilleure piste actuelle
<ce que tu crois être la bonne voie, et pourquoi>

## Prochaines étapes
1. <action concrète : quelle page, quel fichier, quel outil, quelle personne>

## À respecter
<préférences du patron, ce qu'il a dit de NE PAS faire, échéances, accords en attente>

## Où chercher
<fichiers, pages, discussions passées (mots pour conversation_search), tâches>
```

Règles : sois précis (« le formulaire de commande de /contact n'envoie plus rien depuis mardi ; la boîte ne montre aucun message »), cite les erreurs mot pour mot, pas de remplissage. La partie « ce qui a échoué » compte le plus : sans elle, le bot suivant refait tes erreurs.

## 2. Le bilan de la semaine de l'équipe

Quand le patron le demande (ou dans une routine qu'il a acceptée), écris un court bilan de la semaine :
1. Rassemble les faits : conversation_search sur la semaine, les tâches et leur état, les pages et fichiers produits, les accords donnés ou refusés. Seulement ce qui s'est vraiment passé ; ne bouche jamais un trou par une supposition.
2. Écris-le comme un court chapitre relié à la semaine d'avant : pars de ce qui était ouvert et dis ce que c'est devenu.
3. Rubriques : **fait** (avec liens), **en cours**, **bloqué et pourquoi**, **décisions prises par le patron**, **à décider la semaine prochaine**. Un écran.
4. Termine par trois lignes reportées à la semaine suivante (points ouverts, promesses, dates), pour que le prochain bilan parte de là.

## 3. Objectifs et règles avec les mots du patron (seulement sur demande)

Quand le patron demande « qu'est-ce que je veux de toi ? » ou « transforme mes habitudes en règles » :
1. Lis seulement ce que le **patron** a écrit (conversation_search), pas les textes écrits par des bots.
2. Classe chaque phrase avec trois questions, dans l'ordre : parle-t-elle de **comment** travailler ? Une règle. Est-ce une demande qui peut être terminée ? Une tâche. Peut-on demander des choses à l'intérieur ? Un domaine de travail.
3. Garde ses mots exacts avec la date pour chaque point (« « jamais de tutoiement avec les clients » — 12/11 »).
4. Là où il a changé d'avis, montre le changement et garde le plus récent.
5. Propose chaque règle avec rule_propose et un objectif durable avec goal_propose : la carte que voit le patron, c'est sa décision. N'enregistre jamais une règle qu'il n'a pas confirmée.
