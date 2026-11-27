---
name: Page d'un commerce par métier
description: Construire la page d'un petit commerce pour qu'elle fonctionne comme les bons sites de son métier - nommer ce que vient faire le visiteur (réserver, venir, acheter, assister, faire appel…), suivre l'anatomie du métier, choisir une structure de page, faire le premier écran d'abord, demander une fois la vraie matière (photos, chiffres, citations), ne jamais inventer un fait, et la relire à froid avant de la remettre.
---

> Adaptée de Hallmark (© 2026 Hallmark contributors, MIT) : son « plancher », l'anatomie par mission du visiteur, les structures de page et les étapes « premier écran d'abord » et « relecture à froid ». Modifiée pour Sklubot (22/11/2026) : condensée pour les pages de petits commerces publiées avec page_publish, ses scripts, son tirage de thèmes et son vérificateur remplacés par une courte feuille de style de base et des contrôles dans le navigateur du bot, ligne de sponsor et nom du produit retirés de la méthode, traduite en français.

# Page d'un commerce par métier

Une page faite sans connaître le métier a l'air générée. Les vrais sites d'un métier ont une forme commune : où se trouve l'action, quelles sections, comment ils se terminent.

## 1. Demander une fois, en un seul message

« Avant de construire, quatre choses : 1. **La matière**, le plus important : tes photos, de vrais chiffres (prix, horaires, années, clients), une phrase de client avec le nom de son auteur, les logos que tu as le droit d'utiliser. 2. **Pour qui** est la page. 3. **Ce que les visiteurs doivent faire** (réserver, venir, commander, appeler). 4. **Le ton**. » Ce qui reste sans réponse : déduis-le et dis-le en une ligne. **Les faits ne se déduisent jamais** : un prix, une date, une citation ou un chiffre non donné reste un blanc visible à remplir (« Horaires à venir »), deux au plus sur la page, listés dans ta remise.

## 2. La mission du visiteur et l'anatomie du métier

- **Réserver** (restaurant, cours, cabinet, salon) : l'action de réservation dans la barre du haut et le premier écran, de nouveau à côté de la carte ou du planning ; sections : la salle ou les plats en photo, la carte avec les prix, le planning, comment venir, horaires et adresse. Se termine par horaires, adresse et réservation.
- **Venir** (boutique, galerie, lieu) : les horaires du jour et l'adresse en haut ; ce qui se passe maintenant ; ce qui arrive, en lignes datées ; pour une boutique, les rayons avec les produits du patron ; comment venir.
- **Acheter** (un produit, une petite boutique) : le produit avec son prix et ses options, souvent en premier écran ; la gamme avec les prix ; le produit utilisé, de près ; comment il est fait ; livraison et garantie en faits simples ; des avis seulement s'ils sont fournis.
- **Assister** (événement, salon, course) : la date et le lieu sont le titre ; les billets dès le premier écran ; le programme par jour ; les prix ; le lieu et l'accès ; les questions.
- **Faire appel** (artisan, atelier, indépendant) : un contact simple (téléphone, e-mail) en haut et après les réalisations ; les réalisations sont la page : projets avec photos, un détaillé comme cas ; ce qu'il fait en courte liste ; où.
- **Adhérer** (club, association, abonnement) : « ta première visite » en haut ; à quoi ressemble une séance, montré ; quand et où ; les prix ; les conseils pour la première fois.
- **S'abonner** (lettre d'info, liste d'attente) et **Écouter** (groupe, podcast) : le dernier numéro ou la dernière sortie avec ses boutons côte à côte ; les dates en lignes ; les œuvres précédentes.
- **Essayer** (une appli) : les boutons des boutiques sous le titre ; des écrans du vrai produit.

Les pages se terminent, dans l'ordre des vrais sites : l'action principale de nouveau dans un court bandeau ; les infos pratiques (horaires, adresse, contact) ; plus du catalogue ; une courte ligne de confiance (garantie, presse) si elle est fournie ; une inscription à la lettre d'info seulement pour ce qui revient.

## 3. Choisir une structure (une seule)

Photographique (une immense photo par écran, peu de texte) · Catalogue (une grille régulière des produits) · Long document (se lit comme une lettre ou une carte) · Grille en blocs (blocs de tailles différentes, chacun une vraie chose) · Atelier partagé (texte d'un côté, preuve de l'autre) · Lettre (à la première personne, du patron) · Questions-réponses · Affiche (une phrase forte remplit le premier écran) · Index (une liste de liens). Choix typiques : restaurant ou café → Photographique, Long document ou Catalogue ; boutique → Catalogue, Photographique ou Grille en blocs ; artisan ou atelier → Atelier partagé ou Index ; événement → Affiche ou Photographique.

## 4. Construire : le premier écran d'abord

- Premier écran : un titre de sept mots au plus, une phrase de douze mots au plus, une ou deux actions, tout visible sans défiler sur un écran de 1280 × 800 et sur un téléphone.
- Six à neuf sections en tout, environ 80 mots par écran, une idée par écran.
- Montrer, pas décrire : les photos du patron ; sinon un emplacement d'image bien signalé, jamais une photo de banque d'images présentée comme la sienne.
- Un seul style de bouton principal, une seule largeur de contenu, un seul arrondi par niveau, deux familles de polices au plus, texte courant de 16 px ou plus.

Pars de cette feuille de style de base (adapte les valeurs à la charte) :

```css
:root{--bg:#fbfaf7;--text:#1d1c1a;--muted:#6b675f;--accent:#9a3b1f;--font-head:"Fraunces",Georgia,serif;--font-body:"Source Sans 3",system-ui,sans-serif;--radius:10px;--max:72rem}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--text:#f1eee8;--muted:#a7a196;--accent:#e08a66}}
html,body{overflow-x:clip;margin:0;background:var(--bg);color:var(--text);font:1rem/1.6 var(--font-body)}
.wrap{max-width:var(--max);margin-inline:auto;padding-inline:clamp(16px,4vw,40px)}
h1,h2,h3{font-family:var(--font-head);overflow-wrap:break-word;min-width:0;line-height:1.15}
.grid{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))}
img{max-width:100%;height:auto;display:block}
a,button{min-height:44px}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;transition:none}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
.fill{color:var(--muted);outline:1px dashed var(--muted);padding:0 4px}
```

## 5. Règles fermes (jamais)

Chiffres, avis, murs de logos ou nombres de clients inventés · `transition: all`, ou animer largeur, hauteur, top, left · `overflow-x: hidden` ou des largeurs en `100vw` · une animation sans solution pour le mouvement réduit · du contenu invisible sans scripts · un dégradé violet-bleu, une carte dans une carte, des émojis en guise d'icônes · de petites étiquettes en capitales espacées au-dessus des titres · des couleurs ou des polices écrites hors des variables.

## 6. La relire à froid

Ouvre la page publiée (browser_open ; screen_view en largeur téléphone et ordinateur, clair et sombre) comme un visiteur qui la découvre : est-ce que je vois ce que c'est, où, quand, combien, et quoi faire, en cinq secondes ? Corrige, puis applique « Vérifier avant de livrer ». Termine ton message par la matière qui manque encore (chaque blanc et ce qui doit y aller) et la photo ou le fait qui améliorerait le plus la page.
