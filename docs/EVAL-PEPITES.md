# Évaluation du jugement « pépite » avec un vrai modèle

Les consignes réelles du bot (règle « Gems » de `server/src/agent/prompt.ts` et description de l'outil `celebrate` de `server/src/agent/tools.ts`) ont été données à un vrai modèle (via Codex, abonnement ChatGPT), avec huit situations inventées pour une boutique de café (≈ 25 000 €/mois, ≈ 40 commandes/semaine).

| # | Situation | Décision | Note |
|---|---|---|---|
| 1 | 41 commandes contre 39, CA +4 % | pas de pépite | 8 |
| 2 | Requête SEO 5 400 impressions/mois, page 11e, concurrents faibles | pépite | 82 → sous le seuil de 85, seulement notée |
| 3 | Lead B2B : 200 salariés, 60 kg/mois, budget, livraison le mois prochain | pépite | 95 ✅ euphorie |
| 4 | Taux d'ouverture newsletter 31 % contre 29 % | pas de pépite | 6 |
| 5 | Prix du fournisseur inchangés | pas de pépite | 0 |
| 6 | Article de 200 à 9 800 visites en 3 jours, sans lien produit | pépite | 86 ✅ euphorie |
| 7 | Transport 6 % moins cher (demandé par l'utilisateur) | pas de pépite | 18 |
| 8 | Concurrent qui ferme et redirige 8 000 abonnés | pépite | 88 ✅ euphorie |

Les cas ordinaires sont tous écartés ; les vraies opportunités ressortent avec des preuves chiffrées. Avec le seuil par défaut (85) et la limite de 2 par jour, l'utilisateur aurait vu au plus deux euphories ce jour-là (3 et 8 ou 6). À refaire avec les vraies données de l'utilisateur une fois ses applis connectées.
