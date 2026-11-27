import type { PageCheckAnswer } from "./pagecheck.js";

/**
 * L157 « WebGL vérifié » (backlog A-FAIRE): a page that draws with WebGL (three.js, Babylon, PixiJS, regl, or its own
 * getContext("webgl"/"webgl2")) is checked in the browser of the page check (L56, pagecheck.ts: headless Chromium in
 * browser mode, the bot's Chromium on a Linux computer):
 *  - is WebGL there at all, does the page have a WebGL canvas, was its context lost;
 *  - did it draw: a few pixels of each WebGL canvas are read in the next animation frames (WebGL 1.0 §5.14.12
 *    readPixels, https://registry.khronos.org/webgl/specs/latest/1.0/#5.14.12 ; requestAnimationFrame runs the page's own
 *    frame first, so its drawing buffer is still there — a page that draws once without preserveDrawingBuffer: true
 *    cannot be read this way, and the report says so instead of calling it blank).
 * Visitors whose browser has no WebGL (or loses it) get a clear message instead of an empty box: a small script added
 * when such a page is served (pageroutes.ts) and in the check, so the check sees what visitors see.
 */
const WEBGL_USE = /getContext\(\s*["'`](?:webgl2?|experimental-webgl)["'`]|\bWebGL(?:2)?RenderingContext\b|\bnew\s+(?:THREE\.)?WebGLRenderer\b|three(?:\.module)?(?:\.min)?\.js|babylon(?:\.max)?(?:\.min)?\.js|pixi(?:\.min)?\.js|regl(?:\.min)?\.js|@react-three\/fiber/i;

/** Whether the page (its HTML and its script files) draws with WebGL. */
export function usesWebgl(html: string, files: { path?: string; file?: string; content: string }[] = []): boolean {
  if (WEBGL_USE.test(html)) return true;
  return files.some((f) => /\.(m?js)$/i.test(f.path ?? f.file ?? "") && WEBGL_USE.test(f.content));
}

export const FALLBACK_MARK = "data-sklubot-webgl-fallback";
/**
 * The visitors' fallback: when WebGL cannot be created (or is lost), a message over the page, in French when the page is
 * in French. Runs before the page's own scripts finish; it never touches the page's canvases.
 */
export const WEBGL_FALLBACK_JS = String.raw`(function(){var d=document;function msg(){if(d.querySelector('[${FALLBACK_MARK}]'))return;var fr=/^fr/i.test(d.documentElement.lang||navigator.language||'');var b=d.createElement('div');b.setAttribute('${FALLBACK_MARK}','');b.setAttribute('role','alert');b.style.cssText='position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;max-width:560px;margin:0 auto;padding:14px 16px;border-radius:12px;background:#111827;color:#fff;font:15px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';b.textContent=fr?'Cette page affiche de la 3D (WebGL) que ce navigateur ne peut pas afficher. Essaie avec un navigateur à jour (Chrome, Firefox, Safari ou Edge) et l’accélération graphique activée.':'This page shows 3D (WebGL) that this browser cannot display. Try an up-to-date browser (Chrome, Firefox, Safari or Edge) with hardware acceleration turned on.';(d.body||d.documentElement).appendChild(b);}var ok=false;try{var c=d.createElement('canvas');ok=!!(window.WebGLRenderingContext&&(c.getContext('webgl2')||c.getContext('webgl')||c.getContext('experimental-webgl')));}catch(e){ok=false;}if(!ok){if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',msg);else msg();}d.addEventListener('webglcontextlost',function(e){var x=e.target;setTimeout(function(){try{var g=x&&x.getContext&&(x.getContext('webgl2')||x.getContext('webgl')||x.getContext('experimental-webgl'));if(g&&g.isContextLost())msg();}catch(err){}},1500);},true);})();`;

/** The page with the fallback script, at the start of <head> (or of the document); unchanged when it does not use WebGL. */
export function withWebglFallback(html: string, files: { path?: string; file?: string; content: string }[] = []): string {
  if (!usesWebgl(html, files) || html.includes(`${FALLBACK_MARK}-script`)) return html;
  const tag = `<script ${FALLBACK_MARK}-script>${WEBGL_FALLBACK_JS}</script>`;
  return /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, (h) => h + tag) : tag + html;
}

/**
 * The in-page probe (an expression returning a promise of findings), added to the check's rules for a WebGL page.
 * Rules: "webgl" (a problem to fix), "webgl-ok" (verified), "webgl-none" (the check's browser has no WebGL).
 */
export const WEBGL_PROBE_JS = String.raw`(async () => {
  const out = [];
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '');
  let available = false;
  try { const t = document.createElement('canvas'); available = !!(t.getContext('webgl2') || t.getContext('webgl')); } catch (e) { available = false; }
  if (!available) {
    const shown = !!document.querySelector('[${FALLBACK_MARK}]');
    out.push({ rule: 'webgl-none', text: 'the check\'s browser has no WebGL, so the 3D could not be verified' + (shown ? '; visitors in that case see the fallback message' : '') });
    return out;
  }
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const canvases = [...document.querySelectorAll('canvas')].map((c) => {
    let gl = null;
    try { if (c.getContext('2d')) return null; gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'); } catch (e) { gl = null; }
    return gl ? { c, gl } : null;
  }).filter(Boolean);
  if (!canvases.length) { out.push({ rule: 'webgl', text: 'the page\'s code uses WebGL but no WebGL canvas appeared after loading (look at the console errors)' }); return out; }
  for (const { c, gl } of canvases.slice(0, 4)) {
    const label = name(c) + ' ' + gl.drawingBufferWidth + '×' + gl.drawingBufferHeight;
    if (gl.isContextLost()) { out.push({ rule: 'webgl', text: 'the WebGL context of ' + label + ' was lost' }); continue; }
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { out.push({ rule: 'webgl', text: 'the WebGL canvas ' + label + ' takes no room on screen (' + Math.round(r.width) + '×' + Math.round(r.height) + ' px)' }); continue; }
    let drawn = false;
    for (let k = 0; k < 4 && !drawn; k++) {
      drawn = await new Promise((done) => requestAnimationFrame(() => {
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(4); let seen = false;
        try { for (let i = 1; i < 8 && !seen; i++) for (let j = 1; j < 8 && !seen; j++) { gl.readPixels(Math.floor(W * i / 8), Math.floor(H * j / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (px[0] + px[1] + px[2] > 6) seen = true; } } catch (e) { seen = false; }
        done(seen);
      }));
      if (!drawn) await frame();
    }
    out.push(drawn ? { rule: 'webgl-ok', text: 'WebGL rendered: ' + label + ' drew pixels' } : { rule: 'webgl', text: 'the WebGL canvas ' + label + ' shows nothing (all black or empty) — or it draws only once without preserveDrawingBuffer: true, which this check cannot read' });
  }
  return out;
})()`;

/** The rules of the check for this page: the usual ones, plus the WebGL probe when the page uses WebGL. */
export function rulesFor(baseRules: string, webgl: boolean): string {
  return webgl ? `(async () => { const base = ${baseRules}; let gl = []; try { gl = await ${WEBGL_PROBE_JS}; } catch (e) { gl = [{ rule: 'webgl', text: 'the WebGL check failed: ' + (e && e.message) }]; } return [...(Array.isArray(base) ? base : []), ...gl]; })()` : baseRules;
}

/**
 * Takes the WebGL results out of the rendered rules (the positive ones are not problems) and returns the line for the
 * report, or "" when the page does not use WebGL.
 */
export function webglLine(rendered: PageCheckAnswer | null, webgl: boolean): string {
  if (!webgl) return "";
  if (!rendered?.ok) return "WebGL: the page uses WebGL but could not be rendered, so the 3D was not verified. Visitors without WebGL get a clear message (added by Sklubot).";
  const ok = new Set<string>(), none = new Set<string>();
  let problems = 0;
  for (const [w, found] of Object.entries(rendered.rules ?? {})) {
    rendered.rules![w] = found.filter((f) => {
      if (f.rule === "webgl-ok") { ok.add(f.text); return false; }
      if (f.rule === "webgl-none") { none.add(f.text); return false; }
      if (f.rule === "webgl") problems++;
      return true;
    });
  }
  const widths = Object.keys(rendered.rules ?? {}).join(" and ");
  if (none.size) return `WebGL: ${[...none][0]}. Do not call the 3D verified.`;
  if (ok.size && !problems) return `WebGL: verified at ${widths} px — ${[...ok].join("; ")}. Visitors without WebGL get a clear message (added by Sklubot).`;
  return `WebGL: ${problems ? "problems below" : "not verified"}${ok.size ? ` (${[...ok].join("; ")})` : ""}. Visitors without WebGL get a clear message (added by Sklubot).`;
}
