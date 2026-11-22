---
name: Styles de base
description: Deux styles prêts et sans marque (Neutre moderne pour les outils et tableaux de bord, Éditorial chaleureux pour les longues lectures et les pages de marque) en variables CSS pour le clair et le sombre, et comment écrire une fiche de style d'une page pour que toutes les pages et présentations d'un projet aient l'air de la même famille.
---

> styles-de-base — © 2026 Open Design contributors — Apache License 2.0, from github.com/nexu-io/open-design (commit 0725880). Modified for Sklubot (modifié pour Sklubot) : les deux styles de départ (design-systems/default et design-systems/warm-editorial) ont été condensés, les polices commerciales remplacées par des polices libres, des variantes sombres ajoutées, et la structure DESIGN.md transformée en fiche de style pour Sklubot ; traduit en français.

# Styles de base

À utiliser quand une page, une présentation ou un visuel a besoin d'une allure cohérente et que **le compte n'a pas de marque à lui** (la compétence « Design de marque » passe avant : les couleurs, polices et logo du compte l'emportent toujours). Choisis un style pour tout le projet et garde-le : toutes les pages et présentations d'un même travail doivent avoir l'air d'une même famille.

## 1. Choisir

| La demande | Style |
|---|---|
| un outil, un tableau de bord, un rapport de travail, une page utilitaire, « net », « moderne » | **Neutre moderne** |
| une longue lecture, un récit, une page éditoriale ou de marque, « chaleureux », « sérieux », « élégant » | **Éditorial chaleureux** |
| autre chose (ludique, brut, luxe, rétro…) | écris ta propre fiche (§4) avec les compétences « Design soigné (pages web) » et « Règles de métier du design » |

Ne copie jamais l'allure d'une vraie entreprise (ses couleurs, ses polices, son logo, sa signature de mise en page) : une page faite pour ce compte ne doit pas passer pour celle d'une autre marque.

## 2. Neutre moderne

Calme, fonctionnel, sûr de lui sans bruit. Aucun ornement ; le contenu d'abord, l'habillage ensuite.

```css
:root{--bg:#fafafa;--surface:#ffffff;--fg:#111111;--muted:#6b6b6b;--border:#e5e5e5;--accent:#2b66de;
--success:#17a34a;--warn:#b45309;--danger:#dc2626;--radius:8px;--radius-card:12px;
--font-display:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;--font-body:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;--font-mono:ui-monospace,'JetBrains Mono',monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0f1011;--surface:#17181a;--fg:#f0f0f0;--muted:#a1a1a1;--border:rgba(255,255,255,.1);--accent:#6b9cff}}
```

- Typographie : titres en graisse 600, texte 400 ; tailles 12 · 14 · 16 · 20 · 24 · 32 · 48 · 64 px ; interligne 1,5 pour le texte, 1,2 pour les titres ; −0,01em dès 32 px. Inter depuis Google Fonts (seulement les graisses utilisées) ou la police du système.
- Composants : boutons rayon 8 px, marges 10 × 16 px, principal = fond d'accent et texte blanc, secondaire = bordure 1 px ; cartes blanches, bordure 1 px, rayon 12 px, marge 20 px, sans ombre ; champs bordure 1 px, bordure d'accent au focus ; liens en couleur d'accent, soulignés au survol.
- Mise en page : largeur max 1200 px, 12 colonnes, gouttières 24 px ; sections espacées de 80 px (ordinateur), 48 (tablette), 32 (téléphone) ; l'espace sépare, des traits seulement entre parties sans rapport.
- Profondeur : à plat par défaut ; un seul niveau en relief (menus, fenêtres) : `0 2px 8px rgb(0 0 0 / .08)`. Ni verre ni néomorphisme.
- À faire : laisser l'espace travailler ; un seul élément d'accent par écran ; titres avec une seule majuscule. À éviter : dégradés, ombres sur les champs, plus de trois tailles de texte sur un écran.

## 3. Éditorial chaleureux

Chaleureux, posé, façon magazine : beaucoup d'espace, lecture longue confortable, habillage discret ; enjoué mais jamais gadget.

```css
:root{--bg:#faf7f2;--surface:#ffffff;--fg:#1c1a17;--muted:#6f675f;--border:rgba(47,91,79,.14);--accent:#b4532f;--accent-2:#2f5b4f;
--radius:12px;--radius-card:16px;
--font-display:'Source Serif 4','Iowan Old Style',Georgia,serif;--font-body:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;--font-mono:'JetBrains Mono',ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#171512;--surface:#211e1a;--fg:#f2ede6;--muted:#b3a99e;--border:rgba(242,237,230,.12);--accent:#e07a55;--accent-2:#7fb3a3}}
```

- Typographie : titres à empattements, texte sans empattement ; tailles 12 · 14 · 16 · 20 · 28 · 40 · 56 · 80 px ; interligne 1,6 pour le texte, 1,2 pour les grands titres ; −0,02em au-delà de 40 px. Chiffres à empattements pour les prix et chiffres clés.
- Composants : boutons à plat, rayon 12 px, marges 14 × 20 px, principal = terre cuite et texte clair, secondaire = contour 1 px ; cartes couleur papier, fine bordure verte, rayon 16 px, marges 24–32 px, ombre seulement au survol ; champs soulignés seulement, soulignement terre cuite au focus ; liens terre cuite avec un léger soulignement.
- Mise en page : 1200 px, 12 colonnes, gouttières 24 px ; la partie haute est grande (environ 70 vh), contenu placé haut, jamais centré verticalement ; une ouverture + 3 à 5 parties plutôt que 8 ou plus.
- À faire : de l'espace ; un seul accent par page (si le haut est terre cuite, les boutons secondaires restent couleur texte, pas verts). À éviter : dégradés, emoji dans les textes, rayons au-dessus de 24 px ou sous 8 px, noir ou blanc purs.
- Le gris atténué et la terre cuite ont été légèrement foncés par rapport à l'original pour que le texte atteigne 4,5:1 sur le fond papier (le bleu de Neutre moderne aussi, sur son fond gris).

## 4. Une fiche de style (pour un style sur mesure ou la marque du compte)

Avant un projet de plusieurs pages ou une présentation, écris la fiche dans un fichier sur ton ordinateur (par ex. `fiche-de-style.md`) ou en mémoire avec memory_save, puis suis-la à chaque fois. Neuf parties courtes :

1. **Ambiance** — trois adjectifs et une phrase (« calme, précis, sûr de lui sans bruit »).
2. **Couleurs et rôles** — fond, surface, texte, texte atténué, bordure, **un seul** accent, succès/alerte/danger, chacun avec son code hexadécimal et son rôle, en clair et en sombre.
3. **Typographie** — familles titres, texte et mono avec leurs replis, graisses, échelle de tailles, interlignes, interlettrage.
4. **Composants** — boutons, cartes, champs, liens, étiquettes : rayons, marges, bordures, états (survol, focus, désactivé).
5. **Mise en page** — largeur max, colonnes, gouttières, espacement des sections selon l'écran.
6. **Profondeur** — combien de niveaux de relief, quelle ombre.
7. **À faire / à éviter** — cinq lignes chacun.
8. **Adaptation aux écrans** — ce qui change sous 1024 et 640 px.
9. **Consignes pour toi-même** — par ex. « n'invente jamais une couleur hors de cette fiche ; s'il en manque une, prends la plus proche et dis-le ».

Transforme ensuite les parties 2 et 3 en variables `:root` (avec un bloc `@media (prefers-color-scheme: dark)`) et réutilise le même bloc dans toutes les pages et présentations du projet.
