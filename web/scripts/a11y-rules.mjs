// L160 « passage de web/ au crible PWA / accessibilité » (A-FAIRE L160; checks written from the modern-web-guidance
// guides « pwa » and « accessibility », GoogleChrome/modern-web-guidance, CC BY 4.0 texts — ideas only, our own code).
//
// Two halves:
//   - pwaProblems(files): the installable-app basics, read from the files on disk (manifest, index.html, service worker).
//   - pageAudit(): runs INSIDE a page (Playwright page.evaluate) and lists what a screen reader or a keyboard user
//     cannot use: a button or link with no name, a form field with no name, an image with no text, a clickable box that
//     is not a button, duplicate ids, a positive tabindex.
// Pure functions: unit-tested in a11y-pwa.test.mjs; the browser run is check-a11y.mjs.

/** @param {{ manifest: string, html: string, sw: string, exists: (path: string) => boolean }} f */
export function pwaProblems(f) {
  const out = [];
  let m;
  try { m = JSON.parse(f.manifest); } catch { return ["manifest.webmanifest is not valid JSON"]; }
  for (const k of ["name", "short_name", "id", "start_url", "scope", "display", "background_color", "theme_color", "description"]) if (!m[k]) out.push(`manifest: missing "${k}"`);
  if (m.short_name && m.short_name.length > 12) out.push("manifest: short_name longer than 12 characters (cut under the icon)");
  if (!["standalone", "fullscreen", "minimal-ui"].includes(m.display)) out.push("manifest: display must be standalone, fullscreen or minimal-ui to install");
  const icons = Array.isArray(m.icons) ? m.icons : [];
  const has = (size, purpose) => icons.some((i) => String(i.sizes ?? "").split(/\s+/).includes(size) && String(i.purpose ?? "any").split(/\s+/).includes(purpose));
  if (!has("192x192", "any")) out.push("manifest: no 192x192 icon");
  if (!has("512x512", "any")) out.push("manifest: no 512x512 icon");
  if (!has("512x512", "maskable")) out.push("manifest: no 512x512 maskable icon (Android cuts the icon into a circle)");
  for (const i of icons) if (typeof i.src === "string" && i.src.startsWith("/") && !f.exists(i.src)) out.push(`manifest: icon ${i.src} is missing on disk`);
  const html = f.html;
  if (!/<html[^>]*\blang=/.test(html) && !/documentElement\.lang\s*=/.test(html)) out.push("index.html: no language on <html>");
  const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1] ?? "";
  if (!viewport) out.push("index.html: no viewport meta");
  if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(viewport)) out.push("index.html: the viewport blocks zooming (people who need bigger text cannot zoom)");
  if (!/<link\s+rel="manifest"/.test(html)) out.push("index.html: no <link rel=\"manifest\">");
  if (!/<meta\s+name="theme-color"/.test(html)) out.push("index.html: no theme-color");
  if (!/<link\s+rel="apple-touch-icon"/.test(html)) out.push("index.html: no apple-touch-icon (iPhone home screen)");
  if (!/<title>[^<]+<\/title>/.test(html)) out.push("index.html: no <title>");
  if (!/<noscript>/.test(html)) out.push("index.html: no <noscript> message (a blank page when JavaScript is off)");
  if (!/addEventListener\("fetch"/.test(f.sw)) out.push("sw.js: no fetch handler (the app cannot open offline)");
  if (!/startsWith\("\/api\/"\)/.test(f.sw)) out.push("sw.js: /api/ is not excluded (private data could be cached)");
  return out;
}

/** Runs in the page. Returns short descriptions of each problem (max 40). */
export function pageAudit() {
  const out = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[aria-hidden=\"true\"], [inert]"); };
  const byIds = (ids) => ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
  const name = (el) => {
    const aria = el.getAttribute("aria-label")?.trim(); if (aria) return aria;
    const lb = el.getAttribute("aria-labelledby"); if (lb && byIds(lb)) return byIds(lb);
    if (el.labels && [...el.labels].some((l) => l.textContent.trim())) return "label";
    if (el.tagName === "IMG") return el.getAttribute("alt") ?? "";
    const imgs = [...el.querySelectorAll("img[alt], svg[aria-label], [role=img][aria-label]")].map((i) => i.getAttribute("alt") || i.getAttribute("aria-label") || "").join("").trim();
    const text = (el.innerText || el.textContent || "").trim();
    return text || imgs || el.getAttribute("title")?.trim() || (el.tagName === "INPUT" && /^(submit|button|reset)$/i.test(el.type) ? el.value : "") || el.getAttribute("placeholder")?.trim() || "";
  };
  const tag = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
  for (const el of document.querySelectorAll("button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], [role=switch], [role=checkbox]")) if (visible(el) && !name(el)) out.push(`no name: ${tag(el)}`);
  for (const el of document.querySelectorAll("input:not([type=hidden]), textarea, select")) if (visible(el) && !name(el)) out.push(`field with no name: ${tag(el)}`);
  for (const el of document.querySelectorAll("img")) if (visible(el) && !el.hasAttribute("alt")) out.push(`image with no alt: ${tag(el)}`);
  // React handlers leave no onclick attribute: a pointer cursor on a plain box with no role, outside any control, is the tell.
  for (const el of document.querySelectorAll("div, span, li, p, td")) {
    if (!visible(el) || el.getAttribute("role") || el.hasAttribute("tabindex") || getComputedStyle(el).cursor !== "pointer") continue;
    if (el.closest("button, a, label, summary, [role], [tabindex], input, select, textarea") || el.querySelector("button, a, input, select, textarea, [role=button]")) continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") continue;
    out.push(`clickable box not a button: ${tag(el)}`);
  }
  for (const el of document.querySelectorAll("[tabindex]")) if (Number(el.getAttribute("tabindex")) > 0) out.push(`positive tabindex: ${tag(el)}`);
  const seen = new Map();
  for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1 && id) out.push(`duplicate id "${id}" (${n}×)`);
  return [...new Set(out)].slice(0, 40);
}
