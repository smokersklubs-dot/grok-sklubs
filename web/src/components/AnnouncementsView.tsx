import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { dateTime, relTime } from "../lib/format";
import { useAnnouncements } from "../lib/announcements";
import { ANNOUNCE_KINDS, ANNOUNCE_LIMITS, safeHttpsUrl } from "../types";
import type { AnnounceAudienceInput, AnnounceKind, AnnouncementAdminItem, AnnouncementDraft, AnnouncementPreview, AnnouncementsAdmin, AnnouncementView } from "../types";
import { AnnouncementCard, KIND_ICON } from "./AnnouncementCard";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote, IconButton, Loading, Toggle, useTick } from "./ui";

/**
 * Page « Annonces » (the server's owner and hosted operators only; server: server/src/announcements.ts): write an
 * announcement — kind, title, plain-text body, an https link, who reads it, from when to when, a maintenance band, push
 * and e-mail — see it as readers will (and how many accounts it reaches) before publishing, change it, archive it.
 */

type AudienceType = AnnounceAudienceInput["type"];
interface Form {
  kind: AnnounceKind; title: string; body: string; linkUrl: string; linkLabel: string;
  audience: AudienceType; planId: string; workspaceId: string; emails: string;
  start: string; end: string; siteBanner: boolean; push: boolean; email: boolean;
}
const EMPTY: Form = { kind: "info", title: "", body: "", linkUrl: "", linkLabel: "", audience: "everyone", planId: "", workspaceId: "", emails: "", start: "", end: "", siteBanner: false, push: false, email: false };

