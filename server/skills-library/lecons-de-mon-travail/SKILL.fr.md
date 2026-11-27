---
name: Leçons de mon travail
description: Après un travail (surtout après des erreurs ou des corrections), lister ce qu'on a appris et proposer où garder chaque leçon - une phrase de mémoire, une compétence, une règle validée par le patron - et, de temps en temps, ranger la mémoire : trouver doublons, contradictions et notes périmées, et proposer un nettoyage au patron.
---

> Adaptée de Noodle « reflect » et « meditate » (© 2026 Lauren Tan, MIT). Modifiée pour Sklubot (22/11/2026) : le dossier de notes, les sous-agents, les scripts et les commits automatiques remplacés par la mémoire, les compétences et les règles de Sklubot, chaque changement proposé sur une carte ou dans une liste que le patron valide ; traduite en français.

# Leçons de mon travail

## 1. Après le travail : qu'est-ce que j'ai appris ?

Quand une tâche se termine (ou que le patron dit « retiens ça », ou qu'on t'a corrigé), repasse la conversation et cherche :
- les erreurs faites et les corrections reçues (et pourquoi ça a mal tourné) ;
- les préférences et les façons de travailler du patron ;
- des faits sur son entreprise, ses outils et ses partenaires ;
- les particularités d'un site, d'un outil ou d'un fournisseur que tu as découvertes ;
- les décisions prises et leurs raisons ;
- les étapes faites à la main qui reviendront.

Laisse de côté le banal et ce qui est déjà gardé (memory_search d'abord).

## 2. Où va chaque leçon

- **Un fait ou une préférence durable** → une phrase courte et autonome avec memory_save (« Le fournisseur X ne livre que le mardi »).
- **Une procédure qui reviendra** → propose de la garder comme compétence (skill_propose) : le patron décide.
- **Une règle sur la façon de travailler** (« envoie-moi toujours le devis avant le client ») → suggère-la en une ligne ; si le patron est d'accord, propose-la avec rule_propose (la carte, c'est sa décision).
- **Quelque chose qui devrait être un réglage ou un contrôle plutôt qu'une note** → dis-le au patron (par exemple « une routine chaque lundi attraperait ça »).
Puis dis en deux ou trois lignes ce que tu as gardé et où.

## 3. De temps en temps : ranger la mémoire

Quand le patron le demande (ou dans une routine mensuelle qu'il a acceptée), passe en revue ce dont tu te souviens (memory_search sur les grands sujets : clients, fournisseurs, prix, préférences, outils) :
- **périmé** : prix, horaires, personnes ou outils qui ont changé ;
- **doublons** : deux notes qui disent la même chose ;
- **contradictions** : deux notes qui ne sont pas d'accord (garde la plus récente et dis laquelle) ;
- **peu utile** : ce que tu ne te tromperais de toute façon jamais ;
- **tendances** : plusieurs notes qui montrent un principe général qui mérite d'être écrit.
Une note mérite sa place si, sans elle, tu te tromperais, ou si elle revient souvent, ou si se tromper coûte cher.

Présente une courte liste : ce qu'il faut mettre à jour, fusionner, retirer, et les principes que tu ajouterais. Rien n'est supprimé de toi-même : le patron fait le ménage dans la mémoire du bot ou te dit quoi changer.
