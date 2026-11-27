import { useEffect, useId, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { tn, useT, type Key } from "../i18n";
import { relTime } from "../lib/format";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote, IconButton } from "./ui";
import "./AccessPanels.css";

/**
 * L159 — three small panels:
 *  - ConnectorBots: on each app (Settings → Apps), « pour tous mes bots » with a box per bot to untick, or « seulement
 *    les bots choisis » (server connectorbots.ts).
 *  - ConnectedSites: the verified list of sites where a bot signed in, with « connecté » / « à vérifier » /
 *    « à reconnecter » (server siteregistry.ts).
 *  - ContactCards: « Coordonnées » in the vault, for address forms (server vaultcontacts.ts).
 */

export interface BotAccess { allBots: boolean; bots: Record<string, boolean>; allowed: string[] }

export function ConnectorBots({ connectorId, name, start }: { connectorId: string; name: string; /** Gallery: open with this state, saved locally. */ start?: BotAccess }) {
  const t = useT();
  const all = useStore((s) => s.bots);
  const team = Object.values(all).filter((b) => b.kind === "agent" && !b.access).sort((a, b) => a.name.localeCompare(b.name));
  const [open, setOpen] = useState(!!start);
  const [access, setAccess] = useState<BotAccess | null>(start ?? null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    if (!open || access) return;
    api<BotAccess>("GET", `/connectors/${enc(connectorId)}/bots`).then(setAccess, (e) => setError(errText(e)));
  }, [open, access, connectorId]);
  const save = async (allBots: boolean, allowed: Set<string>) => {
    setError(null);
    const bots: Record<string, boolean> = {};
    for (const b of team) bots[b.id] = allowed.has(b.id);
    if (start) { setAccess({ allBots, bots, allowed: [...allowed] }); return; }
    try { setAccess(await api<BotAccess>("PUT", `/connectors/${enc(connectorId)}/bots`, { allBots, bots })); } catch (e) { setError(errText(e)); }
  };
  const allowed = new Set(access?.allowed ?? []);
  const summary = access ? (access.allBots && allowed.size === team.length ? t("appBots.summaryAll") : t("appBots.summarySome", { n: allowed.size, total: team.length })) : t("appBots.title");
  return (
    <div className="app-bots">
      <button type="button" className="connector-tools" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <Icon name="chevronRight" size={13} className={open ? "is-rotated" : ""} /> {summary}
      </button>
      {open && (
        <div id={id} className="app-bots-body">
          {access === null && !error && <p className="field-hint">{t("common.loading")}</p>}
          {access && (
            <fieldset className="app-bots-set">
              <legend className="sr-only">{t("appBots.legend", { name })}</legend>
              <label className="radio-row"><input type="radio" name={`${id}-scope`} checked={access.allBots} onChange={() => void save(true, new Set(team.map((b) => b.id)))} /> {t("appBots.all")}</label>
              <label className="radio-row"><input type="radio" name={`${id}-scope`} checked={!access.allBots} onChange={() => void save(false, allowed)} /> {t("appBots.chosen")}</label>
              <p className="field-hint">{t(access.allBots ? "appBots.allHint" : "appBots.chosenHint")}</p>
              <div className="app-bots-list">
                {team.map((b) => (
                  <label key={b.id} className="check-row">
                    <input type="checkbox" checked={allowed.has(b.id)} onChange={(e) => { const next = new Set(allowed); if (e.target.checked) next.add(b.id); else next.delete(b.id); void save(access.allBots, next); }} /> {b.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      )}
    </div>
  );
}

interface SiteLogin { botId: string; botName: string; host: string; item: string; status: "checking" | "connected" | "reconnect"; typedAt: number; verifiedAt: number | null; updatedAt: number }
const SITE_TONE: Record<SiteLogin["status"], string> = { connected: "state-ready", checking: "", reconnect: "state-needs_auth" };

export function ConnectedSites({ start }: { /** Gallery: a fixed list, no server call. */ start?: SiteLogin[] }) {
  const t = useT();
  const [sites, setSites] = useState<SiteLogin[] | null>(start ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!start) api<{ sites: SiteLogin[] }>("GET", "/sites").then((r) => setSites(r.sites), () => setSites([])); }, [start]);
  const forget = async (s: SiteLogin) => {
    setError(null);
    try { await api("DELETE", `/sites/${enc(s.botId)}/${enc(s.host)}`); setSites((l) => (l ?? []).filter((x) => x !== s)); } catch (e) { setError(errText(e)); }
  };
  if (!sites?.length) return null;
  return (
    <section className="catalog connected-sites" aria-labelledby="sites-title">
      <div className="catalog-head"><h3 id="sites-title">{t("sites.title")}</h3></div>
      <p className="field-hint">{t("sites.hint")}</p>
      <ul className="connector-list">
        {sites.map((s) => (
          <li key={`${s.botId}:${s.host}`} className="connector">
            <div className="connector-main">
              <span className="logo-tile" aria-hidden="true">{s.host.slice(0, 1).toUpperCase()}</span>
              <div className="list-row-text">
                <span className="list-row-title">{s.host} <span className={`chip ${SITE_TONE[s.status]}`}>{t(`sites.status.${s.status}` as Key)}</span></span>
                <span className="list-row-sub">{t("sites.sub", { bot: s.botName, item: s.item || "—" })} · {s.verifiedAt ? t("sites.verified", { when: relTime(s.verifiedAt) }) : t("sites.notVerified")}</span>
                {s.status === "reconnect" && <span className="list-row-sub">{t("sites.reconnectHint", { bot: s.botName })}</span>}
              </div>
              <IconButton icon="trash" size={15} label={t("sites.forget", { host: s.host })} onClick={() => void forget(s)} />
            </div>
          </li>
        ))}
      </ul>
      {error && <ErrorNote>{error}</ErrorNote>}
    </section>
  );
}

const FIELDS = ["fullName", "company", "address1", "address2", "postalCode", "city", "country", "phone", "email"] as const;
type Field = (typeof FIELDS)[number];
interface Contact { id: string; label: string; fields: Record<Field, string>; bots: string[] }
const AUTOCOMPLETE: Record<Field, string> = { fullName: "name", company: "organization", address1: "address-line1", address2: "address-line2", postalCode: "postal-code", city: "address-level2", country: "country-name", phone: "tel", email: "email" };

function ContactEditor({ contact, onSaved, onCancel }: { contact: Contact | null; onSaved: () => void; onCancel: () => void }) {
  const t = useT();
  const id = useId();
  const [label, setLabel] = useState(contact?.label ?? "");
  const [f, setF] = useState<Record<Field, string>>(() => ({ ...Object.fromEntries(FIELDS.map((k) => [k, ""])), ...(contact?.fields ?? {}) }) as Record<Field, string>);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(contact ? "PUT" : "POST", contact ? `/vault/contacts/${enc(contact.id)}` : "/vault/contacts", { label, ...f, bots: contact?.bots ?? [] });
      onSaved();
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  return (
    <form className="vault-editor contact-editor" onSubmit={submit}>
      <div className="field"><label className="field-label" htmlFor={`${id}-label`}>{t("contacts.label")}</label><input id={`${id}-label`} className="input" value={label} maxLength={60} placeholder={t("contacts.labelPlaceholder")} onChange={(e) => setLabel(e.target.value)} /></div>
      <div className="form-cols">
        {FIELDS.map((k) => (
          <div key={k} className="field">
            <label className="field-label" htmlFor={`${id}-${k}`}>{t(`contacts.field.${k}` as Key)}</label>
            <input id={`${id}-${k}`} className="input" value={f[k]} autoComplete={AUTOCOMPLETE[k]} inputMode={k === "phone" ? "tel" : k === "email" ? "email" : undefined} type={k === "email" ? "email" : "text"} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="row-end">
        <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-small btn-primary" disabled={busy}>{t("common.save")}</button>
      </div>
    </form>
  );
}

export function ContactCards({ start }: { /** Gallery: a fixed list, no server call. */ start?: Contact[] }) {
  const t = useT();
  const [list, setList] = useState<Contact[] | null>(start ?? null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const load = () => api<{ contacts: Contact[] }>("GET", "/vault/contacts").then((r) => setList(r.contacts), () => setList([]));
  useEffect(() => { if (!start) void load(); }, [start]);
  const saved = () => { setEditing(null); void load(); };
  const remove = async (c: Contact) => { await api("DELETE", `/vault/contacts/${enc(c.id)}`); void load(); };
  const line = (c: Contact) => [c.fields.fullName || c.fields.company, [c.fields.postalCode, c.fields.city].filter(Boolean).join(" "), c.fields.country].filter(Boolean).join(" · ");
  return (
    <section className="contact-cards" aria-labelledby="contacts-title">
      <div className="pane-heading-row">
        <h3 id="contacts-title" className="pane-heading">{t("contacts.title")}</h3>
        {editing === null && <button type="button" className="btn btn-small" onClick={() => setEditing("new")}><Icon name="plus" size={13} /> {t("contacts.add")}</button>}
      </div>
      <p className="field-hint">{t("contacts.hint")}</p>
      {editing === "new" && <ContactEditor contact={null} onSaved={saved} onCancel={() => setEditing(null)} />}
      {list && list.length > 0 && (
        <ul className="list">
          {list.map((c) => editing === c.id ? (
            <li key={c.id} className="list-row is-card"><ContactEditor contact={c} onSaved={saved} onCancel={() => setEditing(null)} /></li>
          ) : (
            <li key={c.id} className="list-row is-card">
              <span className="list-row-icon" aria-hidden="true"><Icon name="user" size={16} /></span>
              <div className="list-row-text">
                <span className="list-row-title">{c.label}{c.bots.length > 0 && <span className="chip">{tn("contacts.reserved", c.bots.length)}</span>}</span>
                {line(c) && <span className="list-row-sub">{line(c)}</span>}
              </div>
              <IconButton icon="edit" size={16} label={t("contacts.edit", { name: c.label })} onClick={() => setEditing(c.id)} />
              <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("common.delete")} confirmLabel={t("common.confirmDelete")} busyLabel={t("common.deleting")} onConfirm={() => remove(c)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
