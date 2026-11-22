---
name: Guides des composants web
description: Comment construire les éléments courants d'une page pour qu'ils soient légers, accessibles et marchent aussi sur Safari - fenêtre de dialogue, menu, onglets, accordéon, info-bulle, notification, carrousel, menu latéral, interrupteur, formulaires et validation, remplissage automatique, tableaux sur téléphone, mode sombre et son bouton, priorité des images - le HTML natif d'abord, puis la solution de repli quand une fonction récente n'est pas prise en charge partout.
---

> Adaptée des guides de GoogleChrome/modern-web-guidance-src (© 2026 Google LLC ; textes des guides sous CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ ; code sous Apache License 2.0). Modifiée pour Sklubot (22/11/2026) : une vingtaine de guides condensés en règles courtes pour les pages Sklubot, une étape de vérification de la prise en charge ajoutée, exemples raccourcis, traduite en français. Des modifications ont été faites ; ce n'est pas un texte officiel des auteurs des guides.

# Guides des composants web

**Le HTML natif d'abord.** Un élément intégré apporte gratuitement le clavier, le focus, les noms lus par les lecteurs d'écran et la touche Échap ; un `div` fait main doit tout refaire et en oublie presque toujours une partie.

**Vérifier la prise en charge avant d'utiliser une fonction récente.** Les fonctions marquées *(récent)* ci-dessous ne marchent peut-être pas encore dans tous les navigateurs (souvent Safari). Avant de compter dessus, vérifie son état (web_fetch sur sa page MDN ou sur les tableaux de prise en charge) et ajoute la solution de repli indiquée. Dans le doute, utilise la solution de repli seule.

## Fenêtres et superpositions

- **Fenêtre de dialogue (bloque la page)** : `<dialog>` ouvert avec `showModal()` (ou *(récent)* `<button command="show-modal" commandfor="id">`). Pas de `role="dialog"`, pas d'`aria-modal`, pas de piège à focus ni de gestion d'Échap faits main : le navigateur s'en charge. Donne-lui un nom (`aria-labelledby` sur son titre). Empêche la page de défiler derrière avec `dialog:modal{overscroll-behavior:contain}` et `dialog::backdrop{overflow:hidden;overscroll-behavior:contain}`, jamais `overflow:hidden` sur `body`. Boutons de fermeture dans `<form method="dialog">`.
- **Panneau à côté duquel on continue** (barre de recherche, filtres) : `<dialog popover="manual">` avec un bouton Fermer visible.
- **Menu d'actions** : un bouton qui ouvre une fenêtre surgissante (`popovertarget`), les choix en boutons, les flèches pour passer de l'un à l'autre, Échap ferme et rend le focus au bouton ; positionné avec l'ancrage CSS *(récent ; repli : placé sous le bouton en CSS simple)*. Des liens de navigation sont une liste de liens, pas un « menu ».
- **Info-bulle** : seulement un court complément, jamais le seul endroit d'une information ; *(récent)* `popover="hint"` ouvert au survol et au focus ; elle doit aussi apparaître au focus clavier et ne jamais contenir de liens ni de boutons.
- **Notification (toast)** : `popover="manual"` dans une seule zone nommée (`role="region" aria-label="Notifications"`), toujours au même endroit ; un vrai bouton Fermer atteignable au clavier sans voler le focus ; l'information doit aussi exister ailleurs ; jamais dans ni derrière une fenêtre de dialogue ouverte ; une version sans mouvement ; lisible avec un texte agrandi à 200 %.
- **Menu latéral** (menu du téléphone) : un `<dialog>` modal qui glisse depuis le bord, fermé par son bouton, par Échap et en touchant le fond ; le focus revient au bouton du menu.

## Contenu

