import { useRef, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { CopyButton } from "./ui";
import { PageComment } from "./PageComment";
import { PAGE_COMMENT_PARAM } from "../../../server/src/clientshared/pagecomment";
import "./PagePreview.css";

/* The chat's preview of a page a bot published (server/src/pagefiles.ts): the page itself in an
   <iframe sandbox="allow-scripts allow-popups"> — its scripts run without this app's origin, cookies or storage, as the
   page's own CSP sandbox also imposes — with Open, Copy the link and Versions (Settings → Pages). Only pages of this
   server are previewed; any other link stays a plain link. */

const LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+?\/p\/([A-Za-z0-9_-]{16,64}))\/?\)/;

/** The dev gallery shows a sample page instead of a real address (dev/Gallery.tsx). `comment`: with the L140 comment layer. */
let sourceOf: (url: string, comment: boolean) => string = (url, comment) => (comment ? `${url}?${PAGE_COMMENT_PARAM}=1` : url);
export const setPagePreviewSource = (fn: (url: string, comment: boolean) => string) => { sourceOf = fn; };
let ownOrigin = () => location.origin;
export const setPagePreviewOrigin = (fn: () => string) => { ownOrigin = fn; };

export function pageLinkIn(text: string): { title: string; url: string } | null {
  const m = LINK.exec(text);
  if (!m) return null;
  try {
    const url = new URL(m[2]);
    if (url.origin !== ownOrigin() || url.pathname !== "/p/" + m[3] || url.username || url.password || url.search || url.hash) return null;
  } catch { return null; }
  return { title: m[1], url: m[2] };
}

export function PagePreview({ text, page, botId, thread, readOnly }: {
  text: string; page?: { token: string; title: string }; botId?: string; thread?: number; readOnly?: boolean;
}) {
  const t = useT();
  const showArtifact = useStore(s=>s.showArtifact);
  const [shown, setShown] = useState(true);
  const link = page && /^[A-Za-z0-9_-]{16,64}$/.test(page.token)
    ? { title: page.title, url: `${ownOrigin()}/p/${page.token}` } : pageLinkIn(text);
  const token = link?.url.split("/").pop() ?? "";
  const revision = useStore((s) => s.pageChanges[token] ?? 0);
  const own = useStore((s) => !!botId && !!s.bots[botId] && !s.bots[botId].access);
  const frame = useRef<HTMLIFrameElement>(null);
  if (!link) return null;
  const comment = own && !readOnly; // L140: only the bot's owner, never in a read-only earlier conversation
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
          <iframe ref={frame} key={revision} src={sourceOf(link.url, comment)} title={link.title} sandbox="allow-scripts allow-popups" loading="lazy" referrerPolicy="no-referrer" />
        </div>
      )}
      {shown && comment && botId && <PageComment frame={frame} botId={botId} title={link.title} url={link.url} />}
      <div className="page-preview-actions">
        <a className="btn btn-small" href={link.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={13} /> {t("pagePreview.open")}</a>
        <CopyButton text={link.url} label={t("pagePreview.copy")} />
        {botId && <button type="button" className="btn btn-small" onClick={() => showArtifact({token,title:link.title,botId,thread,readOnly})}><Icon name="edit" size={13} /> {t("artifact.workspace")}</button>}
      </div>
    </figure>
  );
}
