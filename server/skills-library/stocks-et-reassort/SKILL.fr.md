---
name: Stocks et réassort
description: Aider une petite boutique ou un magasin en ligne à garder le bon stock - classer les produits par valeur et par régularité (ABC/XYZ), prévoir simplement, calculer le stock de sécurité et le point de commande avec les vrais délais de livraison, préparer promotions et saisons sans surstock, et décider quand solder - calculs à l'appui.
---

> Adaptée de ECC « inventory-demand-planning » (© 2026 Affaan Mustafa et contributeurs d'ECC ; cette compétence est sous Apache License 2.0 selon son en-tête, et le dépôt est sous licence MIT). Modifiée pour Sklubot (22/11/2026) : condensée pour les petites boutiques au lieu des grandes enseignes à plusieurs sites, travaillée dans un tableur ou un fichier avec les vrais chiffres du patron, traduite en français.

# Stocks et réassort

Utilise seulement les vrais chiffres du patron (historique des ventes, délais des fournisseurs, prix). Quand un chiffre manque, demande-le ou montre le calcul avec une hypothèse explicite ; ne présente jamais une estimation comme un fait. Travaille dans un tableur réutilisable par le patron (outils bureautiques ou fichier CSV) et montre chaque formule.

## 1. Classer les produits

- **ABC (valeur)** : classe les produits par marge (pas par chiffre d'affaires). A = les premiers produits qui font environ 80 % de la marge, B = les 15 % suivants, C = le reste.
- **XYZ (régularité)** : X = ventes régulières (coefficient de variation sous 0,5), Y = moyennes (0,5 à 1), Z = irrégulières (au-dessus de 1), mesuré sur les ventes hebdomadaires sans l'effet saison.
- **Que faire** : AX → réassorts automatiques réguliers avec un stock de sécurité serré ; AZ → regarder à chaque fois (précieux mais irrégulier) ; CX → mini/maxi simple ; CZ → commander à la demande, ou se demander s'il faut le garder.

## 2. Prévoir simplement

- Produits réguliers : moyenne des 4 à 8 dernières semaines.
- Tendance ou saison : comparer aux mêmes semaines de l'an dernier, corrigées de la tendance de cette année.
- Un nouveau produit : reprendre le profil de 3 à 5 produits proches, avec un démarrage prudent.
- Retire les promotions de l'historique avant de prévoir les semaines normales.
- Contrôle la prévision chaque mois : est-elle **biaisée** (toujours trop haute ou trop basse) ? Erreur pondérée = somme des écarts absolus ÷ somme des ventes réelles.

## 3. Stock de sécurité et point de commande

- **Position de stock** = en rayon + en commande − déjà promis aux clients. Ne recommande jamais sur le seul « en rayon ».
- **Stock de sécurité** = Z × √(délai × variation de la demande² + demande moyenne² × variation du délai²). Z = 1,65 pour servir 95 % des commandes (normal pour les produits A), 2,33 pour 99 % (produits critiques), 1,28 pour 90 % (produits C).
- **Point de commande** = demande moyenne pendant le délai de livraison + stock de sécurité. Commande quand la position de stock passe en dessous.
- **Combien** : quantité économique √(2 × demande annuelle × coût d'une commande ÷ coût annuel de stockage d'une unité), arrondie aux colis et minimums du fournisseur ; ou « compléter jusqu'à » un niveau aux jours de commande fixes avec le fournisseur.
- Quand le délai d'un fournisseur change, recalcule tout de suite pour ses produits.

## 4. Promotions et saisons

- Estime les ventes en plus d'une promotion à partir des précédentes sur le même produit ou des produits proches ; attends-toi à ce que les produits voisins en perdent une partie, et à un creux de 1 à 3 semaines après une grosse promotion (les clients ont fait des réserves).
- Produits saisonniers : engage d'abord environ 60 à 70 % de la saison prévue, garde le reste pour un réassort quand les vraies ventes montrent la tendance.
- **Solde** quand les ventes à mi-saison sont nettement en retard sur le plan (par exemple sous 60 % de ce qui était prévu à ce moment) : de petites remises tôt sauvent plus de marge que de grosses remises tard. Fixe une date de fin pour écouler le reste avant l'arrivée de la saison suivante.

## 5. Ce qu'il faut livrer

Un tableau par produit : classe, prévision, stock de sécurité, point de commande, quantité à commander, date ; la liste des produits à commander cette semaine ; les alertes (risque de rupture, surstock, produits qui dorment). Passer une commande à un fournisseur engage de l'argent : prépare-la et laisse le patron valider. Propose une routine hebdomadaire pour la liste de réassort.