- **Accordéon / FAQ** : des éléments `<details><summary>` qui se suivent ; *(récent)* le même `name` sur chacun les rend exclusifs (un seul ouvert). Jamais de titre dans `summary` ; si chaque élément a besoin de son titre, utilise des boutons avec `aria-expanded` sous de vrais titres.
- **Onglets** : `role="tablist"` avec des boutons `role="tab"` et des panneaux `role="tabpanel"` ; l'état de départ écrit dans le HTML (`hidden` sur les autres panneaux, `aria-selected="true"` sur l'onglet choisi), les flèches passent d'un onglet à l'autre, l'onglet choisi montré par une forme (soulignement), pas seulement par la couleur. Trop d'onglets sur téléphone : laisse la liste défiler, ou mets les autres dans un menu « Plus » hors de la liste.
- **Carrousel** : une piste qui défile avec `scroll-snap-type`, de vrais boutons Précédent et Suivant, les diapos en liste nommées « diapo 2 sur 5 », pas de défilement automatique (ou une pause visible) ; le contenu reste accessible en faisant simplement défiler.
- **Tableau sur téléphone** : garde un vrai `<table>` ; laisse-le défiler de côté dans sa propre boîte avec un indice visible, ou empile chaque ligne en carte avec le nom de colonne avant chaque cellule. Un tableau triable : des boutons dans les en-têtes de colonne et `aria-sort` sur la colonne triée.
- **Bouton Copier** : un vrai `<button>` qui copie, puis dit « Copié » en texte (pas seulement une icône) un instant.

## Formulaires

- Une `<label>` visible pour chaque champ ; le bon `type` (`email`, `tel`, `number`, `date`) et les bonnes valeurs `autocomplete` (`name`, `email`, `tel`, `street-address`, `postal-code`, `cc-number`, `one-time-code`) pour que le téléphone les remplisse.
- **Validation après coup** : utilise `required`, `type`, `pattern`, `minlength` ; montre l'erreur seulement quand la personne a quitté le champ ou essayé d'envoyer (`:user-invalid`), jamais pendant qu'elle tape les premières lettres. Les aides et les règles **au-dessus** du champ (le clavier et le remplissage automatique cachent ce qui est dessous) ; l'erreur en texte à côté du champ, reliée avec `aria-describedby` ; jamais la couleur seule.
- **Champs obligatoires** : dis lesquels en texte (« obligatoire »), pas seulement avec une étoile.
- **Interrupteur** (oui/non) : une case à cocher avec son étiquette, habillée en interrupteur ; *(récent)* `<input type="checkbox" switch>`. Elle doit toujours partir avec le formulaire et marcher avec Espace.
- **Choisir dans une longue liste** : un `<select>` ou un champ texte avec `<datalist>` ; une liste à saisie personnalisée seulement si nécessaire, avec tout le comportement clavier.
- **Touche Entrée et saisie des langues asiatiques** : n'envoie pas le formulaire sur Entrée pendant une composition (`event.isComposing`).

## Thème et performance

- **Mode sombre** : `<meta name="color-scheme" content="light dark">` dans l'en-tête, `:root{color-scheme:light dark}`, les couleurs en variables (ou `light-dark()` *(récent ; repli : un bloc `prefers-color-scheme`)*). Vérifie le contraste dans les deux.
- **Bouton du mode sombre** : trois choix (clair, sombre, comme le système) est le plus clair ; quand on suit le système, garde `color-scheme: light dark` ; applique le choix enregistré avant l'affichage pour éviter un flash. Les pages Sklubot ne peuvent rien enregistrer : suis le système.
- **Images** : `fetchpriority="high"` sur la seule image principale du premier écran (une ou deux au plus), jamais avec `loading="lazy"` ; `loading="lazy"` sur les images plus bas ; toujours `width` et `height` pour que la page ne saute pas ; formats modernes (WebP, AVIF) avec un texte de remplacement.
- **Polices** : une police de repli aux proportions proches pour que le texte ne saute pas quand la police web arrive.

## Avant de remettre

Parcours chaque commande au clavier, appuie sur Échap sur chaque fenêtre, essaie la page à 390 px et avec un texte à 200 %, en clair et en sombre, et en mouvement réduit. Dis quelles fonctions récentes tu as utilisées et quelle solution de repli couvre les navigateurs qui ne les ont pas.
