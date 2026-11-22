---
name: Testeur de site
description: Tester un site ou une page comme le ferait un client avant (et après) sa mise en ligne - visiter chaque partie, cliquer, remplir les formulaires, essayer des saisies vides et fausses, en largeur téléphone et ordinateur - et écrire un rapport où chaque problème a ses étapes et une capture, pour pouvoir le reproduire et le corriger.
---

> Adaptée de vercel-labs/agent-browser « dogfood » avec son modèle de rapport et sa liste de problèmes (© 2025 Vercel Inc., Apache License 2.0). Modifiée pour Sklubot (22/11/2026) : le navigateur en ligne de commande et son enregistrement vidéo remplacés par les outils de navigateur de Sklubot (browser_open, element_snapshot, element_click, element_type, screen_view, browser_tabs) et des captures ; connexion par le coffre et la prise de main du patron ; rapport enregistré en fichier Sklubot ; traduite en français.

# Testeur de site

Teste comme un client pressé, sur téléphone, qui fait des erreurs. Chaque problème que tu signales doit pouvoir être reproduit.

## Préparation

Seule l'adresse est nécessaire. Par défaut : tout le site, largeur téléphone d'abord, puis ordinateur ; rapport dans ta bibliothèque (tests/<site>-<date>.md). Si une partie demande une connexion, utilise un identifiant enregistré dans le coffre (vault_type) ou demande au patron de prendre la main pour un code (ask_takeover). Ne teste jamais un paiement avec de l'argent réel et n'envoie jamais une vraie commande, un vrai message ou une vraie réservation sans l'accord du patron : arrête-toi à la dernière étape et note-le.

## Le parcours

1. **S'orienter** : ouvre l'accueil (browser_open), liste ses éléments (element_snapshot), note le menu principal et le parcours principal (trouver, choisir, contacter ou acheter).
2. **Explorer partie par partie**, en passant le plus de temps sur ce qui rapporte de l'argent ou des contacts :
   - clique sur chaque bouton et chaque lien de la partie (element_click), ouvre menus et fenêtres, vérifie que chacun ouvre la bonne chose (browser_tabs pour les nouveaux onglets) ;
   - remplis les formulaires (element_type) : un cas normal, puis des champs vides, un e-mail faux, un texte très long, des accents et une apostrophe (« Zoé O'Neil ») ;
   - regarde les états vides et d'erreur, la page 404, ce qui se passe avec le bouton retour ;
   - vérifie les infos pratiques : téléphone cliquable, adresse et carte justes, horaires et prix identiques partout, mentions légales présentes ;
   - regarde chaque page (screen_view) en largeur téléphone et ordinateur, en clair et en sombre si le site gère les deux.
3. **Noter tout de suite** : quand quelque chose ne va pas, arrête-toi et note-le avant de continuer.

## Chaque problème

- **Titre** en mots simples (« Le formulaire de réservation accepte une date vide »).
- **Gravité** : bloquant (un client ne peut pas aller au bout) · important (déroutant, information fausse) · mineur (apparence) · suggestion.
- **Où** : adresse de la page et élément.
- **Étapes** : numérotées, depuis l'accueil, à un rythme humain, avec une capture des étapes qui comptent et du résultat cassé.
- **Attendu** et **ce qui se passe**.
Ne signale pas ce que tu n'arrives pas à reproduire deux fois ; note-le à part comme « vu une fois ».

## Quoi chercher

Liens et boutons cassés · formulaires qui n'envoient rien ou perdent ce qui a été tapé · messages d'erreur absents ou flous · faits faux ou contradictoires (prix, horaires, adresse) · texte coupé ou qui se chevauche en largeur téléphone · défilement de côté · images absentes, floues ou très lentes · commandes trop petites pour le doigt · rien de visible au focus clavier · texte provisoire oublié · pages très lentes à afficher quelque chose · fautes dans les titres et les boutons.

## Le rapport

Commence par un résumé : combien de problèmes par gravité, les trois à corriger d'abord, ce qui n'a **pas** été testé (zones connectées, paiement). Puis les problèmes, les bloquants d'abord. Enregistre-le (file_save) et montre-le (file_send). Pour les pages que tu as publiées, propose de les corriger (page_edit) et reteste ; si le patron veut ce contrôle régulièrement, propose une routine (routine_create lui montre une carte à accepter).
