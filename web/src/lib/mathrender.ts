import DOMPurify from "dompurify";
import { renderToString } from "../../vendor/katex/katex.mjs";
import { cleanMathMl, KATEX_OPTIONS } from "./mathtex";

/**
 * L147 — turns the math spans of a rendered message (web/src/lib/mathtex.ts) into MathML with KaTeX (MIT, vendored in
 * web/vendor/katex). Loaded on demand by the chat, only for a message that has math. Safe by construction: KaTeX runs
 * with trust off, its output is sanitised again with DOMPurify's MathML profile only (no HTML, no links, no styles),
 * and a formula KaTeX cannot read stays as its source text.
 */
export function renderMathIn(root: HTMLElement): number {
  let done = 0;
  for (const span of Array.from(root.querySelectorAll<HTMLElement>(".md-math:not([data-done])"))) {
    const tex = span.dataset.tex ?? "";
    const display = span.dataset.display === "1";
    span.dataset.done = "1";
    try {
      const markup = cleanMathMl(renderToString(tex, { ...KATEX_OPTIONS, displayMode: display }));
      const clean = DOMPurify.sanitize(markup, { USE_PROFILES: { mathMl: true } });
      if (!/<math\b/.test(clean)) { span.classList.add("is-error"); span.title = tex; continue; }
      span.innerHTML = clean;
      done++;
    } catch {
      span.classList.add("is-error");
    }
  }
  return done;
}
