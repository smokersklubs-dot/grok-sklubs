import { useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { CopyButton } from "./ui";
import "./PagePreview.css";

/* The chat's preview of a page a bot published (server/src/pagefiles.ts): the page itself in an
   <iframe sandbox="allow-scripts allow-popups"> — its scripts run without this app's origin, cookies or storage, as the
   page's own CSP sandbox also imposes — with Open, Copy the link and Versions (Settings → Pages). Only pages of this
   server are previewed; any other link stays a plain link. */

const LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+?\/p\/([A-Za-z0-9_-]{16,64}))\/?\)/;

/** The dev gallery shows a sample page instead of a real address (dev/Gallery.tsx). */
let sourceOf: (url: string) => string = (url) => url;
export const setPagePreviewSource = (fn: (url: string) => string) => { sourceOf = fn; };
let ownOrigin = () => location.origin;
export const setPagePreviewOrigin = (fn: () => string) => { ownOrigin = fn; };

export function pageLinkIn(text: string): { title: string; url: string } | null {
  const m = LINK.exec(text);
  if (!m) return null;
  try { if (new URL(m[2]).origin !== ownOrigin()) return null; } catch { return null; }
  return { title: m[1], url: m[2] };
}

export function PagePreview({ text }: { text: string }) {
  const t = useT();
  const openAppSettings = useStore((s) => s.openAppSettings);
  const [shown, setShown] = useState(true);
  const link = pageLinkIn(text);
  if (!link) return null;
  return (
    <figure className="page-preview" aria-label={t("pagePreview.label", { title: link.title })}>
      <figcaption className="page-preview-head">
        <Icon name="globe" size={15} />
        <span className="page-preview-title">{link.title}</span>
        <button type="button" className="btn btn-small btn-ghost page-preview-toggle" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
          <Icon name={shown ? "chevronDown" : "chevronRight"} size={14} /> <span className="page-preview-toggle-text">{t(shown ? "pagePreview.hide" : "pagePreview.show")}</span>
        </button>
      </figcaption>
      {shown && (
        <div className="page-preview-frame">
          <iframe src={sourceOf(link.url)} title={link.title} sandbox="allow-scripts allow-popups" loading="lazy" referrerPolicy="no-referrer" />
        </div>
      )}
      <div className="page-preview-actions">
        <a className="btn btn-small" href={link.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={13} /> {t("pagePreview.open")}</a>
        <CopyButton text={link.url} label={t("pagePreview.copy")} />
        <button type="button" className="btn btn-small" onClick={() => openAppSettings("pages")}><Icon name="history" size={13} /> {t("pagePreview.versions")}</button>
      </div>
    </figure>
  );
}
