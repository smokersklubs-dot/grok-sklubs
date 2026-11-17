import { useEffect, useId, useRef, useState } from "react";
import { tn, useT, type Key } from "../i18n";
import { useAnnouncements } from "../lib/announcements";
import { relTime } from "../lib/format";
import { linkify, safeHttpsUrl, type AnnounceKind, type AnnouncementView } from "../types";
import { Icon, type IconName } from "./Icon";
import { IconButton, useEscape } from "./ui";
import "../styles/announcements.css";

/**
 * « Annonces » on the reader's side: the card (on « Aujourd'hui », in the bell, in the editor's preview), the bell of
 * the sidebar, and the maintenance band on top of every page. Server: server/src/announcements.ts.
 *
 * Rendering is text only: the title, the body and the button's label are React text nodes (never HTML), the body keeps
 * its line breaks with CSS (`white-space: pre-line`), and only https addresses become links — each one checked again
 * here with the URL constructor (announcetext.ts safeHttpsUrl) and opened in a new tab with rel="noopener noreferrer".
 */

/** A stable empty list for the store selectors (a new [] each time would re-render without end). */
const NONE: AnnouncementView[] = [];

export const KIND_ICON: Record<AnnounceKind, IconName> = { info: "info", new: "star", maintenance: "wrench", important: "alert" };

/** The body: text nodes and https links, nothing else. */
export function AnnouncementText({ text, className, inline }: { text: string; className?: string; inline?: boolean }) {
  const pieces = linkify(text).map((p, i) => (p.url
    ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="ann-inline-link">{p.text}</a>
    : <span key={i}>{p.text}</span>));
  return inline ? <span className={className}>{pieces}</span> : <p className={className}>{pieces}</p>;
}

/** One announcement. `onDismiss`: "Fermer" (or "J'ai lu" for an important one); none in a preview. */
export function AnnouncementCard({ a, onDismiss, compact, now }: { a: AnnouncementView; onDismiss?: () => void; compact?: boolean; now?: number }) {
  const t = useT();
  const hid = useId();
  const href = a.link ? safeHttpsUrl(a.link.url) : null;
  const important = a.kind === "important";
  return (
    <article className={`ann-card is-${a.kind} ${compact ? "is-compact" : ""}`} aria-labelledby={hid}>
      <span className="ann-card-icon" aria-hidden="true"><Icon name={KIND_ICON[a.kind]} size={compact ? 15 : 17} /></span>
      <div className="ann-card-main">
        <div className="ann-card-chips">
          <span className={`chip ann-kind is-${a.kind}`}>{t(`ann.kind.${a.kind}` as Key)}</span>
          {now !== undefined && <span className="ann-card-when">{relTime(a.startsAt, now)}</span>}
        </div>
        <h3 id={hid} className="ann-card-title">{a.title}</h3>
        {a.body && <AnnouncementText text={a.body} className="ann-card-body" />}
        {(href || (onDismiss && important)) && (
          <div className="ann-card-actions">
            {onDismiss && important && <span className="ann-card-hint">{t("ann.importantHint")}</span>}
            {onDismiss && important && (
              <button type="button" className="btn btn-small" onClick={onDismiss}><Icon name="check" size={14} /> {t("ann.readIt")}</button>
            )}
            {href && (
              <a className="btn btn-small btn-primary" href={href} target="_blank" rel="noopener noreferrer">
                {a.link?.label || t("ann.openLink")} <Icon name="external" size={13} />
              </a>
            )}
          </div>
        )}
      </div>
      {onDismiss && !important && <IconButton icon="close" size={15} className="ann-card-dismiss" label={t("ann.dismissLabel", { title: a.title })} onClick={onDismiss} />}
    </article>
  );
}

/** On top of « Aujourd'hui »: the announcements not closed yet (three, then "voir les autres"). */
export function TodayAnnouncements() {
  const t = useT();
  const items = useAnnouncements((s) => s.state?.items ?? NONE);
  const dismiss = useAnnouncements((s) => s.dismiss);
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 3);
  return (
    <section className="ann-today" aria-label={t("ann.title")}>
      {shown.map((a) => <AnnouncementCard key={a.id} a={a} onDismiss={() => void dismiss(a.id)} />)}
      {items.length > shown.length && <button type="button" className="link ann-more" onClick={() => setAll(true)}>{tn("ann.more", items.length - shown.length)}</button>}
    </section>
  );
}

/** The maintenance band, on top of every page, until it is closed (or taken down). */
export function SiteAnnouncementBanner() {
  const t = useT();
  const site = useAnnouncements((s) => s.state?.site ?? null);
  const dismiss = useAnnouncements((s) => s.dismiss);
  if (!site) return null;
  return (
    <div className="ann-site" role="status">
      <Icon name="wrench" size={16} />
      <p className="ann-site-text"><strong>{site.title}</strong>{site.body && <> — <AnnouncementText inline text={site.body.split("\n")[0]} className="ann-site-body" /></>}</p>
      <IconButton icon="close" size={15} label={t("ann.dismissLabel", { title: site.title })} onClick={() => void dismiss(site.id)} />
    </div>
  );
}

/** The sidebar's bell: the unread count, and the announcements in a panel (opening it marks them as seen). */
export function AnnouncementBell({ row }: { row?: boolean }) {
  const t = useT();
  const state = useAnnouncements((s) => s.state);
  const { seen, dismiss } = useAnnouncements.getState();
  const [open, setOpen] = useState(false);
  /** Where the panel opens: just under the bell (the maintenance band can push it down). */
  const [top, setTop] = useState(54);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pid = useId();
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onDown = (e: MouseEvent) => { if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const items = state?.items ?? [];
  const unread = state?.unread ?? 0;
  if (row && !items.length) return null;
  const toggle = () => {
    const next = !open;
    if (next && wrap.current) setTop(Math.round(wrap.current.getBoundingClientRect().bottom + 8));
    setOpen(next);
    if (next) void seen(items.filter((i) => i.unread && i.kind !== "important").map((i) => i.id));
  };
  const label = unread ? `${t("ann.bell")}, ${tn("ann.unread", unread)}` : t("ann.bell");
  return (
    <span className="ann-bell" ref={wrap}>
      {row ? (
        <button type="button" className="nav-row" onClick={toggle} aria-expanded={open} aria-controls={pid} aria-label={label} title={t("ann.bell")}>
          <span className="nav-row-icon"><Icon name="bell" size={19} />{unread > 0 && <span className="dot dot-attention" />}</span>
        </button>
      ) : (
        <button type="button" className={`icon-btn ann-bell-trigger ${open ? "is-active" : ""}`} onClick={toggle} aria-expanded={open} aria-controls={pid} aria-label={label} title={t("ann.bell")}>
          <Icon name="bell" size={18} />
          {unread > 0 && <span className="count-badge is-attention ann-bell-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
        </button>
      )}
      {open && (
        <div className="ann-pop" id={pid} role="dialog" aria-label={t("ann.title")} ref={panel} tabIndex={-1} style={{ top }}>
          <div className="ann-pop-head">
            <h2>{t("ann.title")}</h2>
            <IconButton icon="close" size={15} label={t("common.close")} onClick={() => setOpen(false)} />
          </div>
          {items.length === 0 ? (
            <p className="ann-pop-empty"><Icon name="check" size={16} /> {t("ann.empty")}</p>
          ) : (
            <div className="ann-pop-list">{items.map((a) => <AnnouncementCard key={a.id} a={a} compact now={Date.now()} onDismiss={() => void dismiss(a.id)} />)}</div>
          )}
        </div>
      )}
    </span>
  );
}
