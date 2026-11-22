---
name: Accessibilité mesurée
description: Auditer l'accessibilité d'une page publiée par le bot (ou du site du patron) et la corriger - un audit automatique quand Lighthouse ou axe est disponible sur l'ordinateur du bot, puis titres et repères, noms des boutons, champs et images, clavier et focus, zones à toucher, contraste, zoom et mouvement - avec un court rapport de ce qui échoue, où, et la correction.
---

> Adaptée de chrome-devtools-mcp « a11y-debugging » (© 2025-2026 Google LLC, Apache License 2.0) et de agent-skills « accessibility-engineering » avec sa liste d'accessibilité (© 2025 Addy Osmani, MIT). Modifiée pour Sklubot (22/11/2026) : les outils du serveur DevTools remplacés par les outils de navigateur de Sklubot (browser_open, element_snapshot, screen_key, screen_view) et un audit facultatif en ligne de commande sur l'ordinateur du bot ; script d'installation retiré ; traduite en français.

# Accessibilité mesurée

Une page accessible marche pour les personnes qui utilisent un clavier, un lecteur d'écran, un écran agrandi ou un téléphone en plein soleil, et elle est meilleure pour tout le monde. On mesure, on ne devine pas.

## 1. Audit automatique (quand l'outil est là)

Sur ton ordinateur, vérifie si un outil d'audit est déjà installé (shell_run : `command -v lighthouse`, `command -v axe`). S'il y en a un :
- Lighthouse : `lighthouse <adresse> --only-categories=accessibility --output=json --output-path=/tmp/a11y.json --chrome-flags="--headless" --quiet`, puis liste seulement les échecs (un court filtre `node -e` ou `jq` sur les audits dont le score est sous 1 : id, titre, sélecteur, extrait). Ne lis pas tout le rapport.
- axe : `axe <adresse> --exit` et lis les violations.
S'il n'y a aucun outil, n'en installe pas de toi-même : dis lequel aiderait et demande au patron (installer un logiciel sur l'ordinateur du bot, c'est son choix). Les contrôles à la main ci-dessous trouvent déjà la plupart des problèmes.

Un audit automatique trouve environ un tiers des problèmes. Fais toujours la partie manuelle.

## 2. Structure

Ouvre la page (browser_open) et liste ses éléments (element_snapshot).
- Un seul `h1`, puis des titres dans l'ordre (pas de saut de h2 à h4) ; les titres décrivent leur partie.
- Repères : `header`, `nav`, `main`, `footer` ; un lien « Aller au contenu » quand le menu est long.
- `<html lang="…">` correspond à la langue ; la page a un `<title>` parlant.
- L'ordre de lecture du relevé correspond à ce que tu vois à l'écran (screen_view).

## 3. Les noms

- Chaque bouton et chaque lien a un nom compréhensible hors contexte (« Réserver une table », pas « Cliquez ici » ; un bouton avec seulement une icône reçoit un `aria-label`).
- Chaque champ a une étiquette visible qui lui est reliée ; les erreurs sont en texte, reliées au champ.
- Chaque image qui informe a un texte de remplacement qui dit ce qu'elle montre ; les images décoratives `alt=""`.
- Utilise les éléments natifs ; ARIA seulement pour combler un vrai manque, jamais `role="button"` sur un `div` quand un `<button>` suffit.

## 4. Clavier et focus

Appuie sur Tab depuis le haut (screen_key « Tab »), plusieurs fois, et regarde (screen_view) :
- chaque commande est atteinte, dans un ordre logique, avec un focus **bien visible** ;
- rien ne bloque le focus, sauf une fenêtre de dialogue ouverte, qui le garde à l'intérieur et le rend à la fermeture (Échap marche) ;
- menus, onglets et accordéons marchent avec Entrée, Espace, les flèches et Échap ;
- rien d'important n'apparaît seulement au survol.

## 5. Contrôles visuels

- **Contraste** : texte d'au moins 4,5:1 sur son fond (3:1 pour les grands textes, les icônes et les bordures de champs). Calcule-le à partir des couleurs des styles ; sur une photo, regarde la capture et ajoute un fond si tu as un doute.
- **Pas seulement la couleur** : erreurs, champs obligatoires, onglet choisi ont aussi un mot ou une forme.
- **Zones à toucher** d'au moins 44 × 44 px, espacées.
- **Zoom** : à 200 % de texte et à 320 px de large, rien n'est coupé ni ne se chevauche, pas de défilement de côté pour lire.
- **Mouvement** : les animations s'arrêtent en mouvement réduit ; rien ne clignote plus de trois fois par seconde ; les vidéos ont des sous-titres.

## 6. Rapport et corrections

Écris un court tableau : problème · où (élément ou sélecteur) · qui ça bloque · correction · état. Corrige ce que tu peux sur les pages que tu as publiées (page_edit), puis revérifie avec les mêmes étapes. Pour le site du patron, donne la liste en mots simples avec des priorités : ce qui bloque quelqu'un d'abord, puis ce qui gêne, puis les finitions.
