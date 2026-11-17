# Film de présentation Sklubot (45 s)

Un film explicatif de 45 secondes, en français, fait **entièrement en local et gratuitement** : une page HTML animée
image par image, rendue par Chromium (Playwright), assemblée par ffmpeg. Aucun service payant, aucune image générée
par IA, aucun échantillon sonore.

| Fichier | Contenu |
|---|---|
| `sklubot-promo-45s-16x9.mp4` | 1920 × 1080, 30 i/s, H.264 + AAC (site, YouTube, LinkedIn) |
| `sklubot-promo-45s-9x16.mp4` | 1080 × 1920, 30 i/s, même storyboard remis en page (Reels, TikTok, Shorts) |
| `poster.png` / `poster-9x16.png` | Image d’affiche (dernier plan) |
| `captions.srt` | Sous-titres (le texte de la voix off, calé sur le film) |
| `script.txt` | Texte de la voix off à enregistrer, avec les timecodes |
| `audio/soundtrack.wav` | La musique seule (48 kHz, stéréo), pour remixer sous une voix |
| `src/` | Les sources : `index.html`, `style.css`, `app.js` (l’animation), `timeline.js` (les temps) |
| `src/build/` | Les scripts : personnages, musique, rendu, images de contrôle |

## Storyboard

| Temps | Scène | À l’écran |
|---|---|---|
| 0 – 4 s | Accroche (sombre) | Juno dort, se réveille et se met au travail : « Et si ton équipe d’IA travaillait pendant que tu dors ? » |
| 4 – 12 s | L’équipe | Max (SEO), Léa (Prospection), Noé (Service client), Iris (Réseaux sociaux), Oscar (Administratif) apparaissent ; chacun parle à son tour : « un métier, sa mémoire et sa propre voix » |
| 12 – 22 s | Leur ordinateur | L’ordinateur de Max (fond à sa couleur, dock Navigateur / Terminal / Fichiers), ses tâches se cochent ; puis trois ordinateurs en parallèle |
| 22 – 30 s | Sécurité | La vraie carte d’approbation de l’app avec le bandeau rouge « Action irréversible » ; le pointeur clique « Autoriser une fois » → « Autorisé une fois · fait » |
| 30 – 38 s | Aujourd’hui | La page « Aujourd’hui » : tâches terminées et temps gagné, **étiquetés « Exemple » et « estimation »** |
| 38 – 45 s | Appel à l’action (sombre) | Les six bots en euphorie, l’icône et le nom Sklubot, « Crée ton équipe gratuite », sklubot.sklubs.fr, Web · Téléphone · Ordinateur |

## Identité visuelle reprise de l’app

- **Personnages** : le vrai composant `web/src/components/Character.tsx`, rendu en SVG statique par
  `src/build/extract-characters.tsx` (React côté serveur) → `src/characters.js`. Leurs animations sont celles de
  `web/src/styles/character.css` (copié dans `src/character.css`), mises en pause et placées au bon instant à chaque image.
- **Couleurs** : les jetons de `web/src/styles/tokens.css` (copiés et rendus utilisables par scène, clair ou sombre,
  dans `src/tokens-scoped.css`) ; l’orange est celui de l’icône de l’app (`web/public/icon.svg`).
- **Icônes** : celles de `web/src/components/Icon.tsx`, rendues de la même façon.
- **Carte d’approbation et page « Aujourd’hui »** : mêmes classes, tailles et textes que l’app, agrandies.
- **Police** : l’app utilise la police du système ; sur Linux, Inter la remplace (installée sur la machine de rendu).

## Refaire le rendu

Depuis la racine du dépôt (Node 22, Chromium de Playwright, ffmpeg avec libx264) :

```bash
# 1. Personnages, icônes et jetons à jour depuis l'app (à refaire si un personnage ou un jeton change)
npx esbuild marketing/promo/src/build/extract-characters.tsx --bundle --platform=node --format=cjs \
  --jsx=automatic --loader:.css=empty --outfile=/tmp/extract.cjs
node /tmp/extract.cjs "$PWD/marketing/promo/src/characters.js"

# 2. Musique (≈ 3 s)
node marketing/promo/src/build/soundtrack.mjs marketing/promo/audio/soundtrack.wav

# 3. Vidéos (≈ 3 min chacune ; les images passent directement à ffmpeg, rien n'est écrit sur le disque)
cd marketing/promo
node src/build/render.mjs h sklubot-promo-45s-16x9.mp4 audio/soundtrack.wav
node src/build/render.mjs v sklubot-promo-45s-9x16.mp4 audio/soundtrack.wav
# Un extrait seulement : ajouter --from 22 --to 30

# 4. Images de contrôle à des instants précis
node src/build/stills.mjs /tmp h 3.5 10 16 27.5 36 44
ffmpeg -i sklubot-promo-45s-16x9.mp4 -vf "fps=1,scale=320:-1,tile=9x5" /tmp/planche.png
```

Pour regarder l’animation en direct : ouvrir `src/index.html?mode=h` (ou `?mode=v`) dans Chrome ;
`?t=27.5` fige l’image à 27,5 s.

**Modifier** : les textes sont dans `src/index.html`, les temps dans `src/timeline.js` (partagés par l’image et la
musique : déplacer un événement déplace aussi son son), la mise en page dans `src/style.css` (`.h` = 16:9, `.v` = 9:16),
les mouvements dans `src/app.js` (une fonction par scène, qui ne dépend que de `t`).

## Ce qui n’a pas été fait

- **Voix off** : pas de synthèse vocale payante ; le texte est prêt dans `script.txt` et `captions.srt`.
- **Plans Blender** : non faits. Il restait environ 2 Go libres sur le disque ; Blender (archive ≈ 350 Mo, plus de 1 Go
  installé) et ses rendus auraient mis la machine à court de place. Les personnages 2D de l’app suffisent ici.
- Les sous-titres ne sont pas incrustés (le texte à l’écran fait déjà office de titre) : `captions.srt` se charge
  à part sur les plateformes.
