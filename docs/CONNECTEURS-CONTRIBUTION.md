# Proposer un connecteur pour Sklubot

Ce guide dit comment ajouter une appli au catalogue de Sklubot (Réglages → Applis), et quelles preuves il faut
avant qu'elle soit acceptée. Il vaut pour une personne comme pour une IA : un dossier écrit par une IA a les mêmes
exigences.

> Adapté de la documentation de n8n-io/nod (`docs/src/content/docs/contribute/apps/approval.md`, `test.md`,
> `api-and-cli.md`, commit `0f9de28`), Copyright 2026 n8n GmbH, licence Apache-2.0 — traduit, raccourci et ramené au
> format de Sklubot. Voir `THIRD_PARTY_NOTICES.md`.

## 1. Les trois façons de brancher une appli

| Façon | Quand | Où ça vit dans Sklubot |
|---|---|---|
| **Serveur MCP distant** | Le fournisseur publie un serveur MCP (adresse `https://…/mcp`) | Une entrée du catalogue (`server/src/catalog.ts`) |
| **API HTTP** | Pas de MCP, mais une API officielle documentée | Un connecteur API proposé par un bot et approuvé par toi (`server/src/apiconnectors.ts`) |
| **Outil en ligne de commande** | Le fournisseur publie un outil officiel, à version fixe | Un serveur d'outils lancé dans l'ordinateur du bot (`server/src/localtools.ts`) |

Un serveur MCP **sur ton propre réseau** (un n8n chez toi, sur Tailscale) s'ajoute à la main : Réglages → Applis →
« Ajouter par son adresse », case « Cette adresse est sur mon propre réseau ». Seulement sur un Sklubot que tu héberges
toi-même ; Sklubot ne joint que cette adresse et ne lui envoie sa clé qu'à elle. Un bot ne peut jamais proposer une
telle adresse.

Si le serveur refuse le transport MCP récent (« Streamable HTTP »), Sklubot réessaie tout seul avec l'ancien
transport HTTP+SSE, avec les mêmes contrôles. Une appli ajoutée à la main peut être renommée (icône crayon).

## 2. Le format d'une entrée du catalogue

Une entrée = un objet `CatalogApp` (`server/src/catalogtypes.ts`) :

| Champ | Obligatoire | Sens |
|---|---|---|
| `id` | oui | Identifiant stable, en minuscules (`agentmail`). Ne change plus jamais : les comptes connectés y sont liés. |
| `name` | oui | Nom affiché, celui du fournisseur. |
| `category` | oui | Une des catégories déjà utilisées dans `catalog.ts`. |
| `description` | oui | Une phrase : ce que le bot pourra faire, sans promesse. |
| `url` | oui | L'adresse **officielle** du serveur MCP, en `https://`. |
| `instanceUrl` | non | `true` si chaque personne donne l'adresse de sa propre instance. |
| `auth` | oui | `"oauth"`, `"token"` ou `"none"`. |
| `oauthClient` | si OAuth | `"dynamic"` (le fournisseur accepte l'inscription automatique) ou `"manual"` (la personne colle son identifiant client). |
| `tokenHelp` | si jeton | Où trouver le jeton chez le fournisseur, en mots simples. |

Règles : aucun identifiant, jeton ou secret dans le fichier ; une seule adresse par entrée ; le jeton n'est envoyé qu'à
cette adresse ; textes en français et en anglais.

## 3. Les tests obligatoires

- `npm run typecheck` et `npm test` passent.
- Un test (dans `server/test/`) contre un **faux serveur** local qui joue le contrat documenté du fournisseur :
  - l'outil de lecture est bien découvert (nom, champs requis) ;
  - le jeton part avec le bon schéma (`Authorization: Bearer …` ou l'en-tête documenté), et **seulement** vers l'adresse
    de l'entrée ;
  - une erreur du fournisseur (refus, quota, accès retiré) garde sa raison précise et n'est jamais transformée en succès ;
  - un appel refusé (401, 403, 429) n'est pas renvoyé une seconde fois tout seul ;
  - un appel arrêté avant l'envoi n'atteint pas le fournisseur.
- Aucun test ne joint un vrai service, un vrai compte ou un vrai destinataire. Données d'exemple seulement
  (`sk-fake-for-tests`, `camille@example.com`).

## 4. Les preuves à fournir (liste de contrôle)

Une entrée n'est acceptée qu'avec **toutes** ces preuves dans la demande de fusion :

- [ ] **Contrat du fournisseur** : lien vers la documentation officielle de l'interface, de la connexion, des droits
      demandés et de l'opération de lecture.
- [ ] **Connexion** : chaque méthode annoncée (OAuth, jeton) essayée pour de vrai, une par une, avec un compte jetable.
- [ ] **Utilité** : deux ou trois exemples de demandes concrètes, les conditions de compte, les limites honnêtes.
- [ ] **Tests** : sortie des commandes de la section 3.
- [ ] **Vie privée et accords** : aucun secret dans les fichiers ; les accords habituels de Sklubot (vérificateur,
      plancher, coffre) s'appliquent sans exception ; les erreurs gardent leur raison.
- [ ] **Reprise** : reconnexion, déconnexion, accès refusé, jeton expiré ou révoqué — chacun vérifié.
- [ ] **Écriture** : toute écriture annoncée essayée sur un **enregistrement d'essai réversible** du compte jetable,
      puis nettoyée ; jamais de nouvel essai automatique après un échec.
- [ ] **Fiche** : nom exact, droits sur le logo, conditions, exemples, limites, liens.
- [ ] **Entretien** : un mainteneur nommé, et le moyen de signaler un changement chez le fournisseur.
- [ ] **Ce qui n'a pas été vérifié** est écrit noir sur blanc.

Pour une API HTTP : vérifier aussi l'adresse de base, l'en-tête d'authentification et que les appels ne sortent pas de
ce préfixe. Pour un outil en ligne de commande : source officielle, **version exacte** (ou empreinte SHA-256 du
téléchargement), fonctionnement sous Linux sans terminal interactif, commande de lecture, arguments séparés (jamais une
chaîne de shell), aucun secret dans les arguments.

## 5. Ce que l'acceptation veut dire

Passer les tests ne suffit pas : une personne qui maintient Sklubot relit les changements et les preuves, et peut
demander un périmètre plus étroit. Ni l'auteur ni une IA ne peut s'accepter soi-même. Le catalogue n'est ni une page
d'état en direct, ni une certification du fournisseur : l'accord vaut pour la version relue.

Quand une adresse, un droit, une méthode de connexion ou le test change : relancer les tests et refaire l'essai réel
concerné. Garder l'`id` stable ; expliquer toute reconnexion nécessaire.
