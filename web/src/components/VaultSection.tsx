import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, ApiError, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { VaultImportResult, VaultItem, VaultKind } from "../types";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton, Empty, ErrorNote, IconButton, Loading, Menu, MenuItem } from "./ui";
import { CardVaultEditor, cardSub, PaymentsList } from "./Wave5b";
import { HealthBadge, useHealth } from "./Wave7";

const KIND_ICON: Record<VaultKind, IconName> = { login: "key", secret: "lock", totp: "clock", card: "bolt" };

interface VaultForm { name: string; site: string; username: string; password: string; note: string; hosts: string; header: string; prefix: string; checkUrl: string }
const EMPTY: VaultForm = { name: "", site: "", username: "", password: "", note: "", hosts: "", header: "Authorization", prefix: "Bearer ", checkUrl: "" };

/** Add or edit one vault item. The value field always starts empty: the server never sends a value back. */
function VaultEditor({ item, kind, onSaved, onCancel }: { item: VaultItem | null; kind: VaultKind; onSaved: (item: VaultItem) => void; onCancel: () => void }) {
  const t = useT();
  const [form, setForm] = useState<VaultForm>(
    item ? { name: item.name, site: item.site, username: item.username, password: "", note: item.note, hosts: item.hosts.join(", "), header: item.header || "Authorization", prefix: item.prefix, checkUrl: item.checkUrl ?? "" } : EMPTY,
  );
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Wave 7: the provider refused the key at save time; the user may save it anyway. */
  const [refused, setRefused] = useState(false);
  const uid = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const set = <K extends keyof VaultForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valueLabel = t(kind === "secret" ? "vault.secretValue" : kind === "totp" ? "vault.totpValue" : "vault.password");

  const submit = async (e: FormEvent | null, force = false) => {
    e?.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    // An empty value is left out, so editing keeps the one already saved.
    const body: Record<string, unknown> = { kind, name: form.name.trim(), note: form.note.trim(), ...(form.password ? { password: form.password } : {}) };
    if (kind === "login") Object.assign(body, { site: form.site.trim(), username: form.username.trim() });
    if (kind === "totp") Object.assign(body, { site: form.site.trim() });
    if (kind === "secret") Object.assign(body, { hosts: form.hosts, header: form.header.trim(), prefix: form.prefix, checkUrl: form.checkUrl.trim() }, force ? { force: true } : {});
    try {
      const r = item ? await api<{ item: VaultItem }>("PATCH", `/vault/${enc(item.id)}`, body) : await api<{ item: VaultItem }>("POST", "/vault", body);
      useHealth.getState().load();
      onSaved(r.item);
    } catch (err) {
      setRefused(err instanceof ApiError && err.status === 422);
      setError(err instanceof ApiError && err.status === 422 ? t("health.refusedOnSave") : errText(err));
      setBusy(false);
    }
  };

  return (
    <form className="editor" onSubmit={submit} autoComplete="off" aria-label={t(item ? "vault.editTitle" : `vault.new.${kind}`)}>
      <p className="editor-kind"><Icon name={KIND_ICON[kind]} size={15} /> {t(`vault.kind.${kind}`)}</p>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}n`}>{t("common.name")}</label>
        <input ref={first} id={`${uid}n`} className="input" value={form.name} maxLength={80} required onChange={(e) => set("name", e.target.value)} placeholder={t(kind === "secret" ? "vault.secretNamePlaceholder" : "vault.namePlaceholder")} autoComplete="off" />
      </div>
      {kind === "login" && (
        <div className="form-cols is-even">
          <div className="field">
            <label className="field-label" htmlFor={`${uid}s`}>{t("vault.site")} <span className="muted">{t("common.optional")}</span></label>
            <input id={`${uid}s`} className="input" value={form.site} maxLength={300} onChange={(e) => set("site", e.target.value)} placeholder={t("vault.sitePlaceholder")} autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="url" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}u`}>{t("vault.username")} <span className="muted">{t("common.optional")}</span></label>
            <input id={`${uid}u`} className="input" value={form.username} maxLength={200} onChange={(e) => set("username", e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
          </div>
        </div>
      )}
      {kind === "totp" && (
        <div className="field">
          <label className="field-label" htmlFor={`${uid}s`}>{t("vault.site")}</label>
          <input id={`${uid}s`} className="input" value={form.site} maxLength={300} required onChange={(e) => set("site", e.target.value)} placeholder={t("vault.sitePlaceholder")} autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="url" />
          <p className="field-hint">{t("vault.totpSiteHint")}</p>
        </div>
      )}
      {kind === "secret" && (
        <>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}h`}>{t("vault.hosts")}</label>
            <input id={`${uid}h`} className="input" value={form.hosts} maxLength={500} required onChange={(e) => set("hosts", e.target.value)} placeholder="api.example.com" autoComplete="off" autoCapitalize="off" spellCheck={false} />
            <p className="field-hint">{t("vault.hostsHint")}</p>
          </div>
          <div className="form-cols is-even">
            <div className="field">
              <label className="field-label" htmlFor={`${uid}x`}>{t("vault.header")}</label>
              <input id={`${uid}x`} className="input" value={form.header} maxLength={64} onChange={(e) => set("header", e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${uid}f`}>{t("vault.prefix")} <span className="muted">{t("common.optional")}</span></label>
              <input id={`${uid}f`} className="input" value={form.prefix} maxLength={40} onChange={(e) => set("prefix", e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${uid}c`}>{t("health.checkUrl")} <span className="muted">{t("common.optional")}</span></label>
            <input id={`${uid}c`} className="input" value={form.checkUrl} maxLength={500} onChange={(e) => set("checkUrl", e.target.value)} placeholder="https://api.example.com/v1/me" autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="url" />
            <p className="field-hint">{t("health.checkUrlHint")}</p>
          </div>
        </>
      )}
      <div className="field">
        <label className="field-label" htmlFor={`${uid}p`}>{valueLabel}{!item && kind === "login" && <> <span className="muted">{t("common.optional")}</span></>}</label>
        <div className="input-affix">
          <input id={`${uid}p`} className="input" type={reveal ? "text" : "password"} value={form.password} maxLength={8000} required={!item && kind !== "login"} onChange={(e) => set("password", e.target.value)} placeholder={kind === "totp" ? "otpauth://totp/… / JBSWY3DP…" : undefined} autoComplete="off" autoCapitalize="off" spellCheck={false} data-1p-ignore="" data-lpignore="true" />
          <IconButton icon={reveal ? "eyeOff" : "eye"} size={16} label={t(reveal ? "vault.hide" : "vault.show")} active={reveal} onClick={() => setReveal((v) => !v)} />
        </div>
        <p className="field-hint">{item?.hasPassword ? t("vault.passwordKeep") : t(kind === "totp" ? "vault.totpHint" : "vault.passwordNever")}</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${uid}o`}>{t("vault.note")} <span className="muted">{t("common.optional")}</span></label>
        <textarea id={`${uid}o`} className="input" rows={2} value={form.note} maxLength={500} onChange={(e) => set("note", e.target.value)} placeholder={t("vault.notePlaceholder")} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>{t("common.cancel")}</button>
        {refused && <button type="button" className="btn btn-small" disabled={busy} onClick={() => void submit(null, true)}>{t("health.saveAnyway")}</button>}
        <button type="submit" className="btn btn-primary btn-small" disabled={!form.name.trim() || busy}>{t(busy ? "common.saving" : item ? "common.save" : "vault.saveNew")}</button>
      </div>
    </form>
  );
}

