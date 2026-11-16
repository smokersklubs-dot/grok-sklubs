import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { tn, useT } from "../i18n";
import { fileSize } from "../lib/format";
import { useStore } from "../store";
import type { ApiProvider, ApiProviderModel, Card, FileChange } from "../types";
import { Icon } from "./Icon";
import { ErrorNote, IconButton, Loading } from "./ui";

/* ---------- A secret pasted in a message: masked, then saved to the vault or forgotten ---------- */

type PastedSecretCard = Extract<Card, { type: "pastedsecret" }>;

export function PastedSecretCardView({ card, botId, seq }: { card: PastedSecretCard; botId: string; seq: number }) {
  const t = useT();
  const own = useStore((s) => !s.bots[botId]?.access);
  const [name, setName] = useState(card.name);
  const [host, setHost] = useState(card.host);
  const [busy, setBusy] = useState<"save" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expired = card.status === "pending" && card.expiresAt < Date.now();
  const run = async (action: "save" | "discard") => {
    setBusy(action);
    setError(null);
    try { await api("POST", `/bots/${enc(botId)}/cards/${seq}/pasted-secret`, action === "save" ? { action, name, host } : { action }); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(null); }
  };
  const what = t(`pasted.kind.${card.kind}`);
  return (
    <div className="card secret-card pasted-card">
      <div className="card-head">
        <span className="logo-tile is-vault" aria-hidden="true"><Icon name="lock" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("pasted.title", { what })}</p>
          <p className="card-sub">{card.hint ? t("pasted.subHint", { hint: card.hint, n: card.length }) : t("pasted.sub", { n: card.length })}</p>
        </div>
      </div>
      {card.status === "pending" && !expired && own ? (
        <form className="secret-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (name.trim() && host.trim()) void run("save"); }}>
          <p className="card-note secret-note"><Icon name="shield" size={13} /> <span>{t("pasted.note")}</span></p>
          <div className="pasted-fields">
            <label className="secret-host">
              <span>{t("pasted.name")}</span>
              <input className="input input-small" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("pasted.namePlaceholder")} spellCheck={false} />
            </label>
            <label className="secret-host">
              <span>{t("secret.host")}</span>
              <input className="input input-small" value={host} onChange={(e) => setHost(e.target.value)} placeholder="api.example.com" spellCheck={false} autoCapitalize="off" />
            </label>
          </div>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void run("discard")}>{t(busy === "discard" ? "common.working" : "pasted.discard")}</button>
            <span className="spacer" />
            <button type="submit" className="btn btn-accent" disabled={busy !== null || !name.trim() || !host.trim()}>{t(busy === "save" ? "common.saving" : "secret.save")}</button>
          </div>
        </form>
      ) : card.status === "pending" && !expired ? (
        <p className="card-note secret-note"><Icon name="shield" size={13} /> <span>{t("pasted.note")}</span></p>
      ) : (
        <p className={`card-outcome is-${card.status === "saved" ? "allowed" : "denied"}`}>
          <Icon name={card.status === "saved" ? "check" : "close"} size={14} />
          {card.status === "saved" ? t("pasted.saved", { name: card.name, host: card.host }) : card.status === "discarded" ? t("pasted.discarded") : t("pasted.expired")}
        </p>
      )}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

/* ---------- "Fichiers modifiés": what a turn changed in the bot's home folder, with undo ---------- */

type FilesCard = Extract<Card, { type: "files" }>;

function changeLabel(f: FileChange, t: ReturnType<typeof useT>): string {
  if (f.binary || f.added === null) {
    if (f.change === "added") return t("files.binaryAdded", { size: fileSize(f.newSize ?? 0) });
    if (f.change === "deleted") return t("files.binaryDeleted", { size: fileSize(f.oldSize ?? 0) });
    return t("files.binaryChanged", { from: fileSize(f.oldSize ?? 0), to: fileSize(f.newSize ?? 0) });
  }
  return "";
}

