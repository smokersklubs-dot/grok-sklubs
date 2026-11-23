/**
 * L136 — long blocks of a message fold. A code block of more than FOLD_LINES lines, or a table of more than FOLD_ROWS
 * rows, shows its first part with a « Tout afficher (N lignes) » button; « Replier » folds it again. Our own button,
 * outside the sanitised HTML, added once per block (like « Copier », messagecopy.ts).
 */
export const FOLD_LINES = 20;
export const FOLD_ROWS = 12;

/** Lines of a code block's text (a final newline does not count). */
export function codeLines(text: string): number {
  const t = text.replace(/\n$/, "");
  return t ? t.split("\n").length : 0;
}

/** Whether a block of this size folds. */
export function shouldFold(kind: "code" | "table", size: number): boolean {
  return kind === "code" ? size > FOLD_LINES : size > FOLD_ROWS;
}

function label(open: boolean, kind: "code" | "table", n: number): string {
  const fr = document.documentElement.lang === "fr";
  if (open) return fr ? "Replier" : "Fold";
  return kind === "code" ? (fr ? `Tout afficher (${n} lignes)` : `Show all (${n} lines)`) : (fr ? `Tout afficher (${n} rangées)` : `Show all (${n} rows)`);
}

export function addFoldToggles(root: HTMLElement): void {
  const blocks: [HTMLElement, "code" | "table", number][] = [];
  for (const pre of Array.from(root.querySelectorAll<HTMLElement>("pre"))) blocks.push([pre, "code", codeLines(pre.querySelector("code")?.textContent ?? pre.textContent ?? "")]);
  for (const t of Array.from(root.querySelectorAll<HTMLElement>(".md-table"))) blocks.push([t, "table", t.querySelectorAll("tbody tr").length]);
  for (const [block, kind, n] of blocks) {
    if (block.dataset.fold || !shouldFold(kind, n)) continue;
    block.dataset.fold = "closed";
    block.classList.add("md-folded");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "md-fold";
    button.textContent = label(false, kind, n);
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = block.dataset.fold === "closed";
      block.dataset.fold = open ? "open" : "closed";
      block.classList.toggle("md-folded", !open);
      button.textContent = label(open, kind, n);
      button.setAttribute("aria-expanded", String(open));
      if (!open) block.scrollIntoView({ block: "nearest" });
    });
    block.after(button);
  }
}
