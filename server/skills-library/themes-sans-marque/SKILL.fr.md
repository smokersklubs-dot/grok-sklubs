---
name: Thèmes sans marque
description: Choisir un thème prêt pour une page quand le patron n'a pas de charte - dix matières complètes gardées en fichiers (jetons en OKLCH, polices, surfaces, contrôles, mouvement, ton, ce qu'il faut éviter), choisies selon les mots du sujet, deux ou trois proposées avec une raison, puis appliquées seulement par les jetons de la page.
---

> Adaptée de Hallmark (github.com/Nutlope/hallmark, commit 04977e1 ; © 2026 Hallmark contributors, MIT) : dix de ses fichiers de thèmes et sa règle « un thème est une matière, jamais un contenu ». Modifiée pour Sklubot (22/11/2026) : dix thèmes gardés en fichiers de cette compétence (lignes d'image et renvois aux scripts d'origine retirés), choix et vérifications écrits pour un bot Sklubot, traduite en français.

# Thèmes sans marque

Ici, un thème est une **matière** : papier, encre, polices, filets, arrondis, profondeur, contrôles, mouvement et ton. Il ne décide jamais de ce que contient la page ni de l'ordre (c'est le rôle de la page et des « Règles de mise en page »). Aucun thème ne porte un nom de marque et aucun n'imite une vraie entreprise : utilise-les quand le patron n'a pas encore de charte, ou pour proposer une direction.

## Les dix thèmes (fichiers gardés avec cette compétence)

| Fichier | Nom | Papier | Va avec des mots comme |
|---|---|---|---|
| `atelier.md` | Atelier | clair | fashion, atelier, couture, fragrance, gallery, exhibition |
| `bloom.md` | Bloom | clair | generative, ai creative, music, song, video, image |
| `cobalt.md` | Cobalt | clair | api, sdk, cli, dev tool, developer platform, docs |
| `coral.md` | Coral | clair | saas, platform, billing, payments, invoicing, dashboard |
| `dose.md` | Dose | clair | health, medication, pharmacy, care, carer, family |
| `dusk.md` | Dusk | sombre | treasury, banking, fintech, payments, reconciliation, ledger |
| `furrow.md` | Furrow | clair | farm, agriculture, land, field, livestock, sheep |
| `kiln.md` | Kiln | sombre | kiln, ceramics, pottery, firing, glaze, heat |
| `newsprint.md` | Newsprint | clair | newspaper, broadsheet, journalism, publication, magazine, newsletter |
| `terrazzo.md` | Terrazzo | clair | materials, library, architects, samples, catalogue, surfaces |

## Comment choisir

1. Si le patron a une charte (`~/team/charte.md`), elle passe avant : utilise « Design de marque » à la place.
2. Sinon, lis le sujet et rapproche ses mots de la colonne « va avec des mots comme ». Garde les deux ou trois thèmes les plus proches.
3. Propose-les au patron en une ligne chacun (la ligne « material » du fichier et pourquoi il convient), et laisse-le choisir. Sans réponse, prends le premier et dis pourquoi.
4. Lis le fichier choisi avec skill_read (file : son nom).

## Comment l'appliquer

- Copie son bloc `:root` comme jetons de la page, puis n'utilise que ces jetons dans le CSS : plus aucune couleur ni police en dur ensuite.
- Charge ses polices avec la ligne de lien du fichier (ou garde les polices de secours qu'il nomme si la page ne peut pas charger de polices).
- Suis ses parties Type, Surfaces, Controls et Motion ; respecte ses Do-nots.
- Ajoute une version sombre si le thème est clair (ou l'inverse) en changeant seulement les jetons de papier et d'encre, et vérifie le contraste du texte (4,5:1 au moins) dans les deux.
- Vérifie ensuite la page comme le disent les « Règles de mise en page » (390 px et ordinateur, clavier, mouvement réduit).

## Jamais

- Ne nomme et n'imite jamais l'allure d'une vraie marque ; ne mélange jamais deux thèmes sur une page.
- Ne laisse jamais un thème ajouter un contenu, une section ou un objet dont la page n'a pas besoin.
