/*
 * Portions adapted from n8n-io/nod (https://github.com/n8n-io/nod, commit 0f9de28af967ad6f7be12a3181edcef860216328),
 * Copyright 2026 n8n GmbH, Apache License 2.0; modified for Sklubot: selectedText and copyContent of
 * src/web/lib/clipboard.ts (a table copied as tab-separated text plus its HTML, the copy buttons left out of the copy;
 * a selection inside one message only) kept almost as is; the buttons are added to the sanitised markdown HTML after it
 * is rendered (Sklubot renders messages with marked + DOMPurify, which forbids <button> in message text), and the reply
 * quote is written into the composer's draft as a Markdown quote.
 *
 * nod audit item 6 (rows 22, 23): "Copier" on code blocks and tables; reply to a message or to a selected passage, and
 * a click on a quote in a message goes back to the passage it quotes.
 */

/** The text selected inside `element` (empty when the selection starts or ends outside it). From nod. */
export function selectedText(element: HTMLElement | null): string {
  const selection = window.getSelection();
  return element && selection && !selection.isCollapsed && element.contains(selection.anchorNode) && element.contains(selection.focusNode) ? selection.toString() : "";
}

/** A table as tab-separated rows (pastes as cells in a spreadsheet). From nod. */
export function tableText(table: HTMLTableElement): string {
  return Array.from(table.querySelectorAll("tr"))
    .map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => (cell.textContent ?? "").replace(/[\t\n]+/g, " ").trim()).join("\t"))
    .join("\n");
}

/** Copies text, and the element's HTML too when the browser allows it (a table keeps its cells). From nod. */
export async function copyContent(text: string, element?: HTMLElement | null): Promise<void> {
  const table = element?.matches("table") ? (element as HTMLTableElement) : null;
  if (table) text = tableText(table);
  if (element && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("button,.md-copy").forEach((node) => node.remove());
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([clone.outerHTML], { type: "text/html" }) })]);
  } else await navigator.clipboard.writeText(text);
}

const fr = () => typeof document !== "undefined" && document.documentElement.lang === "fr";
const label = (kind: "code" | "table" | "done" | "fail") =>
  ({ code: fr() ? "Copier le code" : "Copy code", table: fr() ? "Copier le tableau" : "Copy table", done: fr() ? "Copié" : "Copied", fail: fr() ? "Impossible de copier : sélectionne le texte" : "Could not copy: select the text" })[kind];

/**
 * Adds a "Copier" button to each code block and table of a rendered message (once). Our own button, outside the
 * sanitised HTML; the click copies the block's text (a table as cells).
 */
export function addCopyButtons(root: HTMLElement): void {
  const blocks: [HTMLElement, "code" | "table"][] = [
    ...Array.from(root.querySelectorAll<HTMLElement>("pre")).map((el) => [el, "code"] as [HTMLElement, "code"]),
    ...Array.from(root.querySelectorAll<HTMLElement>(".md-table")).map((el) => [el, "table"] as [HTMLElement, "table"]),
  ];
  for (const [block, kind] of blocks) {
    if (block.dataset.copy === "1") continue;
    block.dataset.copy = "1";
    block.classList.add("md-copyable");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "md-copy";
    button.textContent = label(kind);
    button.setAttribute("aria-label", label(kind));
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = kind === "table" ? block.querySelector("table") : block.querySelector("code") ?? block;
      const text = kind === "table" ? "" : (target?.textContent ?? "");
      copyContent(text, kind === "table" ? (target as HTMLElement) : undefined).then(
        () => { button.textContent = label("done"); window.setTimeout(() => { button.textContent = label(kind); }, 1500); },
        () => { button.textContent = label("fail"); },
      );
    });
    block.appendChild(button);
  }
}

/** The draft a reply starts with: the quoted words as a Markdown quote, then what the user had already typed. */
export function replyDraft(quote: string, current: string): string {
  const lines = quote.replace(/\r\n/g, "\n").trim().slice(0, 1200).split("\n").map((l) => `> ${l}`.trimEnd());
  const rest = current.trim();
  return `${lines.join("\n")}\n\n${rest ? `${rest}\n` : ""}`;
}

/**
 * A click on a quote inside a message: the message it quotes (the latest earlier one that contains the quoted words) is
 * scrolled to and highlighted for a moment. Returns false when nothing matches.
 */
export function jumpToQuoted(quote: HTMLElement, transcript: ParentNode = document): boolean {
  const words = (quote.textContent ?? "").replace(/\s+/g, " ").trim();
  if (words.length < 3) return false;
  const own = quote.closest<HTMLElement>("[data-seq]");
  const probe = words.slice(0, 80).toLowerCase();
  const candidates = Array.from(transcript.querySelectorAll<HTMLElement>(".msg[data-seq]")).filter((m) => m !== own && Number(m.dataset.seq) < Number(own?.dataset.seq ?? Infinity));
  const target = candidates.reverse().find((m) => {
    const clone = m.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("blockquote,button").forEach((n) => n.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").toLowerCase().includes(probe);
  });
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("is-quoted-target");
  window.setTimeout(() => target.classList.remove("is-quoted-target"), 1600);
  return true;
}
