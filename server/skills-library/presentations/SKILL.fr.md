---
name: Présentations (diapositives)
description: Faire une présentation en page Sklubot - diapositives numérotées sur un format 16:9 fixe, flèches, clavier, glissement au doigt, lien « #6 » vers la diapositive 6, une diapositive par page en PDF - à partir d'un cadre prêt, puis la publier avec page_publish.
---

> presentations — © 2026 Open Design contributors — Apache License 2.0, from github.com/nexu-io/open-design (commit 0725880). Modified for Sklubot (modifié pour Sklubot) : le cadre et les règles de présentation (packages/contracts/src/prompts/deck-framework.ts) ainsi que les mises en page, le rythme des thèmes et la liste de contrôle de design-templates/simple-deck ont été raccourcis, réécrits et traduits en français pour les pages Sklubot (page_publish, page_edit, le bac à sable des pages) ; la numérotation est visible, une diapositive s'ouvre par son numéro (#6), aucun stockage n'est utilisé et le protocole de la visionneuse OpenDesign a été retiré.

# Présentations (diapositives)

À utiliser quand l'utilisateur demande une présentation, des diapos, un pitch, un point hebdo ou un dossier pour un conseil. Le résultat est une page Sklubot (voir « Pages soignées » pour les règles des pages) : on la feuillette dans le navigateur, sur un téléphone ou sur grand écran, et on l'imprime en PDF avec une diapositive par page.

## 1. Préparer avant d'écrire

1. **L'histoire en une phrase** : qui regarde, et ce qu'il doit décider ou retenir.
2. **La liste des diapositives**, numérotée, une idée par diapositive : `01 Couverture`, `02 Problème`, `03 Chiffre clé`… Deux idées, c'est deux diapositives ; en ajouter ne coûte rien.
3. **Du vrai contenu seulement** : chiffres, citations et noms viennent de l'utilisateur, de ses fichiers ou d'une source citée sur la dernière diapositive. S'il manque quelque chose, écris « à compléter », jamais un « 10× plus rapide » inventé.
4. **Rythme des thèmes** : chaque diapositive reçoit `light`, `dark`, `hero light` ou `hero dark`. Jamais trois diapositives du même thème d'affilée ; dès 8 diapositives, au moins une `hero dark` et une `hero light`. La couverture est en général `hero light center`, la conclusion `hero dark center`.
5. Couleurs et polices : celles de la marque du compte s'il y en a une (compétence « Design de marque »), sinon un des « Styles de base ». Mets-les seulement dans les variables de `:root`.

## 2. Le cadre (copie-le tel quel, puis remplis les diapositives)

Le cadre ci-dessous fait le plus difficile : format 1920×1080 adapté à tout écran, numéros visibles, compteur avec boutons précédent/suivant, clavier (← → espace PgUp PgDn Début Fin), glissement au doigt sur téléphone, l'adresse `#6` ouvre la diapositive 6 (« la diapo 6 » dans la conversation et le lien correspondent), et un style d'impression qui donne un PDF avec une diapositive par page. **Ne réécris ni le premier bloc `<style>` ni le script** : modifie seulement `<title>`, les variables de `:root`, le second bloc `<style>` et les blocs `<section class="slide">`.

