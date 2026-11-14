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
  return callouts(clean).replace(/<table>/g, '<div class="md-table"><table>').replace(/<\/table>/g, "</table></div>");
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