const pad = (n: number) => String(n).padStart(2, "0");
/** A time as the value of an <input type="datetime-local"> (the browser's time zone). */
const toLocalInput = (ms: number | null) => { if (ms === null) return ""; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = (v: string): number | null => { if (!v) return null; const ms = new Date(v).getTime(); return Number.isFinite(ms) ? ms : null; };

function formOf(i: AnnouncementAdminItem, copy: boolean): Form {
  const a = i.audience;
  return {
    kind: i.kind, title: i.title, body: i.body, linkUrl: i.link?.url ?? "", linkLabel: i.link?.label ?? "",
    audience: a.type, planId: a.type === "plan" ? a.planId : "", workspaceId: a.type === "workspace" ? a.workspaceId : "", emails: i.emails.join("\n"),
    start: copy || i.startsAt <= Date.now() ? "" : toLocalInput(i.startsAt), end: copy ? "" : toLocalInput(i.endsAt),
    siteBanner: i.siteBanner, push: copy ? i.push : i.push, email: i.email,
  };
}
function draftOf(f: Form, keepStart: number | null): AnnouncementDraft {
  const audience: AnnounceAudienceInput = f.audience === "plan" ? { type: "plan", planId: f.planId } : f.audience === "workspace" ? { type: "workspace", workspaceId: f.workspaceId }
    : f.audience === "accounts" ? { type: "accounts", emails: f.emails.split(/[\s,;]+/).filter(Boolean) } : { type: "everyone" };
  return { kind: f.kind, title: f.title, body: f.body, linkUrl: f.linkUrl, linkLabel: f.linkLabel, audience, startsAt: fromLocalInput(f.start) ?? keepStart, endsAt: fromLocalInput(f.end), siteBanner: f.kind === "maintenance" && f.siteBanner, push: f.push, email: f.email };
}

export function AnnouncementsView() {
  const t = useT();
  const { setMobileNav, showToast } = useStore.getState();
  const [data, setData] = useState<AnnouncementsAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The editor: null (closed), "new", or the id being changed. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [showPast, setShowPast] = useState(false);
  const now = useTick(30_000);

  const load = useCallback(async () => {
    try { setData(await api<AnnouncementsAdmin>("GET", "/announcements-admin")); setError(null); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const current = editing && editing !== "new" ? data?.items.find((i) => i.id === editing) ?? null : null;
  const open = (id: string | "new", f: Form) => { setEditing(id); setForm(f); window.scrollTo?.({ top: 0 }); document.querySelector(".ann-admin .tasks-body")?.scrollTo?.({ top: 0 }); };
  const saved = (next: AnnouncementsAdmin, message: string) => { setData(next); setEditing(null); setForm(EMPTY); showToast(message); void useAnnouncements.getState().load(); };
  const archive = async (i: AnnouncementAdminItem) => {
    try { saved(await api<AnnouncementsAdmin>("POST", `/announcements-admin/${enc(i.id)}/archive`), t("ann.archived")); } catch (e) { setError(errText(e)); }
  };

  const items = data?.items ?? [];
  const up = items.filter((i) => i.status === "live" || i.status === "scheduled");
  const past = items.filter((i) => i.status === "ended" || i.status === "archived");

  return (
    <section className="main tasks-view today-view ann-admin" aria-label={t("ann.admin.title")}>
      <header className="tasks-head today-head">
        <IconButton icon="menu" label={t("common.openMenu")} className="only-mobile" onClick={() => setMobileNav(true)} />
        <div className="today-heading">
          <h1>{t("ann.admin.title")}</h1>
          <p className="today-date">{t("ann.admin.subtitle")}</p>
        </div>
        {!editing && <button type="button" className="btn btn-accent" onClick={() => open("new", EMPTY)}><Icon name="plus" size={15} /> {t("ann.admin.new")}</button>}
      </header>
      <div className="tasks-body today-body">
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
        {!data && !error && <Loading label={t("ann.admin.loading")} />}
        {data && (
          <div className="ann-admin-grid">
            {editing && (
              <Editor
                key={editing}
                data={data}
                form={form}
                setForm={setForm}
                current={current}
                onCancel={() => { setEditing(null); setForm(EMPTY); }}
                onSaved={(next, created) => saved(next, t(created ? "ann.published" : "ann.saved"))}
              />
            )}
            <Block icon="bell" title={t("ann.admin.up")} count={up.length}>
              {up.length === 0 ? (
                <div className="today-empty"><Icon name="bell" size={22} /><div><p className="today-empty-title">{t("ann.admin.emptyTitle")}</p><p className="today-empty-text">{t("ann.admin.emptyText")}</p></div></div>
              ) : (
                <ul className="ann-admin-list">{up.map((i) => <AdminRow key={i.id} item={i} now={now} data={data} onEdit={() => open(i.id, formOf(i, false))} onCopy={() => open("new", formOf(i, true))} onArchive={() => archive(i)} />)}</ul>
              )}
            </Block>
            {past.length > 0 && (
              <Block icon="history" title={t("ann.admin.past")} count={past.length}>
                {showPast ? (
                  <ul className="ann-admin-list">{past.map((i) => <AdminRow key={i.id} item={i} now={now} data={data} onCopy={() => open("new", formOf(i, true))} onArchive={i.status === "archived" ? undefined : () => archive(i)} />)}</ul>
                ) : (
                  <button type="button" className="link" onClick={() => setShowPast(true)}>{t("ann.admin.showPast", { n: past.length })}</button>
                )}
              </Block>
            )}
            {data.log.length > 0 && (
              <details className="ann-log">
                <summary>{t("ann.admin.log")}</summary>
                <ul>
                  {data.log.map((l, n) => (
                    <li key={n}><span className="ann-log-when">{dateTime(l.at)}</span> <span>{t(`ann.log.${l.action}` as Key, { name: l.actorName, title: l.title })}</span></li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Block({ icon, title, count, children }: { icon: "bell" | "history" | "edit"; title: string; count?: number; children: ReactNode }) {
  const hid = useId();
  return (
    <section className="today-block" aria-labelledby={hid}>
      <header className="today-block-head">
        <Icon name={icon} size={17} />
        <h2 id={hid}>{title}</h2>
        {count !== undefined && count > 0 && <span className="count-badge">{count}</span>}
      </header>
      {children}
    </section>
  );
}

function audienceText(i: AnnouncementAdminItem, t: ReturnType<typeof useT>): string {
  if (i.audience.type === "everyone") return t("ann.aud.everyone");
  if (i.audience.type === "plan") return t("ann.aud.planOf", { name: i.audienceLabel });
  if (i.audience.type === "workspace") return t("ann.aud.workspaceOf", { name: i.audienceLabel });
  return i.emails.length <= 2 ? i.emails.join(", ") : t("ann.aud.accountsN", { first: i.emails[0], n: i.emails.length - 1 });
}

function AdminRow({ item: i, now, onEdit, onCopy, onArchive }: { item: AnnouncementAdminItem; now: number; data: AnnouncementsAdmin; onEdit?: () => void; onCopy: () => void; onArchive?: () => Promise<void> | void }) {
  const t = useT();
  const when = i.status === "scheduled" ? t("ann.when.from", { when: dateTime(i.startsAt) }) : i.endsAt ? t("ann.when.until", { when: dateTime(i.endsAt) }) : t("ann.when.since", { when: relTime(i.startsAt, now) });
  return (
    <li className={`ann-row is-${i.kind} ${i.status === "archived" || i.status === "ended" ? "is-past" : ""}`}>
      <span className="ann-card-icon" aria-hidden="true"><Icon name={KIND_ICON[i.kind]} size={16} /></span>
      <div className="ann-row-main">
        <div className="ann-card-chips">
          <span className={`chip ann-kind is-${i.kind}`}>{t(`ann.kind.${i.kind}` as Key)}</span>
          <span className={`chip ann-status is-${i.status}`}>{t(`ann.status.${i.status}` as Key)}</span>
          {i.siteBanner && <span className="chip">{t("ann.siteBannerChip")}</span>}
        </div>
        <p className="ann-row-title">{i.title}</p>
        <p className="ann-row-meta">{audienceText(i, t)} · {when}</p>
        <p className="ann-row-stats">
          <span><Icon name="users" size={13} /> {t("ann.stats.readers", { n: i.recipients })}</span>
          <span><Icon name="check" size={13} /> {t("ann.stats.closed", { n: i.dismissed })}</span>
          {i.push && <span><Icon name="bell" size={13} /> {t("ann.stats.push", { n: i.sent.push })}</span>}
          {i.email && <span><Icon name="mail" size={13} /> {t("ann.stats.email", { n: i.sent.email })}</span>}
        </p>
      </div>
      <div className="ann-row-actions">
        {onEdit && <button type="button" className="btn btn-small" onClick={onEdit}><Icon name="edit" size={14} /> {t("ann.edit")}</button>}
        <button type="button" className="btn btn-small btn-ghost" onClick={onCopy}><Icon name="copy" size={14} /> {t("ann.duplicate")}</button>
        {onArchive && <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("ann.archive")} confirmLabel={t("ann.archiveConfirm")} onConfirm={onArchive} />}
      </div>
    </li>
  );
}

function Editor({ data, form: f, setForm, current, onCancel, onSaved }: {
  data: AnnouncementsAdmin; form: Form; setForm: (f: Form) => void; current: AnnouncementAdminItem | null;
  onCancel: () => void; onSaved: (next: AnnouncementsAdmin, created: boolean) => void;
}) {
  const t = useT();
  const ids = { title: useId(), body: useId(), url: useId(), label: useId(), aud: useId(), sub: useId(), start: useId(), end: useId() };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ recipients: number } | { error: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...f, [k]: v });
  const keepStart = current && current.startsAt <= Date.now() ? current.startsAt : null;
  const draft = useMemo(() => draftOf(f, keepStart), [f, keepStart]);
  const L = ANNOUNCE_LIMITS;
  const urlBad = f.linkUrl.trim() !== "" && !safeHttpsUrl(f.linkUrl);
  const scheduled = (draft.startsAt ?? 0) > Date.now();
  const alreadySent = !!current && (current.sent.push > 0 || current.sent.email > 0);

  // The server's check (the same cleaning as publishing, and how many accounts it reaches), shortly after each change.
  useEffect(() => {
    if (!f.title.trim()) { setCheck(null); return; }
    const timer = window.setTimeout(() => {
      api<AnnouncementPreview>("POST", "/announcements-admin/preview", { ...draft, id: current?.id }).then(
        (r) => setCheck({ recipients: r.recipients }), (e: unknown) => setCheck({ error: errText(e) }));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, current?.id, f.title]);

  const preview: AnnouncementView = { id: "preview", kind: f.kind, title: f.title.trim() || t("ann.form.titlePlaceholder"), body: f.body.trim(), link: f.linkUrl.trim() && !urlBad ? { url: f.linkUrl.trim(), label: f.linkLabel.trim() } : null, startsAt: draft.startsAt ?? Date.now(), endsAt: draft.endsAt, siteBanner: draft.siteBanner, unread: true };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = current
        ? await api<AnnouncementsAdmin>("PUT", `/announcements-admin/${enc(current.id)}`, draft)
        : await api<AnnouncementsAdmin>("POST", "/announcements-admin", draft);
      onSaved(next, !current);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Block icon="edit" title={current ? t("ann.form.editTitle") : t("ann.form.newTitle")}>
      <div className="ann-editor">
        <div className="ann-editor-fields">
          <div className="field">
            <span className="field-label">{t("ann.form.kind")}</span>
            <div className="segmented ann-kinds" role="group" aria-label={t("ann.form.kind")}>
              {ANNOUNCE_KINDS.map((k) => (
                <button key={k} type="button" className={f.kind === k ? "is-active" : ""} aria-pressed={f.kind === k} onClick={() => set("kind", k)}>
                  <Icon name={KIND_ICON[k]} size={13} /> {t(`ann.kind.${k}` as Key)}
                </button>
              ))}
            </div>
            <p className="field-hint">{t(`ann.kindHint.${f.kind}` as Key)}</p>
          </div>
          <Counted id={ids.title} label={t("ann.form.title")} n={f.title.length} max={L.title}>
            <input id={ids.title} className="input" value={f.title} maxLength={L.title + 20} onChange={(e) => set("title", e.target.value)} placeholder={t("ann.form.titlePlaceholder")} />
          </Counted>
          <Counted id={ids.body} label={t("ann.form.body")} n={f.body.length} max={L.body} hint={t("ann.form.bodyHint")}>
            <textarea id={ids.body} className="input ann-body-input" rows={5} value={f.body} maxLength={L.body + 100} onChange={(e) => set("body", e.target.value)} />
          </Counted>
          <div className="ann-two">
            <div className="field">
              <label className="field-label" htmlFor={ids.url}>{t("ann.form.link")} <span className="muted">{t("common.optional")}</span></label>
              <input id={ids.url} className="input" type="url" inputMode="url" placeholder="https://" value={f.linkUrl} onChange={(e) => set("linkUrl", e.target.value)} aria-invalid={urlBad || undefined} />
              {urlBad && <p className="field-hint ann-bad">{t("ann.form.linkBad")}</p>}
            </div>
            <Counted id={ids.label} label={t("ann.form.linkLabel")} n={f.linkLabel.length} max={L.linkLabel}>
              <input id={ids.label} className="input" value={f.linkLabel} disabled={!f.linkUrl.trim()} placeholder={t("ann.openLink")} onChange={(e) => set("linkLabel", e.target.value)} />
            </Counted>
          </div>
          <div className="ann-two">
            <div className="field">
              <label className="field-label" htmlFor={ids.aud}>{t("ann.form.audience")}</label>
              <select id={ids.aud} className="input" value={f.audience} onChange={(e) => set("audience", e.target.value as AudienceType)}>
                <option value="everyone">{t("ann.aud.everyone")}</option>
                {data.plans && <option value="plan">{t("ann.aud.plan")}</option>}
                <option value="workspace">{t("ann.aud.workspace")}</option>
                <option value="accounts">{t("ann.aud.accounts")}</option>
              </select>
            </div>
            {f.audience === "plan" && data.plans && (
              <div className="field">
                <label className="field-label" htmlFor={ids.sub}>{t("ann.aud.plan")}</label>
                <select id={ids.sub} className="input" value={f.planId} onChange={(e) => set("planId", e.target.value)}>
                  <option value="">{t("ann.aud.choose")}</option>
                  {data.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            {f.audience === "workspace" && (
              <div className="field">
                <label className="field-label" htmlFor={ids.sub}>{t("ann.aud.workspace")}</label>
                <select id={ids.sub} className="input" value={f.workspaceId} onChange={(e) => set("workspaceId", e.target.value)}>
                  <option value="">{data.workspaces.length ? t("ann.aud.choose") : t("ann.aud.noWorkspace")}</option>
                  {data.workspaces.map((w) => <option key={w.id} value={w.id}>{t("ann.aud.wsOption", { name: w.name, n: w.members })}</option>)}
                </select>
              </div>
            )}
          </div>
          {f.audience === "accounts" && (
            <div className="field">
              <label className="field-label" htmlFor={ids.sub}>{t("ann.aud.emails")}</label>
              <textarea id={ids.sub} className="input mono" rows={3} value={f.emails} onChange={(e) => set("emails", e.target.value)} placeholder={"camille@exemple.fr\nsam@exemple.fr"} />
              <p className="field-hint">{t("ann.aud.emailsHint", { n: L.accounts })}</p>
            </div>
          )}
          <div className="ann-two">
            <div className="field">
              <label className="field-label" htmlFor={ids.start}>{t("ann.form.start")}</label>
              <input id={ids.start} className="input" type="datetime-local" value={f.start} onChange={(e) => set("start", e.target.value)} />
              <p className="field-hint">{f.start ? (scheduled ? t("ann.form.scheduled") : t("ann.form.startNow")) : t("ann.form.startEmpty")}</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={ids.end}>{t("ann.form.end")} <span className="muted">{t("common.optional")}</span></label>
              <input id={ids.end} className="input" type="datetime-local" value={f.end} onChange={(e) => set("end", e.target.value)} />
              <p className="field-hint">{f.end ? t("ann.form.endSet") : t("ann.form.endEmpty")}</p>
            </div>
          </div>
          {f.kind === "maintenance" && (
            <ToggleRow label={t("ann.form.siteBanner")} hint={t("ann.form.siteBannerHint")} checked={f.siteBanner} onChange={(v) => set("siteBanner", v)} />
          )}
          <ToggleRow label={t("ann.form.push")} hint={t("ann.form.pushHint")} checked={f.push} onChange={(v) => set("push", v)} disabled={alreadySent && !!current?.push} />
          <ToggleRow label={t("ann.form.email")} hint={data.mailConfigured ? t("ann.form.emailHint") : t("ann.form.emailOff")} checked={f.email && data.mailConfigured} onChange={(v) => set("email", v)} disabled={!data.mailConfigured || (alreadySent && !!current?.email)} />
          {(f.push || (f.email && data.mailConfigured)) && !alreadySent && (
            <p className="approval-irreversible"><Icon name="alert" size={14} /><span><strong>{t("approval.irreversible")}</strong> {t("ann.form.irreversible")}</span></p>
          )}
          {alreadySent && <p className="field-hint">{t("ann.form.alreadySent")}</p>}
        </div>

        <div className="ann-editor-preview">
          <p className="field-label">{t("ann.form.preview")}</p>
          <AnnouncementCard a={preview} onDismiss={() => undefined} />
          <p className={`ann-check ${check && "error" in check ? "is-bad" : ""}`} role="status">
            {check === null ? t("ann.form.checkWait") : "error" in check ? <><Icon name="alert" size={14} /> {check.error}</> : <><Icon name="users" size={14} /> {t("ann.form.reaches", { n: check.recipients })}</>}
          </p>
        </div>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="card-actions ann-editor-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t("common.cancel")}</button>
        <span className="spacer" />
        <button type="button" className="btn btn-accent" onClick={() => void submit()} disabled={busy || !f.title.trim() || urlBad}>
          {busy ? t("common.saving") : current ? t("ann.form.save") : scheduled ? t("ann.form.schedule") : t("ann.form.publish")}
        </button>
      </div>
    </Block>
  );
}

function Counted({ id, label, n, max, hint, children }: { id: string; label: string; n: number; max: number; hint?: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="field">
      <div className="ann-label-row">
        <label className="field-label" htmlFor={id}>{label}</label>
        <span className={`ann-count ${n > max ? "is-over" : ""}`} aria-live="polite">{t("ann.form.count", { n, max })}</span>
      </div>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="ann-toggle-row">
      <div><p className="ann-toggle-label">{label}</p><p className="field-hint">{hint}</p></div>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}