```html
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Titre de la présentation</title>
<style>
/* CADRE : ne pas modifier ce bloc (mise à l'échelle, numéros, navigation, impression). */
:root{--bg:#fafaf7;--fg:#1a1916;--muted:#6b6964;--border:#e8e5df;--accent:#b4532f;--shell:#141413;
--font-display:'Iowan Old Style',Charter,Georgia,serif;--font-body:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--font-mono:ui-monospace,Menlo,Consolas,monospace}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:var(--shell);color:var(--fg);font:28px/1.45 var(--font-body)}
.deck-stage{position:absolute;top:0;left:0;width:1920px;height:1080px;transform-origin:top left;background:var(--bg);overflow:hidden}
.slide{position:absolute;inset:0;overflow:hidden;padding:96px 128px}
.slide:not(.active){display:none!important}
:where(.slide.active){display:flex;flex-direction:column;justify-content:center}
.slide-no{position:absolute;right:64px;bottom:44px;font:20px/1 var(--font-mono);letter-spacing:.12em;opacity:.55}
.deck-bar{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:rgba(20,20,19,.9);color:#fff;font:14px/1 var(--font-mono);z-index:10}
.deck-bar button{width:44px;height:44px;border:0;border-radius:50%;background:transparent;color:#fff;font-size:22px;cursor:pointer}
.deck-bar button:hover,.deck-bar button:focus-visible{background:rgba(255,255,255,.18);outline:none}
.deck-bar button[disabled]{opacity:.3;cursor:default}
.deck-count{min-width:92px;padding:0 8px;text-align:center;letter-spacing:.12em}
@media print{@page{size:1920px 1080px;margin:0}
html,body{height:auto;overflow:visible;background:#fff}
.deck-stage{position:static;transform:none!important;height:auto;overflow:visible}
.slide,.slide:not(.active){display:flex!important;position:relative;width:1920px;height:1080px;break-after:page}
.deck-bar{display:none}}
</style>
<style>
/* TA PRÉSENTATION : thèmes et mises en page (ajoute tes classes ici, ne redéfinis jamais .slide ni .deck-*). */
.light{background:var(--bg);color:var(--fg)}
.dark{background:var(--fg);color:var(--bg)}
.dark .lead,.dark .muted{color:color-mix(in srgb,var(--bg) 78%,transparent)}
.hero{padding:128px 160px}
.center{align-items:center;text-align:center}
.eyebrow{font:24px/1 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:32px}
.h-hero{font:600 120px/1.05 var(--font-display);letter-spacing:-.025em;max-width:16ch;margin-bottom:28px}
.h-xl{font:600 80px/1.1 var(--font-display);letter-spacing:-.02em;max-width:20ch;margin-bottom:28px}
.h-md{font:600 56px/1.15 var(--font-display);letter-spacing:-.015em;margin-bottom:24px}
.lead{font-size:34px;line-height:1.5;color:var(--muted);max-width:56ch}
.stat-num{font:600 260px/.9 var(--font-display);letter-spacing:-.04em;color:var(--accent);margin-bottom:24px}
.stat-num .unit{font-size:.4em;margin-left:6px}
.pt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:56px;margin-top:56px}
.pt{border-top:3px solid var(--accent);padding-top:24px}
.pt h3{font:600 36px/1.2 var(--font-display);margin-bottom:12px}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:40px;margin-top:56px}
.steps .nb{font:24px/1 var(--font-mono);color:var(--accent)}
.ba-grid{display:grid;grid-template-columns:1fr 1fr;gap:72px;margin-top:48px}
.quote-text{font:500 56px/1.3 var(--font-display);max-width:28ch;margin-bottom:32px}
.chart{display:grid;gap:22px;margin-top:48px;max-width:1400px}
.bar-row{display:grid;grid-template-columns:220px 1fr 200px;align-items:center;gap:24px}
.bar-track{height:36px}
.bar{height:100%;background:var(--accent);width:calc(var(--v) / var(--max) * 100%)}
.bar-value{font-family:var(--font-mono)}
</style>
</head>
<body>
<main class="deck-stage" id="deck" aria-roledescription="présentation">
  <section class="slide hero light center" data-label="Couverture">
    <p class="eyebrow">Contexte · date</p>
    <h1 class="h-hero">Un titre de huit mots au plus</h1>
    <p class="lead">Une phrase qui dit pourquoi c'est important.</p>
  </section>
  <section class="slide light" data-label="Problème">
    <p class="eyebrow">Partie</p>
    <h2 class="h-xl">Une idée par diapositive.</h2>
    <p class="lead">Deux ou trois phrases au plus.</p>
  </section>
</main>
<nav class="deck-bar" aria-label="Diapositives">
  <button type="button" id="deck-prev" aria-label="Diapositive précédente">‹</button>
  <span class="deck-count" id="deck-cur" aria-live="polite">01 / 01</span>
  <button type="button" id="deck-next" aria-label="Diapositive suivante">›</button>
</nav>
<script>
(function(){
  var stage=document.getElementById('deck'),slides=[].slice.call(stage.querySelectorAll('.slide'));
  var cur=document.getElementById('deck-cur'),prev=document.getElementById('deck-prev'),next=document.getElementById('deck-next'),i=0,x0=null;
  function pad(n){return (n<10?'0':'')+n}
  slides.forEach(function(s,k){
    s.id='slide-'+(k+1);s.setAttribute('aria-label','Diapositive '+(k+1)+' sur '+slides.length+(s.dataset.label?': '+s.dataset.label:''));
    if(!s.hasAttribute('data-no-number')){var n=document.createElement('span');n.className='slide-no';n.textContent=pad(k+1);s.appendChild(n)}
  });
  function fit(){var w=innerWidth,h=Math.max(1,innerHeight-64),s=Math.min(w/1920,h/1080);if(!(s>0))s=1;
    stage.style.transform='translate('+(w-1920*s)/2+'px,'+(h-1080*s)/2+'px) scale('+s+')'}
  function show(k,keep){i=Math.max(0,Math.min(slides.length-1,k));
    slides.forEach(function(s,j){s.classList.toggle('active',j===i)});
    cur.textContent=pad(i+1)+' / '+pad(slides.length);prev.disabled=i===0;next.disabled=i===slides.length-1;
    if(!keep){try{history.replaceState(null,'','#'+(i+1))}catch(e){}}}
  function fromHash(){var m=/^#(?:slide-)?(\d+)$/.exec(location.hash);return m?+m[1]-1:0}
  function onKey(e){if(e.__deck)return;e.__deck=true;var t=e.target;
    if(t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||t.isContentEditable)||e.metaKey||e.ctrlKey||e.altKey)return;
    var k=e.key;if(k==='ArrowRight'||k==='PageDown'||k===' '){e.preventDefault();show(i+1)}
    else if(k==='ArrowLeft'||k==='PageUp'){e.preventDefault();show(i-1)}
    else if(k==='Home'){e.preventDefault();show(0)}else if(k==='End'){e.preventDefault();show(slides.length-1)}}
  window.addEventListener('keydown',onKey,true);document.addEventListener('keydown',onKey,true);
  prev.addEventListener('click',function(){show(i-1)});next.addEventListener('click',function(){show(i+1)});
  document.addEventListener('touchstart',function(e){x0=e.touches[0].clientX},{passive:true});
  document.addEventListener('touchend',function(e){if(x0===null)return;var d=e.changedTouches[0].clientX-x0;x0=null;if(Math.abs(d)>50)show(d<0?i+1:i-1)},{passive:true});
  addEventListener('hashchange',function(){show(fromHash(),true)});addEventListener('resize',fit);
  fit();show(fromHash(),true);
})();
</script>
</body>
</html>
```

