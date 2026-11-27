import { useEffect, useId, useRef, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { Bot } from "../types";
import { setBotPhoto, useBotPhoto } from "./BotPhoto";
import { ErrorNote, Toggle } from "./ui";
import "./BotCare.css";

/**
 * L161, in a bot's settings (server botcare.ts, botcarework.ts, botphoto.ts, botreach.ts):
 *   BotPhotoField      « Photo » instead of the drawn character (resized by the server, never sent to a model)
 *   BotRoleField       « Rôle partagé » (Settings → Team → Rôles partagés)
 *   BotIdentityDocs    « Identité » in several named documents, and the ready-made personalities
 *   BotAsideField      « Mise de côté » after 14 days without use
 *   BotReachCard       « Ce que ce bot peut lire et écrire »
 */
const own = (bot: Bot) => bot.kind === "agent" && !bot.access;

export function BotCareFields({ bot, reachOpen = false }: { bot: Bot; reachOpen?: boolean }) {
  if (!own(bot)) return null;
  return (
    <div className="bot-care">
      <BotPhotoField bot={bot} />
      <BotRoleField bot={bot} />
      <BotIdentityDocs bot={bot} />
      <BotAsideField bot={bot} />
      <BotReachCard bot={bot} open={reachOpen} />
    </div>
  );
}

/* ---------- Photo ---------- */

export function BotPhotoField({ bot }: { bot: Bot }) {
  const t = useT();
  const url = useBotPhoto(bot.id);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/bots/${enc(bot.id)}/photo`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || t("api.generic"));
      setBotPhoto(bot.id, data.url);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try { await api("DELETE", `/bots/${enc(bot.id)}/photo`); setBotPhoto(bot.id, null); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="care-block" aria-labelledby={`photo-${bot.id}`}>
      <p className="action-title" id={`photo-${bot.id}`}>{t("care.photo.title")}</p>
      <div className="care-photo">
        {url ? <img className="care-photo-img" src={url} alt={t("care.photo.aria", { name: bot.name })} width={64} height={64} /> : <span className="care-photo-empty" aria-hidden="true" />}
        <div className="care-photo-side">
          <p className="muted small">{t("care.photo.hint")}</p>
          <div className="care-row">
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => input.current?.click()}>{t(url ? "care.photo.change" : "care.photo.add")}</button>
            {url && <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void remove()}>{t("care.photo.remove")}</button>}
          </div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label={t("care.photo.add")} onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); }} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

/* ---------- Rôle partagé ---------- */

interface Role { id: string; name: string; text: string; builtin: boolean; modified: boolean; bots: { id: string; name: string }[] }

export function BotRoleField({ bot }: { bot: Bot }) {
  const t = useT();
  const id = useId();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    Promise.all([api<{ roles: Role[] }>("GET", "/shared-roles"), api<{ roleId: string | null }>("GET", `/bots/${enc(bot.id)}/shared-role`)])
      .then(([r, b]) => { if (!dead) { setRoles(r.roles); setRoleId(b.roleId); } }, (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [bot.id]);
  const save = async (next: string) => {
    const before = roleId;
    setRoleId(next || null); setError(null);
    try { await api("PUT", `/bots/${enc(bot.id)}/shared-role`, { roleId: next || null }); } catch (e) { setRoleId(before); setError(errText(e)); }
  };
  const role = roles?.find((r) => r.id === roleId);
  return (
    <section className="care-block">
      <label className="action-title" htmlFor={id}>{t("care.role.title")}</label>
      <p className="muted small">{t("care.role.hint")}</p>
      <select id={id} className="input care-select" value={roleId ?? ""} disabled={!roles} onChange={(e) => void save(e.target.value)}>
        <option value="">{t("care.role.none")}</option>
        {roles?.map((r) => <option key={r.id} value={r.id}>{r.name}{r.modified ? ` · ${t("care.role.modified")}` : ""}</option>)}
      </select>
      {role && <p className="care-quote small">{role.text}</p>}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

/* ---------- Identité en plusieurs documents ---------- */

interface Doc { id: string; title: string; body: string; personality: string; updatedAt: number }
interface Personality { id: string; name: string; text: string }

export function BotIdentityDocs({ bot }: { bot: Bot }) {
  const t = useT();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [presets, setPresets] = useState<Personality[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<{ docs: Doc[]; personalities: Personality[] }>("GET", `/bots/${enc(bot.id)}/identity`).then((r) => { if (!dead) { setDocs(r.docs); setPresets(r.personalities); } }, (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [bot.id]);
  const run = async (fn: () => Promise<{ docs: Doc[] }>) => {
    setBusy(true); setError(null);
    try { const r = await fn(); setDocs(r.docs); setEditing(null); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const open = (d: Doc | null) => { setEditing(d ? d.id : "new"); setDraft({ title: d?.title ?? "", body: d?.body ?? "" }); };
  const save = () => run(() => editing === "new"
    ? api("POST", `/bots/${enc(bot.id)}/identity`, draft)
    : api("PUT", `/bots/${enc(bot.id)}/identity/${enc(String(editing))}`, draft));
  const current = docs?.find((d) => d.personality)?.personality ?? "";
  const editor = (
    <div className="care-editor">
      <label className="care-label">{t("care.id.docTitle")}<input className="input" value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="care-label">{t("care.id.docBody")}<textarea className="input" rows={5} value={draft.body} maxLength={4000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
      <div className="care-row">
        <button type="button" className="btn btn-small btn-primary" disabled={busy || !draft.title.trim() || !draft.body.trim()} onClick={() => void save()}>{t("care.save")}</button>
        <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => setEditing(null)}>{t("care.cancel")}</button>
      </div>
    </div>
  );
  return (
    <section className="care-block" aria-labelledby={`identity-${bot.id}`}>
      <p className="action-title" id={`identity-${bot.id}`}>{t("care.id.title")}</p>
      <p className="muted small">{t("care.id.hint", { name: bot.name })}</p>
      <p className="care-sub">{t("care.id.personalities")}</p>
      <div className="chips care-chips" role="group" aria-label={t("care.id.personalities")}>
        {presets.map((p) => (
          <button key={p.id} type="button" className={`chip${current === p.id ? " is-on" : ""}`} aria-pressed={current === p.id} title={p.text} disabled={busy || !docs} onClick={() => void run(() => api("POST", `/bots/${enc(bot.id)}/identity/personality`, { personality: p.id }))}>{p.name}</button>
        ))}
      </div>
      {docs && docs.length === 0 && editing !== "new" && <p className="muted small">{t("care.id.empty")}</p>}
      <ul className="care-docs">
        {docs?.map((d) => (
          <li key={d.id} className="care-doc">
            {editing === d.id ? editor : (
              <>
                <div className="care-doc-head">
                  <strong className="care-doc-title">{d.title}</strong>
                  <span className="care-row">
                    <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => open(d)}>{t("care.edit")}</button>
                    <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void run(() => api("DELETE", `/bots/${enc(bot.id)}/identity/${enc(d.id)}`))}>{t("care.remove")}</button>
                  </span>
                </div>
                <p className="care-doc-body">{d.body}</p>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing === "new" ? editor : docs && docs.length < 8 && <button type="button" className="btn btn-small" disabled={busy} onClick={() => open(null)}>{t("care.id.add")}</button>}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

/* ---------- Mise de côté ---------- */

interface Aside { aside: boolean; asideAt: number | null; lastUse: number; never: boolean; eligible: boolean; days: number }

export function BotAsideField({ bot }: { bot: Bot }) {
  const t = useT();
  const [v, setV] = useState<Aside | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<Aside>("GET", `/bots/${enc(bot.id)}/aside`).then((r) => !dead && setV(r), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [bot.id, bot.listHidden]);
  if (!v) return error ? <ErrorNote>{error}</ErrorNote> : null;
  const put = async (b: { never?: boolean; back?: boolean }) => { setError(null); try { setV(await api<Aside>("PUT", `/bots/${enc(bot.id)}/aside`, b)); } catch (e) { setError(errText(e)); } };
  const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "long" });
  return (
    <section className="care-block">
      <p className="action-title">{t("care.aside.title")}</p>
      {!v.eligible ? <p className="muted small">{t("care.aside.never")}</p> : (
        <>
          <p className="muted small">{t("care.aside.hint", { n: v.days, name: bot.name })}</p>
          {v.aside && v.asideAt && (
            <div className="care-row care-aside-on">
              <span className="small">{t("care.aside.since", { date: date(v.asideAt) })}</span>
              <button type="button" className="btn btn-small" onClick={() => void put({ back: true })}>{t("care.aside.back")}</button>
            </div>
          )}
          <div className="care-row"><Toggle checked={v.never} onChange={(n) => void put({ never: n })} label={t("care.aside.keep")} /><span className="small" aria-hidden="true">{t("care.aside.keep")}</span></div>
          <p className="muted small">{t("care.aside.last", { date: date(v.lastUse) })}</p>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

/* ---------- Ce que ce bot peut lire et écrire ---------- */

interface Family { group: string; reads: string[]; acts: string[]; asks: string[] }
interface Reach { autonomy: string; families: Family[]; off: string[]; apps: { name: string; status: string; reads: number; writes: number }[] }

export function BotReachCard({ bot, open: startOpen = false }: { bot: Bot; open?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(startOpen);
  const [card, setCard] = useState<Reach | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || card) return;
    api<Reach>("GET", `/bots/${enc(bot.id)}/read-write`).then(setCard, (e) => setError(errText(e)));
  }, [open, card, bot.id]);
  useEffect(() => { setCard(null); }, [bot.id, bot.disabledTools?.join(",")]);
  const label = (g: string) => (g === "general" ? t("care.reach.general") : t(`tools.${g}.label` as never));
  const list = (names: string[]) => <span className="care-tools">{names.join(", ")}</span>;
  return (
    <section className="care-block care-reach">
      <button type="button" className="care-disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="action-title">{t("care.reach.title")}</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && !card && !error && <p className="muted small">{t("care.loading")}</p>}
      {open && card && (
        <div className="care-reach-body">
          <p className="muted small">{t("care.reach.hint")}</p>
          <ul className="care-fams">
            {card.families.map((f) => (
              <li key={f.group} className="care-fam">
                <strong>{label(f.group)}</strong>
                {f.reads.length > 0 && <p className="small"><span className="care-tag is-read">{t("care.reach.reads")}</span> {list(f.reads)}</p>}
                {f.acts.length > 0 && <p className="small"><span className="care-tag is-act">{t("care.reach.acts")}</span> {list(f.acts)}</p>}
                {f.asks.length > 0 && <p className="small"><span className="care-tag is-ask">{t("care.reach.asks")}</span> {list(f.asks)}</p>}
              </li>
            ))}
          </ul>
          <p className="small"><strong>{t("care.reach.apps")}</strong> {card.apps.length ? card.apps.map((a) => t("care.reach.app", { name: a.name, reads: a.reads, writes: a.writes })).join(" · ") : t("care.reach.noApps")}</p>
          {card.off.length > 0 && <p className="small"><strong>{t("care.reach.off")}</strong> {card.off.map(label).join(", ")}</p>}
          <p className="muted small">{t("care.reach.foot")}</p>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}
