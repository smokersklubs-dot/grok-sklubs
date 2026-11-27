---
name: Préciser une demande de page
description: Transformer une demande vague de page, d'écran ou de visuel (« une jolie page pour mon restaurant ») en cahier précis - but et ambiance en une ligne, l'appareil, des sections numérotées, des mots d'ambiance qui veulent dire quelque chose, les couleurs par rôle tirées de la charte - avant de la construire avec page_publish, artifact_create ou image_generate.
---

> Adaptée de google-labs-code/stitch-skills « enhance-prompt » (© 2026 Google LLC, Apache License 2.0). Modifiée pour Sklubot (22/11/2026) : réécrite comme un cahier pour les pages, artefacts et images Sklubot au lieu de consignes pour l'outil de design d'origine ; la charte remplace le fichier de design d'origine ; traduite en français.

# Préciser une demande de page

Une demande vague donne une page passe-partout. Cinq minutes de précision donnent une page qui ressemble à l'affaire du patron.

## 1. Qu'est-ce qui manque ?

| Point | À vérifier | S'il manque |
|---|---|---|
| Appareil | téléphone d'abord, ordinateur, les deux | téléphone d'abord pour un commerce ou un restaurant |
| Type de page | accueil, carte, réservation, produit, événement, formulaire | déduis-le de la demande |
| Sections | les blocs dans l'ordre | propose-les (plus bas) |
| Ambiance | des mots qui décrivent une allure | traduis (plus bas) |
| Couleurs et polices | celles de la charte | lis ~/team/charte.md ou applique « Design de marque » |
| Vrai contenu | prix, horaires, adresse, photos, textes | demande en une question groupée ; n'invente jamais |

Si un point change vraiment tout (par exemple à qui s'adresse la page), pose une question avec ta réponse conseillée (ask_user) ; sinon choisis et dis-le en une ligne.

## 2. Des mots précis

| Vague | Précis |
|---|---|
| « un menu en haut » | barre du haut avec le logo, 3 à 5 liens et un bouton « Réserver » |
| « un bouton » | bouton d'action principal (« Commander », « Appeler ») |
| « une liste » | grille de cartes avec photo, nom, prix — ou liste avec petites photos |
| « une zone photo » | premier écran avec une grande photo, un titre, une phrase et le bouton principal |
| « moderne » | épuré, beaucoup d'espace, une seule couleur d'accent, des formes simples |
| « professionnel » | sobre, rassurant, contraste fort, détails discrets |
| « fun » | couleurs vives, formes arrondies, titres vivants |
| « mode sombre » | fond sombre, texte clair, accents bien contrastés |

## 3. Le cahier

```
<Une ligne : le but de la page et son ambiance>

ALLURE (tirée de la charte) :
- Appareil : <téléphone d'abord / ordinateur>
- Thème : <clair ou sombre>, <3 mots d'ambiance>
- Fond : <nom> (#hex) · Accent : <nom> (#hex) pour <rôle> · Texte : <nom> (#hex)
- Polices : <titres> / <texte> · Formes : <coins, ombres>

SECTIONS :
1. <Premier écran> : <titre, phrase, action principale>
2. <…>
n. <Pied de page> : adresse, horaires, téléphone, mentions légales

CONTENU À FOURNIR : <photos, prix, textes encore manquants>
```

Montre le cahier, applique les corrections du patron, puis construis. Pour un site de plusieurs pages, enregistre-le comme cahier de la page suivante (voir « Site en plusieurs passes »).