## 3. Mises en page (à coller dans une `<section>`, en changeant les mots)

- **Couverture** (`hero light center`) : `.eyebrow` avec le contexte et la date, `h1.h-hero` (8 mots et 3 lignes au plus), une phrase en `.lead`.
- **Corps** (`light` ou `dark`, la plus courante, 3 à 6 par présentation) : `.eyebrow`, `h2.h-xl`, `.lead` (3 paragraphes courts au plus, 56 caractères par ligne au plus).
- **Grand chiffre** (`hero dark center`) : `<div class="stat-num">38<span class="unit">%</span></div>` et une légende `.lead` avec sa source. Trois chiffres, c'est trois diapositives.
- **Trois points** : `h2.h-xl` puis `.pt-grid` avec trois `.pt` (un `h3` et deux phrases chacun).
- **Étapes** (comment ça marche, 4 au plus) : `.steps` avec `<div><span class="nb">01</span><h3>…</h3><p>…</p></div>`.
- **Avant / après** : `.ba-grid` avec deux colonnes de même forme ; seule l'étiquette « après » prend `var(--accent)`.
- **Citation** (une par présentation) : `.quote-text`, puis le nom et le rôle de la personne. Seulement de vraies citations, avec son accord.
- **Graphique** : `<div class="chart" style="--max:120">` et une ligne par valeur : `<div class="bar-row"><span>2025</span><div class="bar-track"><div class="bar" style="--v:96"></div></div><span class="bar-value">96 k€</span></div>`. `--v` et `--max` sont des nombres sans unité ; chaque barre montre son libellé et sa valeur ; un seul `--max` par graphique. Pour des courbes ou un graphique interactif, une bibliothèque épinglée depuis un CDN autorisé (par ex. `chart.js@4.4.1`).
- **Conclusion** (`hero dark center`) : la demande ou la décision en une phrase, la prochaine étape et sa date — pas « Merci ».

## 4. Densité (la première cause des présentations ratées)

- Titre de couverture ≤ 140 px, ≤ 8 mots. Jamais de texte courant sous 24 px sur le format 1920.
- Laisse libres les 160 px du bas (le numéro de diapositive y est).
- Jamais bandeau + titre + paragraphe + colonne latérale + pied sur une même diapositive : sépare.
- Couleur d'accent deux fois au plus par diapositive ; sur un grand chiffre, le chiffre est le seul accent.
- Pas d'emoji en guise d'icônes, pas de dégradé violet-bleu, pas de cartes arrondies à bordure gauche colorée, pas de couleur hexadécimale hors de `:root`.
- Schémas : faits main en HTML/SVG avec les couleurs de la présentation ; avec Mermaid sur une diapositive sombre, mets `theme:'dark'`.

## 5. Publier, vérifier, désigner les diapositives par leur numéro

1. `page_publish` avec `visibility: "private"` et un `name` parlant (par ex. `point-conseil-t3`). Republier sous le même nom met la présentation à jour et garde la version précédente.
2. Vérifie sur ton ordinateur (une copie du HTML dans ton navigateur, browser_open puis screen_view) en 1440×900 et en largeur téléphone : aucun texte ne déborde, le compteur indique `01 / N`, les flèches et `#3` marchent, l'aperçu avant impression donne une diapositive par page.
3. Dans la conversation, désigne les diapositives par leur numéro (« la diapo 6 montre maintenant le chiffre du T3 ») et donne des liens du type `…/p/<jeton>#6`. Pour changer une seule diapositive, `page_edit` avec un texte `find` propre à cette diapositive (son `data-label` aide).
4. Avant de partager hors de l'équipe (la visibilité « link » demande l'accord de l'utilisateur), dis quelles diapositives contiennent des chiffres sensibles et propose une version sans elles ; ne modifie jamais l'original sans demander.
5. Rends compte : le lien, le nombre de diapositives, ce qui reste « à compléter ». Si l'utilisateur veut un .pptx, fabrique-le sur ton ordinateur à partir de la même liste (python-pptx) et dis que la page reste la référence.

## 6. Jamais

- Réécrire le script ou les règles d'impression du cadre, ni mettre les boutons dans les diapositives.
- Utiliser localStorage, les cookies ou des API extérieures (bloqués dans les pages) : la position est dans l'adresse (`#6`).
- Copier les diapositives, le logo ou le style d'une autre entreprise.
