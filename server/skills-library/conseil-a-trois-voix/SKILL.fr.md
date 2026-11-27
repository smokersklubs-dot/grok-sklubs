---
name: Conseil à trois voix
description: Pour une décision difficile avec plusieurs chemins crédibles (embaucher ou non, lancer maintenant ou attendre, augmenter les prix, choisir un fournisseur), réunir trois avis indépendants à rôles fixes - sceptique, pragmatique, critique - qui ne se voient pas, puis donner une décision avec ses risques et le désaccord le plus fort.
---

> Adaptée de ECC « council » (© 2026 Affaan Mustafa et contributeurs d'ECC, MIT). Modifiée pour Sklubot (22/11/2026) : les trois voix sont des aides Sklubot (helper_start) qui ne reçoivent que la question, le résultat est une courte fiche de décision pour un patron, exemples de code retirés, traduite en français.

# Conseil à trois voix

Une aide pour décider dans le doute, pas une vérification de faits ni un plan. Quand la personne hésite entre de vraies options, une seule voix (la tienne) a tendance à suivre la conversation. Trois voix qui ne l'ont jamais vue cassent cet effet.

## Quand l'utiliser

- Plusieurs chemins crédibles et pas de gagnant évident ; la personne demande « d'autres avis », « l'avocat du diable », « ce qui pourrait mal tourner ».
- Un choix go / pas go où il y a de l'argent ou une réputation en jeu.

**Pas** pour une question de fait (réponds simplement), la vérification d'un livrable (utilise « Vérifier avant de livrer ») ou une tâche évidente (fais-la).

## Étapes

1. **La vraie question.** Ramène-la à une ligne : que décide-t-on, quelles limites comptent, qu'est-ce qui serait une réussite. Si c'est flou, pose d'abord une question (ask_user).
2. **Seulement le contexte utile.** Quelques chiffres, les options, les contraintes. Rien d'autre de la conversation : c'est ce qui garde les voix indépendantes.
3. **Ta position d'abord.** Avant de lire les autres, écris ta position, tes trois meilleures raisons et le risque principal de ton choix.
4. **Trois voix, en parallèle.** Lance trois aides (helper_start), chacune avec la question, le court contexte et un rôle :
   - **Sceptique** : remet en cause le point de départ, cherche l'option crédible la plus simple.
   - **Pragmatique** : rapidité, simplicité, ce qui se passe vraiment sur le terrain, le point de vue du client.
   - **Critique** : ce qui pourrait échouer, les cas limites, le prix d'une erreur.
   Demande à chacune : une position en une ou deux phrases, trois raisons courtes, le plus gros risque, une chose que les autres pourraient manquer. Moins de 300 mots. Si les aides ne sont pas disponibles, écris les trois voix toi-même l'une après l'autre, chacune en repartant de la seule question, et dis-le.
5. **Pèse honnêtement.**
   - N'écarte jamais une voix sans dire pourquoi.
   - Si une voix t'a fait changer d'avis, dis-le.
   - Garde toujours le désaccord le plus fort, même si tu le rejettes.
   - Deux voix contre ta première position, c'est un vrai signal.

## La réponse

```
Conseil : <la décision en quelques mots>
Sceptique : <position, une ligne sur pourquoi>
Pragmatique : <position, une ligne sur pourquoi>
Critique : <position, une ligne sur pourquoi>
Mon premier avis : <position>

Décision : <la recommandation, en une ou deux phrases>
Risques principaux : <deux ou trois>
Désaccord le plus fort : <celui à garder en tête>
Ce qui nous ferait changer d'avis : <un signal à surveiller>
```

La décision reste celle de la personne. Si le choix engage de l'argent ou envoie quelque chose à d'autres, les cartes d'accord habituelles s'appliquent.
