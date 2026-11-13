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
  return clean.replace(/<table>/g, '<div class="md-table"><table>').replace(/<\/table>/g, "</table></div>");
}