function FileDiff({ botId, seq, path }: { botId: string; seq: number; path: string }) {
  const t = useT();
  const [state, setState] = useState<{ diff: string; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<{ diff: string; truncated: boolean }>("GET", `/bots/${enc(botId)}/cards/${seq}/files/diff?path=${enc(path)}`).then((r) => !dead && setState(r), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [botId, seq, path]);
  if (error) return <p className="card-error" role="alert">{error}</p>;
  if (!state) return <Loading />;
  const lines = state.diff.replace(/\n+$/, "").split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l));
  return (
    <div className="file-diff">
      <pre>{lines.map((l, i) => <span key={i} className={l.startsWith("+") ? "is-add" : l.startsWith("-") ? "is-del" : l.startsWith("@@") ? "is-hunk" : ""}>{l || " "}{"\n"}</span>)}</pre>
      {state.truncated && <p className="muted small">{t("files.truncated")}</p>}
    </div>
  );
}

export function FilesCardView({ card, botId, seq }: { card: FilesCard; botId: string; seq: number }) {
  const t = useT();
  const own = useStore((s) => !s.bots[botId]?.access);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = card.files.length + card.more;
  const undo = async () => {
    setBusy(true);
    setError(null);
    try { await api("POST", `/bots/${enc(botId)}/cards/${seq}/files`, { action: "undo", confirm: true }); setConfirming(false); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="card files-card">
      <div className="card-head">
        <span className="logo-tile is-files" aria-hidden="true"><Icon name="file" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("files.title")}</p>
          <p className="card-sub">{tn("files.sub", total)}</p>
        </div>
      </div>
      <ul className="files-list">
        {card.files.map((f) => {
          const text = !f.binary && f.added !== null;
          const expanded = open === f.path;
          return (
            <li key={f.path} className={`files-row is-${f.change}`}>
              <button type="button" className="files-row-head" disabled={!text} aria-expanded={text ? expanded : undefined} onClick={() => setOpen(expanded ? null : f.path)}
                title={text ? t(expanded ? "files.hideDiff" : "files.showDiff") : undefined}>
                <span className={`files-badge is-${f.change}`}>{t(`files.change.${f.change}`)}</span>
                <code className="truncate">~/{f.path}</code>
                <span className="spacer" />
                {text ? (
                  <span className="files-counts"><span className="is-add">+{f.added}</span> <span className="is-del">−{f.removed}</span></span>
                ) : <span className="muted small files-size">{changeLabel(f, t)}</span>}
                {text && <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} />}
              </button>
              {expanded && <FileDiff botId={botId} seq={seq} path={f.path} />}
            </li>
          );
        })}
      </ul>
      {card.more > 0 && <p className="muted small">{t("files.more", { n: card.more })}</p>}
      {card.status === "available" && own && (
        <>
          {confirming && <p className="card-note secret-note"><Icon name="alert" size={13} /> <span>{t("files.confirmNote")}</span></p>}
          <div className="card-actions">
            {confirming && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>{t("common.cancel")}</button>}
            <span className="spacer" />
            {confirming ? (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void undo()}>{busy ? t("common.working") : tn("files.confirm", card.files.length)}</button>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirming(true)}><Icon name="history" size={14} /> {t("files.undo")}</button>
            )}
          </div>
        </>
      )}
      {card.status === "undone" && <p className="card-outcome is-allowed"><Icon name="check" size={14} /> {tn("files.undone", card.restored?.length ?? 0)}</p>}
      {!!card.changedSince?.length && <p className="card-note secret-note"><Icon name="alert" size={13} /> <span>{t("files.changedSince", { list: card.changedSince.map((p) => `~/${p}`).join(", ") })}</span></p>}
      {card.status === "expired" && <p className="card-outcome is-denied"><Icon name="close" size={14} /> {t("files.expired")}</p>}
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

/* ---------- Settings → Models: the user's own API providers (DeepSeek preset) ---------- */

interface Presets { deepseek: { name: string; baseUrl: string; images: boolean; models: ApiProviderModel[] } }
interface Draft { id: string | null; name: string; baseUrl: string; key: string; hasKey: boolean; models: ApiProviderModel[]; images: boolean; preset: string }

