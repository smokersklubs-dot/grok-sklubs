// Adapted from Craft Anything v0.6.1 LAYOUT_JS (MIT). No heading text or form values are collected.
(() => {
  const px = v => Math.round(parseFloat(v) || 0);
  const shown = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const size = sel => { const el = Array.from(document.querySelectorAll(sel)).slice(0, 50).find(shown); return el ? px(getComputedStyle(el).fontSize) : 0; };
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', {willReadFrequently: true});
  // Computed rgb()/rgba() is read as numbers; a canvas read can be off by one (#154).
  const hex = c => { const h2 = x => x.toString(16).padStart(2, '0'); const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(c); if (m) { const a = m[4] === undefined ? 1 : +m[4]; return '#' + h2(+m[1]) + h2(+m[2]) + h2(+m[3]) + (a < 1 ? h2(Math.round(a * 255)) : ''); } if (!g) return c; g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return '#' + h2(d[0]) + h2(d[1]) + h2(d[2]) + (d[3] < 255 ? h2(d[3]) : ''); };
  // Items side by side: the most children of one box sharing a top edge, counting only children at
  // least 15% of the block's width (cards and columns, not inline links or logo strips).
  const perRow = (root, width) => {
    let best = 1, seen = 0;
    for (const c of [root, ...root.querySelectorAll('*')]) {
      if (++seen > 400) break;
      if (c.children.length < 2) continue;
      const kids = Array.from(c.children).filter(k => shown(k) && k.getBoundingClientRect().width >= Math.max(40, width * 0.15));
      if (kids.length < 2) continue;
      const top = kids[0].getBoundingClientRect().top;
      best = Math.max(best, kids.filter(k => Math.abs(k.getBoundingClientRect().top - top) <= 2).length);
    }
    return best;
  };
  const blocks = [];
  for (const el of document.querySelectorAll('header,nav,main,footer,section,article,aside')) {
    if (blocks.length >= 60) break;
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect(); if (r.height < 24) continue;
    const s = getComputedStyle(el);
    const b = {tag: el.tagName.toLowerCase(), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height),
      pad: [px(s.paddingTop), px(s.paddingRight), px(s.paddingBottom), px(s.paddingLeft)], per_row: perRow(el, r.width)};
    const gap = px(s.columnGap) || px(s.rowGap); if (gap) b.gap = gap;
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') b.background = hex(s.backgroundColor);
    // The content column: the first box (itself or inside) held to a maximum width in px.
    let n = 0;
    for (const c of [el, ...el.querySelectorAll('*')]) {
      if (++n > 80) break;
      const cs = getComputedStyle(c);
      if (cs.maxWidth.endsWith('px') && !['IMG', 'SVG', 'VIDEO', 'PICTURE'].includes(c.tagName.toUpperCase()) && shown(c)) {
        const cr = c.getBoundingClientRect();
        b.column = {max_w: px(cs.maxWidth), x: Math.round(cr.left), w: Math.round(cr.width), pad: [px(cs.paddingLeft), px(cs.paddingRight)]};
        break;
      }
    }
    blocks.push(b);
  }
  return {viewport: {width: innerWidth, height: innerHeight}, page_w: document.documentElement.scrollWidth, page_h: document.documentElement.scrollHeight,
    type: {h1: size('h1'), h2: size('h2'), h3: size('h3'), body: size('p')}, blocks};
})()