const FIELDS = ["name", "url", "username", "password", "note", "totp"] as const;

/** CSV import: the file is read here and sent once; unrecognised columns are mapped by hand from their names. */
function VaultImport({ onDone, onCancel }: { onDone: (r: VaultImportResult) => void; onCancel: () => void }) {
  const t = useT();
  const [csv, setCsv] = useState<string | null>(null);
  const [file, setFile] = useState("");
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();

  const send = async (text: string, map?: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<VaultImportResult>("POST", "/vault/import", { csv: text, ...(map ? { mapping: Object.fromEntries(Object.entries(map).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])) } : {}) });
      if (r.needsMapping) setHeaders(r.headers ?? []);
      else onDone(r);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="editor vault-import" role="group" aria-label={t("vault.importTitle")}>
      <p className="editor-kind"><Icon name="upload" size={15} /> {t("vault.importTitle")}</p>
      <p className="muted small">{t("vault.importHint")}</p>
      <label className="btn btn-small file-pick" htmlFor={`${uid}f`}>
        <Icon name="file" size={14} /> {file || t("vault.importPick")}
      </label>
      <input
        id={`${uid}f`}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setFile(f.name);
          setHeaders(null);
          void f.text().then((text) => {
            setCsv(text);
            void send(text);
          });
        }}
      />
      {headers && csv && (
        <div className="import-map">
          <p className="small">{t("vault.importMap")}</p>
          {FIELDS.map((f) => (
            <label key={f} className="import-map-row">
              <span>{t(`vault.col.${f}`)}</span>
              <select className="input input-small" value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}>
                <option value="">{t("vault.colNone")}</option>
                {headers.map((h, i) => <option key={i} value={String(i)}>{h || `#${i + 1}`}</option>)}
              </select>
            </label>
          ))}
          <div className="row-end">
            <button type="button" className="btn btn-primary btn-small" disabled={busy || !mapping.password} onClick={() => void send(csv, mapping)}>{t(busy ? "common.working" : "vault.importGo")}</button>
          </div>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}

