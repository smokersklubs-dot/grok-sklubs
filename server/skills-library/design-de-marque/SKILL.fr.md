---
name: Design de marque
description: Avant de créer une page, un visuel ou un document pour l'utilisateur, retrouver et appliquer l'identité de sa marque (nom, couleurs, polices, logo, ton) au lieu d'en inventer une.
---

# Design de marque

Compétence originale de Sklubot.

## Retrouver la marque (dans cet ordre)

0. **La charte** : ~/team/charte.md sur ton ordinateur (écrite avec le patron grâce aux compétences « Entretien de marque » et « Fiche de charte (design) »). Quand elle existe, c'est la référence : lis-la en premier.
1. **Le profil partagé** (la section « À propos de l'utilisateur » de ton contexte) : entreprise, préférences.
2. **Tes souvenirs** : memory_search avec « marque », « couleurs », « logo », « charte », « police », le nom de l'entreprise.
3. **Les fichiers** : la charte graphique, le logo ou un ancien document que l'utilisateur t'a donnés (ta bibliothèque, ~/team sur ton ordinateur, ou un dossier qu'il partage avec Sklubot Relais — seulement s'il te l'a demandé).
4. **Son site** : s'il a un site officiel, ouvre-le (browser_open, page_read) pour relever les couleurs et les polices réellement utilisées.
5. **Sinon, demande** en une seule question courte (ask_user) : « Tu as des couleurs, une police ou un logo à respecter ? Sinon je propose un style. »

## Appliquer

- Reprends les valeurs exactes (codes hexadécimaux, noms de polices) ; ne les « améliore » pas. Si une couleur de la marque manque de contraste pour du texte (moins de 4,5:1), garde-la pour les aplats et les accents, et prends une nuance plus foncée ou plus claire pour le texte : dis-le.
- Logo : uniquement le fichier fourni par l'utilisateur, jamais redessiné ni retrouvé sur un autre site. Pas de logo fourni : le nom de l'entreprise en texte.
- Le ton des textes suit celui de la marque (tutoiement ou vouvoiement, sobre ou chaleureux).
- Garde ce que tu as appris pour la suite : memory_save en une phrase (« Marque X : bleu #1D4E89, police Source Sans 3, ton sobre »), ou profile_update si l'utilisateur veut que toute l'équipe le sache.

## Ne jamais

- Utiliser la marque, le logo ou les couleurs d'une autre entreprise (ni d'un client, ni d'une marque connue) sans que l'utilisateur ait le droit de le faire et le demande.
- Inventer une charte et la présenter comme celle de l'utilisateur.
