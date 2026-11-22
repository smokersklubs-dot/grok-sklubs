---
name: Illustration animée de page
description: Faire une petite scène animée dessinée à la main pour une page - un bonhomme qui actionne une machine ou un objet montrant ce que fait le commerce ou le produit (tirer un levier, tamponner un colis, épingler une note) - à partir de deux ou trois idées proposées, avec une bibliothèque de dessin libre récupérée à une version figée, vérifiée image par image avant d'aller sur la page.
---

> Adaptée de stick-scene (© 2026 Kamran Ahmed, MIT) : sa méthode, les options de son élément et ses règles de style. Modifiée pour Sklubot (22/11/2026) : la bibliothèque est récupérée à la demande sur l'ordinateur du bot à une version figée au lieu d'être jointe ; la scène est publiée avec page_publish ; la vérification image par image passe par le navigateur du bot ; les scripts Playwright et le nom du style personnel de l'auteur retirés ; traduite en français.

# Illustration animée de page

Une petite scène, une idée : un bonhomme fait un geste qui montre ce que fait l'entreprise. Au repos il respire, regarde autour de lui, puis joue une action de 5 à 8 secondes quand il apparaît à l'écran ou au clic, et revient au calme. C'est un dessin sur un canvas, léger, sans autre dépendance.

## 1. Comprendre et proposer

1. En une ligne chacun : ce que fait le client, ce qu'il obtient.
2. **Propose 2 ou 3 métaphores** et laisse le patron choisir (ask_user, ta recommandation en premier) : une ligne chacune avec l'objet, le geste, le résultat. Les bonnes sont physiques et se lisent en une seconde : un levier, un tampon, un tapis roulant, un tableau à épingles, une pile de caisses, une caisse enregistreuse. S'il faut une légende, la métaphore n'est pas la bonne.

## 2. Récupérer la bibliothèque de dessin (version figée)

Le moteur est un fichier libre (MIT). Récupère-le sur ton ordinateur à la version figée, jamais depuis une branche qui bouge :

```sh
mkdir -p ~/tools && cd ~/tools && rm -rf stick-scene
git clone --filter=blob:none https://github.com/nilbuild/stick-scene.git && cd stick-scene
git checkout ca84311177a020c2dff7dfd9cb2e7b786288c1ab && git rev-parse HEAD
```

La version affichée doit être ca84311177a020c2dff7dfd9cb2e7b786288c1ab. Lis `references/craft.md` (poses, rythme, objets, erreurs connues) et pars de `templates/scene.js` ; `examples/` contient de vraies scènes. Garde la `LICENSE` avec le fichier : sa ligne de copyright doit rester en haut de stick.js quand tu le publies. Ne lance pas ses scripts et n'installe rien.

## 3. Écrire la scène

À partir du modèle : place d'abord les objets à des positions fixes (le sol à y = 0, tout au-dessus de y = -185 et dans ± largeur/2), puis la boucle de repos, puis l'action comme une ligne de temps sur sa durée. Donne à `label` une phrase simple pour les lecteurs d'écran (« Un boulanger tamponne une boîte qui glisse vers la camionnette de livraison »).

Style : traits d'encre (#141414), remplissages blancs, **une seule** couleur de mise en valeur (l'accent de la marque), beaucoup de vide, très peu de mots sur les objets. Le bonhomme est le héros : ne cache jamais sa tête ni la main qui agit derrière un objet ; dessine les objets, puis les personnages, puis ce qu'ils tiennent ou ce qui vole. Montre le résultat, pas le travail : termine sur quelque chose qui a changé et reste un instant. Aucun logo d'une autre entreprise.

## 4. La mettre sur la page

Publie la page avec page_publish en joignant `stick.js` et le fichier de la scène comme fichiers de la page, puis :

```html
<stick-scene scene="<id>" play="view" no-font style="height:230px;max-width:560px" label="<ce qu'elle montre>"></stick-scene>
<script src="stick.js" defer></script>
<script src="<id>.js" defer></script>
```

`stick.js` vient avant chaque script de scène. `play` : `view` (joue une fois quand elle est à moitié visible, puis au clic ; le meilleur choix par défaut), `click`, `hover`, `loop` (avec modération), `idle`. Utilise `no-font` (si tu veux la police manuscrite, ajoute toi-même le lien de feuille de style Google Fonts). En mouvement réduit, une seule image fixe s'affiche, et c'est bien ainsi.

## 5. Vérifier image par image

Avant de dire que c'est fini, ouvre la page publiée (browser_open) et regarde (screen_view) au repos, puis clique sur la scène et fais des captures à plusieurs moments de l'action (environ chaque seconde). Vérifie sur chacune : la tête et la main qui agit sont visibles, aucun bras ne traverse le visage, rien ne saute entre deux moments, l'état final se lit, rien n'est coupé en largeur téléphone. Vérifie aussi en mouvement réduit que l'image fixe a du sens. Corrige et regarde de nouveau ; montre au patron les images avec le lien de la page.