const blankModel = (id = ""): ApiProviderModel => ({ id, contextWindow: null, input: null, output: null, cached: null });
const num = (v: string): number | null => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function ProviderForm({ start, onDone, onCancel }: { start: Draft; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [d, setD] = useState<Draft>(start);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<Draft>) => { setD((x) => ({ ...x, ...patch })); setCheck(null); };
  const setModel = (i: number, patch: Partial<ApiProviderModel>) => set({ models: d.models.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const keyBody = () => (d.key.trim() ? { key: d.key.trim() } : {});
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const test = () => run("test", async () => {
    const r = await api<{ ok: boolean; detail: string }>("POST", "/api-providers/test", { id: d.id, baseUrl: d.baseUrl, model: d.models[0]?.id, ...keyBody() });
    setCheck({ ok: r.ok, text: r.ok ? t("providers.testOk") : r.detail });
  });
  const fetchList = () => run("models", async () => {
    const r = await api<{ ok: boolean; models?: ApiProviderModel[]; error?: string }>("POST", "/api-providers/models", { id: d.id, baseUrl: d.baseUrl, ...keyBody() });
    if (!r.ok || !r.models) { setCheck({ ok: false, text: r.error ?? t("providers.noList") }); return; }
    // Prices and context windows already typed (or from the preset) are kept for models still listed.
    const known = new Map(d.models.map((m) => [m.id, m]));
    setD((x) => ({ ...x, models: r.models!.map((m) => ({ ...m, ...(known.get(m.id) ?? {}), contextWindow: known.get(m.id)?.contextWindow ?? m.contextWindow })) }));
    setCheck({ ok: true, text: t("providers.listed", { n: r.models.length }) });
  });
  const save = () => run("save", async () => {
    const payload = { name: d.name, baseUrl: d.baseUrl, models: d.models.filter((m) => m.id.trim()), images: d.images, ...keyBody(), ...(d.id ? {} : { preset: d.preset || undefined }) };
    if (d.id) await api("PATCH", `/api-providers/${enc(d.id)}`, payload); else await api("POST", "/api-providers", payload);
    onDone();
  });
  return (
    <form className="provider-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="field-row">
        <label className="field">
          <span className="field-label">{t("providers.name")}</span>
          <input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} required />
        </label>
        <label className="field">
          <span className="field-label">{t("providers.baseUrl")}</span>
          <input className="input" value={d.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" spellCheck={false} autoCapitalize="off" required />
        </label>
      </div>
      <label className="field">
        <span className="field-label">{t("providers.key")}</span>
        <input className="input" type="password" value={d.key} onChange={(e) => set({ key: e.target.value })} placeholder={d.hasKey ? t("providers.keySaved") : t("providers.keyPlaceholder")}
          autoComplete="off" spellCheck={false} data-1p-ignore="" data-lpignore="true" />
        <span className="field-hint">{t("providers.keyHint")}</span>
      </label>
      <div className="provider-actions">
        <button type="button" className="btn btn-small" disabled={busy !== null || !d.baseUrl.trim() || (!d.key.trim() && !d.hasKey)} onClick={() => void test()}>{t(busy === "test" ? "common.working" : "providers.test")}</button>
        <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null || !d.baseUrl.trim() || (!d.key.trim() && !d.hasKey)} onClick={() => void fetchList()}><Icon name="refresh" size={14} /> {t("providers.fetch")}</button>
        {check && <span className={`provider-check ${check.ok ? "is-ok" : "is-bad"}`} role="status"><Icon name={check.ok ? "check" : "alert"} size={14} /> {check.text}</span>}
      </div>
      <div className="field">
        <span className="field-label">{t("providers.models")}</span>
        <span className="field-hint">{t("providers.modelsHint")}</span>
        <div className="provider-models">
          <div className="provider-model is-head" aria-hidden="true">
            <span>{t("providers.model")}</span><span>{t("providers.context")}</span><span>{t("providers.input")}</span><span>{t("providers.output")}</span><span>{t("providers.cached")}</span><span />
          </div>
          {d.models.map((m, i) => (
            <div key={i} className="provider-model">
              <input className="input input-small" value={m.id} onChange={(e) => setModel(i, { id: e.target.value.trim() })} aria-label={t("providers.model")} spellCheck={false} />
              <input className="input input-small" inputMode="numeric" value={m.contextWindow ?? ""} onChange={(e) => setModel(i, { contextWindow: num(e.target.value) })} aria-label={t("providers.context")} />
              <input className="input input-small" inputMode="decimal" value={m.input ?? ""} onChange={(e) => setModel(i, { input: num(e.target.value) })} aria-label={t("providers.input")} />
              <input className="input input-small" inputMode="decimal" value={m.output ?? ""} onChange={(e) => setModel(i, { output: num(e.target.value) })} aria-label={t("providers.output")} />
              <input className="input input-small" inputMode="decimal" value={m.cached ?? ""} onChange={(e) => setModel(i, { cached: num(e.target.value) })} aria-label={t("providers.cached")} />
              <IconButton icon="close" size={14} label={t("providers.removeModel", { model: m.id || "?" })} onClick={() => set({ models: d.models.filter((_, j) => j !== i) })} />
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-small btn-ghost provider-add-model" onClick={() => set({ models: [...d.models, blankModel()] })}><Icon name="plus" size={14} /> {t("providers.addModel")}</button>
        {d.preset === "deepseek" && <span className="field-hint">{t("providers.deepseekPrices")}</span>}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={d.images} onChange={(e) => set({ images: e.target.checked })} />
        <span>{t("providers.images")}</span>
      </label>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="card-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t("common.cancel")}</button>
        <span className="spacer" />
        <button type="submit" className="btn btn-accent" disabled={busy !== null || !d.name.trim() || !d.baseUrl.trim()}>{t(busy === "save" ? "common.saving" : "common.save")}</button>
      </div>
    </form>
  );
}

export function ApiProvidersSection({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const [state, setState] = useState<{ providers: ApiProvider[]; presets: Presets } | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const load = () => api<{ providers: ApiProvider[]; presets: Presets }>("GET", "/api-providers").then(setState, (e) => setError(errText(e)));
  useEffect(() => { void load(); }, []);
  const done = () => { setEditing(null); void load(); onChanged(); };
  const remove = async (p: ApiProvider) => {
    if (confirmDel !== p.id) { setConfirmDel(p.id); return; }
    try { await api("DELETE", `/api-providers/${enc(p.id)}`); setConfirmDel(null); done(); } catch (e) { setError(errText(e)); }
  };
  if (!state) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  const ds = state.presets.deepseek;
  return (
    <>
      <h3 className="pane-heading">{t("providers.heading")}</h3>
      <p className="muted small">{t("providers.intro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {state.providers.length > 0 && (
        <ul className="list provider-list">
          {state.providers.map((p) => (
            <li key={p.id} className="list-row is-card">
              <Icon name="brain" size={16} />
              <span className="list-row-text">
                <span className="list-row-title">{p.name}</span>
                <span className="list-row-sub">{p.baseUrl} · {p.models.map((m) => m.id).join(", ") || t("providers.noModels")}{p.hasKey ? "" : ` · ${t("providers.noKey")}`}</span>
              </span>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing({ id: p.id, name: p.name, baseUrl: p.baseUrl, key: "", hasKey: p.hasKey, models: p.models, images: p.images, preset: p.preset ?? "" })}>{t("providers.edit")}</button>
              <button type="button" className={`btn btn-small ${confirmDel === p.id ? "btn-danger" : "btn-ghost"}`} onClick={() => void remove(p)}>{t(confirmDel === p.id ? "common.confirmDelete" : "common.delete")}</button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ProviderForm start={editing} onDone={done} onCancel={() => setEditing(null)} />
      ) : (
        <div className="provider-actions">
          <button type="button" className="btn btn-small" onClick={() => setEditing({ id: null, name: ds.name, baseUrl: ds.baseUrl, key: "", hasKey: false, models: ds.models, images: ds.images, preset: "deepseek" })}>
            <Icon name="plus" size={14} /> {t("providers.addDeepseek")}
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setEditing({ id: null, name: "", baseUrl: "", key: "", hasKey: false, models: [blankModel()], images: true, preset: "" })}>
            <Icon name="plus" size={14} /> {t("providers.addOther")}
          </button>
        </div>
      )}
    </>
  );
}
