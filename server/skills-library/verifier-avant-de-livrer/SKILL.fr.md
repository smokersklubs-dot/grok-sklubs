---
name: Vérifier avant de livrer
description: Avant que quelque chose parte chez des clients ou le public (une page, un e-mail de masse, un devis, un post, un lancement), le contrôler avec une liste faite pour ce livrable, le faire relire par deux relecteurs indépendants qui doivent être d'accord, noter son propre travail sur cinq points, et prouver qu'un message est vraiment parti. Aussi : réparer un livrable qui ne marche pas.
---

> Adaptée de ECC « santa-method », « agent-self-evaluation » et « email-ops » (© 2026 Affaan Mustafa et contributeurs d'ECC, MIT), Spec Kit « checklist » (© GitHub, Inc., MIT) et agent-skills « shipping-and-launch » (© 2025 Addy Osmani, MIT). Modifiée pour Sklubot (22/11/2026) : réunies et réécrites pour des livrables non techniques, relecteurs lancés comme aides Sklubot, contrôles de code remplacés par des contrôles de page, d'e-mail et de boutique, traduites en français.

# Vérifier avant de livrer

Un relecteur qui a fait le travail partage ses angles morts. Deux lecteurs indépendants avec la même grille attrapent ce qu'un seul rate. À utiliser avant tout ce qui part chez des clients ou le public ; pas pour un brouillon interne.

## 1. Une liste faite pour ce livrable

Écris 8 à 15 lignes oui/non qui testent **le livrable par rapport à la demande**, pas ton effort. Chaque ligne se vérifie en regardant. Exemples :

- **Page ou site** : chaque lien s'ouvre ; téléphone et adresse justes et cliquables ; prix et horaires conformes à ce que le patron a donné ; mentions légales et page de confidentialité présentes ; lisible en largeur téléphone et sur ordinateur, en clair et en sombre ; images avec un texte de remplacement ; le formulaire envoie vraiment ; pas de « lorem », pas de texte provisoire, pas de note oubliée.
- **E-mail de masse ou lettre d'info** : la bonne liste ; l'objet et la première ligne disent l'essentiel ; chaque lien marche ; lien de désinscription présent ; nom et expéditeur justes ; un essai envoyé d'abord au patron.
- **Devis ou facture** : nom du client, montants, TVA et totaux recalculés ; dates ; conditions de paiement ; aucune donnée d'un autre client.
- **Lancement (boutique, campagne, offre)** : ce qu'on surveille le premier jour ; qui répond aux clients ; le plan B si ça casse (retirer la page, mettre la pub en pause) ; la date et l'heure validées par le patron.

## 2. Deux relecteurs indépendants

Lance deux aides (helper_start). Donne à chacune **la même chose** : la demande d'origine, le livrable (ou son adresse) et la liste, et rien de la réponse de l'autre. Demande à chacune de marquer chaque ligne BON ou PAS BON avec le problème exact, et de séparer ce qui bloque des simples suggestions.

- Les deux disent BON : c'est prêt.
- Sinon : corrige **tout** ce qui bloque, puis refais les deux relectures sur la nouvelle version.
- Si les deux ne sont toujours pas d'accord après trois tours, arrête-toi et montre au patron les points restants : c'est lui qui tranche.

Si les aides ne sont pas disponibles, relis deux fois toi-même, la seconde fois en repartant de la liste seule, et dis-le.

## 3. Note ton propre travail

Donne-toi de 1 à 5 sur chaque point, avec une ligne de preuve pour toute note sous 5 (« montre le manque ») :
- **Juste** : faits, chiffres, noms, prix corrects.
- **Complet** : tout ce qui était demandé est là.
- **Clair** : un non-spécialiste comprend.
- **Utilisable** : la personne peut agir tout de suite.
- **Court** : pas de remplissage.

Signale où tu étais plus sûr de toi que tes preuves ne le permettent.

## 4. Prouve que c'est parti

Après un envoi approuvé, vérifie le vrai résultat : le message est dans le dossier **Envoyés** de la bonne boîte, la page répond à son adresse (web_fetch ou browser_open), le post apparaît. Ne dis jamais « envoyé » ou « publié » sans cette preuve ; si tu ne peux pas vérifier, dis-le.

## 5. Réparer un livrable qui ne marche pas

1. Reproduis le problème toi-même et note exactement ce qui se passe (message, capture).
2. Trouve le plus petit changement qui le règle ; change une seule chose à la fois.
3. Repasse la liste sur tout le livrable, pas seulement sur la ligne corrigée.
4. Dis au patron ce qui n'allait pas, ce que tu as changé et comment tu as vérifié.

Envoyer, publier et payer gardent leurs cartes d'accord : cette compétence ajoute des contrôles, elle ne remplace jamais un accord.
