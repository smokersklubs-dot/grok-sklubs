import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "INPUT") node.setAttribute("disabled", "");
});

/** Markdown → sanitised HTML. Tables are wrapped so they can scroll sideways. */
export function renderMarkdown(src: string): string {
  let html: string;
  try {
    html = marked.parse(src, { async: false });
  } catch {
    html = "";
  }
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "button", "textarea", "select", "iframe", "object", "embed", "video", "audio"],
    FORBID_ATTR: ["style", "id", "class", "name"],
  });
  return callouts(remoteImagesAsLinks(clean)).replace(/<table>/g, '<div class="md-table"><table>').replace(/<\/table>/g, "</table></div>");
}

/**
 * A picture from another site is never loaded on its own (it would tell that site who reads the message and when, and
 * the app's Content-Security-Policy refuses it anyway): it becomes a link that opens it in a new tab when clicked.
 * Pictures of this server (relative addresses, data: and blob:) stay pictures.
 */
const REMOTE_SRC = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
export function remoteImagesAsLinks(html: string): string {
  if (!/<img/i.test(html) || typeof document === "undefined") return html;
  const box = document.createElement("template");
  box.innerHTML = html;
  for (const img of [...box.content.querySelectorAll("img")]) {
    const src = img.getAttribute("src") ?? "";
    if (!REMOTE_SRC.test(src.trim())) continue;
    let sameSite = false;
    try { sameSite = new URL(src, location.href).origin === location.origin; } catch { /* not a URL: treated as remote */ }
    if (sameSite) continue;
    const link = document.createElement("a");
    const safe = /^https?:/i.test(src.trim()) || /^\/\//.test(src.trim());
    if (safe) { link.setAttribute("href", src); link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener noreferrer"); }
    link.className = "md-remote-img";
    const fr = document.documentElement.lang === "fr";
    const alt = (img.getAttribute("alt") ?? "").trim();
    link.textContent = `🖼 ${alt || (fr ? "Image d'un autre site" : "Image from another site")} — ${fr ? "cliquer pour l'ouvrir" : "click to open"}`;
    img.replaceWith(link);
  }
  return box.innerHTML;
}

/**
 * GitHub-style callouts ("> [!NOTE]", "> [!WARNING]"…, https://github.com/orgs/community/discussions/16925) become
 * coloured boxes. Done on the sanitised HTML: only our own class names are added.
 */
const CALLOUTS: Record<string, string> = { NOTE: "note", TIP: "tip", IMPORTANT: "important", WARNING: "warning", CAUTION: "caution" };
function callouts(html: string): string {
  return html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:<br>|\s)*/g, (_m, kind: string) =>
    `<blockquote class="md-callout is-${CALLOUTS[kind]}"><p><strong class="md-callout-title">${calloutLabel(kind)}</strong><br>`);
}
function calloutLabel(kind: string): string {
  const fr = typeof document !== "undefined" && document.documentElement.lang === "fr";
  const labels: Record<string, [string, string]> = { NOTE: ["Note", "Note"], TIP: ["Tip", "Astuce"], IMPORTANT: ["Important", "Important"], WARNING: ["Warning", "Attention"], CAUTION: ["Caution", "Prudence"] };
  return labels[kind][fr ? 1 : 0];
}
