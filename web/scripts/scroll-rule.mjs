// « Doit marcher » (24/11): every screen scrolls — the end of a long chat, list or page can be reached by hand, at the
// smallest and at a normal width. Run in the page (page.evaluate(scrollTrap)): the last visible pieces of text of the
// page are brought into view the way the browser would scroll to them (scrollIntoView), then it checks that they are
// on screen and that no box the user cannot scroll (overflow hidden / clip, or a page whose body does not scroll) had
// to move to show them. Returns the problems, in words ([] when everything can be reached).
export function scrollTrap() {
  const vh = window.innerHeight;
  const shown = (el) => {
    // Inside a closed <details> (not its summary) a piece is folded away on purpose, not out of reach.
    const closed = el.closest("details:not([open])");
    if (closed && !el.closest("summary")) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true, opacityProperty: true })) return false;
    for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return false; }
    const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2;
  };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  const leaves = [...document.querySelectorAll("body *")].filter((el) => {
    if (el.closest(".sidebar:not(.is-mobile-open), [aria-hidden=true], .sr-only, .visually-hidden")) return false;
    if (![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) return false;
    return shown(el);
  });
  const out = [];
  for (const el of leaves.slice(-3)) {
    const scrollables = [];
    for (let n = el.parentElement; n; n = n.parentElement) scrollables.push([n, n.scrollTop]);
    const docY = window.scrollY;
    el.scrollIntoView({ block: "end", inline: "nearest" });
    const r = el.getBoundingClientRect();
    if (r.top >= vh - 1 || r.bottom <= 1) { out.push(`${name(el)} cannot be brought on screen (top ${Math.round(r.top)} px, screen ${vh} px)`); continue; }
    for (const [n, before] of scrollables) {
      if (n.scrollTop === before || n === document.documentElement || n === document.body) continue;
      const oy = getComputedStyle(n).overflowY;
      if (oy === "hidden" || oy === "clip") { out.push(`${name(el)} is inside ${name(n)} (overflow-y: ${oy}): it can only be reached by a script, not by scrolling`); break; }
    }
    if (window.scrollY !== docY) {
      const h = getComputedStyle(document.documentElement).overflowY, b = getComputedStyle(document.body).overflowY;
      if (h === "hidden" || h === "clip" || ((b === "hidden" || b === "clip") && document.scrollingElement === document.body)) out.push(`${name(el)} is below the screen but the page itself does not scroll (overflow-y: hidden on html/body)`);
    }
  }
  return [...new Set(out)];
}
