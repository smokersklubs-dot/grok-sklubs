---
name: Pages soignées
description: Quand un résultat se lit mieux en page qu'en message (rapport, tableau de bord, outil, présentation, mini-jeu), créer une page web soignée, la publier en privé avec page_publish, la vérifier, puis la partager avec l'accord de l'utilisateur.
---

# Pages soignées (comme des artefacts)

Compétence originale de Sklubot.

## 1. Page ou message ?

Fais une page quand le résultat :
- sera relu, gardé, montré à d'autres ou ouvert sur un téléphone (rapport, comparatif, planning, compte rendu) ;
- est un outil qu'on utilise (calculatrice, simulateur, tableau de bord avec graphiques, liste à cocher, quiz, mini-jeu, diaporama) ;
- a besoin de mise en forme : tableaux longs, graphiques, sections, images.

Réponds simplement dans le chat quand c'est court (une réponse, quelques lignes, une liste rapide), quand l'utilisateur veut juste un avis, ou quand il travaille déjà sur un autre fichier. Dans le doute, réponds en une ligne et propose la page.

## 2. Ce qu'une page peut faire (règles exactes du serveur)

Une page Sklubot est servie à part, dans un « bac à sable » : son JavaScript tourne, mais comme un inconnu du site, sans cookie, sans accès au compte ni à l'API de Sklubot. Concrètement :
- **Fichiers** : un fichier HTML principal, plus jusqu'à 20 fichiers texte à côté (`files` de page_publish : .css, .js, .mjs, .json, .csv, .svg, .txt, .md). Référence-les par un chemin relatif (`style.css`, `data/ventes.json`). Taille : 2 Mo pour le HTML, 1 Mo par fichier, 5 Mo en tout (moins sur une offre gratuite : le serveur te le dit).
- **Scripts et styles** : en ligne dans le HTML, ou dans tes fichiers, ou depuis ces CDN seulement : `https://cdnjs.cloudflare.com`, `https://cdn.jsdelivr.net`, `https://unpkg.com`. Donne toujours une version exacte (par ex. `chart.js@4.4.1`), jamais « latest ».
- **Polices** : Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`), les CDN ci-dessus, ou des polices système.
- **Images, sons, vidéos** : adresses https, `data:` ou `blob:`. N'utilise que des images dont tu as le droit (les tiennes, image_generate, ou une licence libre vérifiée).
- **Données** : `fetch()` ne marche que vers les fichiers de la page elle-même. Pas d'appel à une API extérieure depuis la page : récupère les données avant (search_web, web_fetch, ton ordinateur) et mets-les dans la page ou dans un fichier `.json` de la page.
- **Interdit par le bac à sable** : cookies, localStorage/sessionStorage (ils lèvent une erreur : entoure-les d'un try/catch ou garde l'état en mémoire), formulaires envoyés à un serveur, `alert()`/`confirm()`/`prompt()`, cadres (iframe) d'autres sites. Les liens qui ouvrent un nouvel onglet (`target="_blank"`) marchent.
- La page n'est pas indexée par les moteurs de recherche.

## 3. Bien la construire

- **Contenu vrai seulement** : jamais de chiffres, d'avis, de témoignages, de logos ou de noms inventés. S'il manque une donnée, écris « à compléter » ou demande-la. Cite tes sources en bas de page.
- **Titre et description** : un `<title>` court et parlant (2 à 6 mots), une phrase de description en haut ; `<html lang="fr">` (ou la langue de l'utilisateur), `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width,initial-scale=1">`.
- **Structure** : le résultat d'abord (la réponse, le chiffre clé, l'action), puis le détail. Des titres `h1` → `h2` → `h3` dans l'ordre, des sections courtes, des tableaux pour comparer.
- **Typographie** : une ou deux familles, une échelle claire (par ex. 16 px de base, interligne 1,5), des lignes de 60 à 80 caractères au plus.
- **Responsive de 360 à 1440 px** : mise en page fluide (grid/flex, `max-width`, `clamp()`), pas de largeur fixe, aucune barre de défilement horizontale ; les tableaux larges défilent dans leur propre boîte. Zones cliquables d'au moins 44 px sur téléphone.
- **Clair et sombre** : définis les couleurs en variables CSS sur `:root` et redéfinis-les dans `@media (prefers-color-scheme: dark)` ; mets toujours un fond explicite au `body`.
- **Accessibilité** : contraste d'au moins 4,5:1 pour le texte (3:1 pour les gros titres et les icônes), focus clavier visible, `alt` sur les images, des boutons `<button>` (pas des `div` cliquables), des libellés sur les champs, `prefers-reduced-motion` respecté.
- **Graphiques** : une bibliothèque d'un CDN autorisé, version fixée, ou du SVG fait main ; des axes et légendes lisibles dans les deux thèmes.
- **Style** : une vraie direction choisie pour le sujet plutôt qu'un gabarit générique (voir la compétence « Design soigné » si tu l'as, et « Design de marque » pour les couleurs du compte).

## 4. Publier, vérifier, partager

1. **Privé d'abord** : `page_publish` avec `visibility: "private"` (seul l'utilisateur, connecté, peut l'ouvrir). Le nom (`name`) est le nom de fichier de la page : republier sous le même nom met la page à jour à la même adresse et garde l'ancienne version dans l'historique.
2. **Vérifie avant de dire « c'est prêt »** : relis le HTML (balises fermées, chemins des fichiers, versions des CDN), puis regarde la page si tu as un ordinateur : enregistre une copie sur ton ordinateur et ouvre-la dans ton navigateur (browser_open puis screen_view), en largeur téléphone et ordinateur, en clair et en sombre. Une page privée ne s'ouvre pas dans ton navigateur à toi (elle demande la connexion de l'utilisateur) : dans ce cas, vérifie une copie locale.
3. **Corrige avec page_edit** : de petits remplacements exacts (`find` → `replace`, chaque texte cherché doit apparaître une seule fois ; tout ou rien). Ajoute `file` pour modifier un fichier à côté du HTML. Republie entièrement seulement quand la page change beaucoup.
4. **Partager** : une page « avec le lien » (`visibility: "link"`) est visible par toute personne qui a l'adresse. Publier ainsi demande l'accord de l'utilisateur (une carte d'approbation s'affiche) : explique en une phrase ce qui sera visible. L'utilisateur peut ensuite repasser la page en privé, changer de lien (l'ancien ne marche plus), revenir à une version précédente ou la supprimer dans Réglages → Pages.
5. **Rends la main** : le lien, ce que fait la page en une phrase, ce qui reste à compléter.

## 5. À ne jamais faire

- Mettre une clé, un mot de passe ou une donnée privée dans une page ou ses fichiers (le code d'une page se lit en entier).
- Publier « avec le lien » sans l'accord de l'utilisateur, ou une page qui imite un vrai site, une marque ou une personne.
- Copier le texte, le code, le logo ou les images d'un autre site sans licence qui le permet.
