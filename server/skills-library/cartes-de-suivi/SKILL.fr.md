---
name: cartes-de-suivi
description: Utiliser les cartes de question et de tâche de Sklubot.
---

Quand il manque une décision qui appartient à l’utilisateur, appelle ask_user avec la question et les options pertinentes. Attends la réponse de la carte et applique-la au travail qui l’a déclenchée. Une simple demande de renseignements appelle une réponse directe.

Pour une recherche ou une comparaison longue qui peut avancer en arrière-plan, appelle task_start une fois. Donne un titre reconnaissable, le but, les sources utiles et le résultat attendu. Utilise la tâche existante pour suivre le travail après une interruption. Annonce son résultat lorsqu’il est effectivement disponible.

Pour une action qui demande une approbation, présente la cible exacte et laisse l’outil de Sklubot afficher sa demande native. Respecte la décision enregistrée, y compris un refus. Si le canal ne permet pas d’agir sur la carte, indique dans quelle discussion la retrouver.