export function VaultSection() {
  const t = useT();
  const tick = useStore((s) => s.vaultTick);
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | { kind: VaultKind } | "import" | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    let dead = false;
    api<{ items: VaultItem[] }>("GET", "/vault").then(
      (r) => !dead && setItems(Array.isArray(r?.items) ? r.items : []),
      (e: unknown) => {
        if (dead) return;
        setError(errText(e));
        setItems((cur) => cur ?? []);
      },
    );
    return () => {
      dead = true;
    };
  }, [tick]);

  const saved = (item: VaultItem) => {
    setItems((cur) => {
      const list = cur ?? [];
      return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item].sort((a, b) => a.name.localeCompare(b.name));
    });
    setEditing(null);
  };
  const remove = async (item: VaultItem) => {
    setError(null);
    try {
      await api("DELETE", `/vault/${enc(item.id)}`);
      setItems((cur) => cur?.filter((x) => x.id !== item.id) ?? null);
    } catch (e) {
      setError(errText(e));
    }
  };
  const subOf = (item: VaultItem) =>
    item.kind === "card" ? cardSub(item, t) : item.kind === "secret"
      ? t("vault.secretSub", { hosts: item.hosts.join(", "), header: item.header })
      : item.kind === "totp"
        ? t("vault.totpSub", { site: item.site, digits: item.digits, period: item.period })
        : [item.site, item.username].filter(Boolean).join(" · ");

  return (
    <>
      <h2>{t("settings.section.vault")}</h2>
      <div className="pane-intro">
        <p className="muted">{t("vault.intro")} {t("vault.introMore")}</p>
        {editing === null && items && (
          <div className="menu-wrap">
            <button type="button" className="btn btn-small" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}>
              <Icon name="plus" size={14} /> {t("vault.addAny")}
            </button>
            <Menu open={menu} onClose={() => setMenu(false)} align="right" label={t("vault.addAny")}>
              {(["login", "secret", "totp", "card"] as const).map((k) => (
                <MenuItem key={k} icon={KIND_ICON[k]} onClick={() => { setMenu(false); setEditing({ kind: k }); }}>{t(`vault.new.${k}`)}</MenuItem>
              ))}
              <div className="menu-sep" />
              <MenuItem icon="upload" onClick={() => { setMenu(false); setEditing("import"); }}>{t("vault.importTitle")}</MenuItem>
            </Menu>
          </div>
        )}
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {editing && typeof editing === "object" && (editing.kind === "card" ? <CardVaultEditor item={null} onSaved={saved} onCancel={() => setEditing(null)} /> : <VaultEditor item={null} kind={editing.kind} onSaved={saved} onCancel={() => setEditing(null)} />)}
      {editing === "import" && (
        <VaultImport
          onCancel={() => setEditing(null)}
          onDone={(r) => {
            setEditing(null);
            useStore.getState().showToast(t("vault.imported", { n: r.imported, skipped: r.skipped, totp: r.totp }));
            useStore.setState((s) => ({ vaultTick: s.vaultTick + 1 }));
          }}
        />
      )}
      {!items && <Loading />}
      {items && items.length === 0 && editing === null && <Empty icon="key" title={t("vault.emptyTitle")}>{t("vault.emptyText")}</Empty>}
      {items && items.length > 0 && (
        <ul className="list">
          {items.map((item) =>
            editing === item.id ? (
              <li key={item.id}>
                {item.kind === "card" ? <CardVaultEditor item={item} onSaved={saved} onCancel={() => setEditing(null)} /> : <VaultEditor item={item} kind={item.kind} onSaved={saved} onCancel={() => setEditing(null)} />}
              </li>
            ) : (
              <li key={item.id} className="list-row is-card vault-row">
                <span className={`logo-tile is-vault is-${item.kind}`} aria-hidden="true">
                  <Icon name={KIND_ICON[item.kind]} size={17} />
                </span>
                <div className="list-row-text">
                  <span className="list-row-title">
                    {item.name}
                    <span className="chip">{t(`vault.kind.${item.kind}`)}</span>
                    {item.kind === "login" && <span className={`chip ${item.hasPassword ? "state-ready" : ""}`}>{t(item.hasPassword ? "vault.hasPassword" : "vault.noPassword")}</span>}
                    {item.kind === "secret" && <HealthBadge kind="vault" id={item.id} />}
                  </span>
                  {subOf(item) && <span className="list-row-sub">{subOf(item)}</span>}
                  {item.note && <span className="list-row-sub">{item.note}</span>}
                </div>
                <IconButton icon="edit" size={16} label={t("vault.edit", { name: item.name })} onClick={() => setEditing(item.id)} />
                <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("common.delete")} confirmLabel={t("common.confirmDelete")} busyLabel={t("common.deleting")} onConfirm={() => remove(item)} />
              </li>
            ),
          )}
        </ul>
      )}
      <PaymentsList />
    </>
  );
}
