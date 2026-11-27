---
name: Slide decks
description: Build a slide deck as a Sklubot page - numbered slides on a fixed 16:9 canvas, arrows, keyboard, swipe, "#6" links to slide 6, one slide per page when printed to PDF - from a ready frame, then publish it with page_publish.
---

> presentations — © 2026 Open Design contributors — Apache License 2.0, from github.com/nexu-io/open-design (commit 0725880). Modified for Sklubot: the deck frame and rules (packages/contracts/src/prompts/deck-framework.ts) and the layouts, theme rhythm and checklist of design-templates/simple-deck were shortened and rewritten for Sklubot pages (page_publish, page_edit, the page sandbox); numbering is visible, slides open by number (#6), storage is not used, and the OpenDesign viewer protocol was removed.

# Slide decks

Use this when the user asks for a presentation, a deck, slides, a pitch, a weekly review or a board pre-read. The result is one Sklubot page (see "Polished pages" for the page rules): the user flips through it in the browser, on a phone or on a big screen, and prints it to PDF with one slide per page.

## 1. Plan before writing

1. **The story in one sentence**: who watches, what they must decide or remember.
2. **The slide list**, numbered, one idea per slide: `01 Cover`, `02 Problem`, `03 Key figure`… Two ideas means two slides; more slides cost nothing.
3. **Real content only**: figures, quotes and names come from the user, their files or a source you cite on the last slide. When something is missing write "to be completed", never an invented "10× faster".
4. **Theme rhythm**: give every slide one of `light`, `dark`, `hero light`, `hero dark`. Never three slides of the same theme in a row; from 8 slides, at least one `hero dark` and one `hero light`. The cover is usually `hero light center`, the close `hero dark center`.
5. Colours and fonts: the account's brand if there is one ("Brand design" skill), otherwise one of the "Starter design systems". Put them in the `:root` variables only.

## 2. The frame (copy it as it is, then fill the slides)

The frame below does the hard parts: 1920×1080 canvas scaled to any screen, visible slide numbers, a counter with previous/next buttons, keyboard (← → space PgUp PgDn Home End), swipe on phones, the address `#6` opens slide 6 (so "slide 6" in the chat and the link match), and a print style that gives a PDF with one slide per page. **Do not rewrite the first `<style>` block or the script**: edit only `<title>`, the `:root` variables, the second `<style>` block and the `<section class="slide">` blocks.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deck title</title>
<style>
/* FRAME: do not edit this block (scaling, numbers, navigation, print). */
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
/* YOUR DECK: themes and layouts (add classes here, never redefine .slide or .deck-*). */
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
<main class="deck-stage" id="deck" aria-roledescription="slide deck">
  <section class="slide hero light center" data-label="Cover">
    <p class="eyebrow">Context · date</p>
    <h1 class="h-hero">Headline of eight words at most</h1>
    <p class="lead">One sentence that says why this matters.</p>
  </section>
  <section class="slide light" data-label="Problem">
    <p class="eyebrow">Section</p>
    <h2 class="h-xl">One idea per slide.</h2>
    <p class="lead">Two or three sentences at most.</p>
  </section>
</main>
<nav class="deck-bar" aria-label="Slides">
  <button type="button" id="deck-prev" aria-label="Previous slide">‹</button>
  <span class="deck-count" id="deck-cur" aria-live="polite">01 / 01</span>
  <button type="button" id="deck-next" aria-label="Next slide">›</button>
</nav>
<script>
(function(){
  var stage=document.getElementById('deck'),slides=[].slice.call(stage.querySelectorAll('.slide'));
  var cur=document.getElementById('deck-cur'),prev=document.getElementById('deck-prev'),next=document.getElementById('deck-next'),i=0,x0=null;
  function pad(n){return (n<10?'0':'')+n}
  slides.forEach(function(s,k){
    s.id='slide-'+(k+1);s.setAttribute('aria-label','Slide '+(k+1)+' of '+slides.length+(s.dataset.label?': '+s.dataset.label:''));
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

## 3. Layouts (paste into a `<section>`, change the words)

- **Cover** (`hero light center`): `.eyebrow` with context and date, `h1.h-hero` (8 words, 3 lines at most), one `.lead` sentence.
- **Body** (`light` or `dark`, the workhorse, 3–6 per deck): `.eyebrow`, `h2.h-xl`, `.lead` (≤ 3 short paragraphs, ≤ 56 characters per line).
- **Big figure** (`hero dark center`): `<div class="stat-num">38<span class="unit">%</span></div>` and one `.lead` caption with its source. Three figures means three slides.
- **Three points**: `h2.h-xl` then `.pt-grid` with three `.pt` (an `h3` and two sentences each).
- **Steps** (how it works, up to 4): `.steps` with `<div><span class="nb">01</span><h3>…</h3><p>…</p></div>`.
- **Before / after**: `.ba-grid` with two columns of the same shape; tint only the "after" label with `var(--accent)`.
- **Quote** (one per deck): `.quote-text` and the person's name and role. Real quotes only, with their permission.
- **Chart**: `<div class="chart" style="--max:120">` and one row per value: `<div class="bar-row"><span>2025</span><div class="bar-track"><div class="bar" style="--v:96"></div></div><span class="bar-value">96 k€</span></div>`. `--v` and `--max` are plain numbers (no units); every bar shows its label and its value; one `--max` per chart. For line or interactive charts use a pinned library from an allowed CDN (e.g. `chart.js@4.4.1`).
- **Close** (`hero dark center`): the ask or the decision in one sentence, the next step and its date — not "Thank you".

## 4. Density (the first cause of ugly decks)

- Headline on the cover ≤ 140 px, ≤ 8 words. Body text never smaller than 24 px on the 1920 canvas.
- Keep the bottom 160 px free (the slide number lives there).
- No masthead + headline + paragraph + sidebar + footer on one slide: split it.
- Accent at most twice per slide; on a big-figure slide the number is the only accent.
- No emoji as icons, no purple-to-blue gradients, no rounded cards with a coloured left border, no raw hex colours outside `:root`.
- Diagrams: hand-made HTML/SVG with the deck's colours; if you use Mermaid on a dark slide, set `theme:'dark'`.

## 5. Publish, check, refer to slides by number

1. `page_publish` with `visibility: "private"` and a meaningful `name` (e.g. `board-review-q3`). Publishing again under the same name updates the deck and keeps the previous version.
2. Check on your computer (a copy of the HTML in your browser, browser_open then screen_view) at 1440×900 and phone width: no text overflows, the counter says `01 / N`, arrows and `#3` work, the print preview gives one slide per page.
3. In the chat, refer to slides by number ("slide 6 now shows the Q3 figure") and give links like `…/p/<token>#6`. To change one slide use `page_edit` with a `find` text unique to that slide (its `data-label` helps).
4. Before sharing a deck outside (visibility "link" asks the user's approval), say which slides hold sensitive figures and offer a version without them; never change the original without asking.
5. Hand back: the link, the number of slides, what remains "to be completed". If the user wants a .pptx, build it on your computer from the same slide list (python-pptx), and say that the page stays the reference.

## 6. Never

- Rewrite the frame's script or print rules, or put the buttons inside the slides.
- Use localStorage, cookies or outside APIs (blocked in pages): the slide position lives in the address (`#6`).
- Copy another company's slides, logo or look.
