# Méthode de la salle blanche

Sklubot recrée les *fonctions* d'un produit existant sans en reprendre le code, les textes, le nom ni
l'apparence. Ce document dit comment, pour que la démarche soit vérifiable.

## Les deux côtés

| Côté | Qui | Ce qu'il a vu | Ce qu'il a produit |
|---|---|---|---|
| **Étude** | Quatre agents d'analyse, un par source | Le code source de trois projets open source et une documentation publique | Uniquement des cahiers des charges fonctionnels en prose (`docs/cleanroom/`) |
| **Sas** | — | — | Seuls ces cahiers des charges franchissent le sas : pas de code, pas de textes d'interface, pas de prompts, pas d'identifiants |
| **Reconstruction** | L'agent principal (serveur) et un agent d'interface | Les cahiers des charges, jamais les sources | Tout le code de ce dépôt |

Consigne donnée à chaque agent d'étude : décrire le comportement, jamais l'implémentation ; ne recopier
ni code, ni commentaires, ni prompts, ni textes d'interface ; ne pas refléter l'arborescence d'origine ;
ne nommer que les faits publics de fournisseurs tiers.

## Sources étudiées

| Source | Licence | Cahier des charges |
|---|---|---|
| `nickvasilescu/grokbot-clone` | MIT | `01-core-product.md` |
| `elie222/rakazo` | Apache-2.0 | `02-capabilities-b.md` |
| `milind-soni/OpenMausBot` | Apache-2.0 | `03-capabilities-c.md` |
| Documentation publique `docs.x.ai/grok-bot` (31 pages) | pages publiques | `04-public-docs.md` |

Non utilisés : `morluto/rea` (outil d'analyse de binaires, sans objet ici puisque les sources sont ouvertes) ;
`Le-SAS-la-r-tro-ing-nierie` (a servi de règle de méthode, pas de source). Aucun fichier de l'application
propriétaire d'origine, aucun code décompilé, aucune fuite n'est entré dans le projet.

## Limite honnête de la méthode

L'agent principal a lu le fichier README public du premier projet avant de mettre le sas en place, puis
uniquement les cahiers des charges. Une salle blanche au sens strict sépare des *personnes* ; ici ce sont
des sessions d'IA distinctes, sans mémoire commune. C'est une précaution sérieuse, pas une garantie
juridique : ce document n'est pas un avis d'avocat.

## Identité propre

Nom, avatars (formes géométriques à monogramme), couleurs, textes d'interface, prompts des bots, noms
d'outils, schéma de base et API ont été conçus pour ce projet. Le nom et la marque du produit d'origine
n'apparaissent nulle part dans l'application.

## Choix d'architecture différents de la référence

- **Ordinateur** : un ordinateur Linux par bot dans un conteneur sur ton serveur, au lieu d'une machine
  virtuelle louée chez un fournisseur. Aucun compte tiers ; la vue en direct passe par des captures
  rafraîchies chaque seconde, pas par un flux d'écran continu.
- **Applications** : connecteurs au standard ouvert MCP, au lieu d'un catalogue d'un fournisseur unique.
- **Comptes** : e-mail et mot de passe locaux, au lieu d'une connexion déléguée à un service tiers.
- **Voix** : reconnaissance et synthèse vocales du navigateur, au lieu d'une API vocale temps réel payante.
- **Modèles** : au choix par bot (Claude par défaut, ou tout service compatible), au lieu d'un modèle unique.
- **Ajouts** : messages pris en compte en cours de tour, niveaux d'autonomie, routines par webhook et
  ponctuelles, compteur de coût et budget mensuel, garde-fou anti-boucle, compte rendu automatique des
  assistants, approbation avant les commandes.

## Écarts — ce qui n'est pas fait

Par rapport à la documentation publique du produit d'origine, Sklubot **ne couvre pas** :

- exécution sur ton propre poste, passage du trafic par ton poste, clés de sécurité matérielles ;
  flux d'écran continu (la vue en direct est une suite de captures) ;
- catalogue d'applications avec connexion OAuth en un clic, plusieurs comptes par application,
  déclencheurs natifs (messagerie d'équipe, tickets, e-mail entrant) — seul le webhook générique existe ;
- coffre d'identifiants et de moyens de paiement, formulaires sécurisés, achats ;
- voix temps réel avec interruption naturelle ; appels téléphoniques ; participation à des réunions ;
- adresse e-mail propre au bot ; présence dans des messageries tierces ;
- applications mobiles et de bureau ; notifications poussées ;
- pièces jointes dans la discussion, génération d'images et de vidéos, pages hébergées partageables ;
- fils, réactions, recherche dans les messages (la recherche porte sur les bots) ;
- bots partagés entre plusieurs personnes, rôles, modèles de bots publiables, administration d'entreprise
  (SSO, journaux d'audit, politiques réseau) ;
- enregistrement d'une démonstration à l'écran pour créer une compétence.
