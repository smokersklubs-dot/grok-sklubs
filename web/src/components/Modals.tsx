import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { tn, useT } from "../i18n";
import { sortedBots, useStore } from "../store";
import { DEFAULT_CHARACTER } from "../types";
import type { AvatarColor, AvatarShape, Bot, BotMode, ModelOption, CatalogApp, Character as CharacterLook, Connector, SearchHit } from "../types";
import { botTitle, relTime } from "../lib/format";
import { connectorError } from "../lib/connectorError";
import { openSignInWindow, onSignInDone, startSignIn } from "../lib/oauth";
import { Avatar, BotAvatar } from "./Avatar";
import { AccessoryChips, CharacterStage, EyeChips, JoyToggles, LookPicker, TypeCards } from "./CharacterEditor";

export { LookPicker };
import { Icon, Spinner } from "./Icon";
import { NativeAccountRow, NativeCatalogCard, useNative } from "./NativeApps";
import { ConfirmButton, Empty, ErrorNote, IconButton, Loading, Modal, useTick } from "./ui";

/** Titles and descriptions are `mode.<id>.title` / `mode.<id>.text` in the dictionaries. */
export const MODE_IDS: BotMode[] = ["personal", "teammate"];

/* ---------- Create bot ---------- */

export function CreateBotModal({ onClose }: { onClose: () => void }) {
  const { upsertBot, selectBot, openModal } = useStore.getState();
  const t = useT();
  const [name, setName] = useState("");
  const [shape, setShape] = useState<AvatarShape>("pebble");
  const [color, setColor] = useState<AvatarColor>("ember");
  const [character, setCharacter] = useState<CharacterLook>(DEFAULT_CHARACTER);
  const [mode, setMode] = useState<BotMode>("personal");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const main = useStore((s) => Object.values(s.bots).find((b) => b.primary && !b.access));
  useEffect(() => {
    let active = true;
    api<{ models: ModelOption[] }>("GET", "/models").then((r) => { if (active) setModels(r.models); }, (e) => { if (active) setError(errText(e)); });
    return () => { active = false; };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ bot: Bot }>("POST", "/bots", { name: n, shape, color, mode, character, model: model || undefined });
      upsertBot(r.bot);
      selectBot(r.bot.id);
      onClose();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={t("createBot.title")} onClose={onClose} size="md">
      <form className="modal-body" onSubmit={submit}>
        <div className="create-preview">
          <CharacterStage shape={shape} color={color} name={name} character={character} size={96} withTry={false} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={id}>{t("common.name")}</label>
          <input id={id} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("createBot.namePlaceholder")} autoComplete="off" />
        </div>
        <label className="field">
          <span className="field-label">{t("createBot.model")}</span>
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">{t("createBot.inherit")}{main?.model ? ` · ${main.model}` : ""}</option>
            {models.map((m) => <option key={m.ref} value={m.ref}>{m.provider} · {m.model}</option>)}
          </select>
        </label>
        <div className="field">
          <span className="field-label">{t("look.type")}</span>
          <TypeCards shape={shape} color={color} character={character} onChange={setCharacter} compact />
        </div>
        <div className="field">
          <span className="field-label">{t("createBot.look")}</span>
          <LookPicker name={name} shape={shape} color={color} character={character} onShape={setShape} onColor={setColor} onCharacter={setCharacter} />
        </div>
        {character.type === "mascot" && (
          <>
            <div className="field">
              <span className="field-label">{t("look.eyes")}</span>
              <EyeChips shape={shape} color={color} character={character} onChange={setCharacter} />
            </div>
            <div className="field">
              <span className="field-label">{t("look.accessory")}</span>
              <AccessoryChips shape={shape} color={color} character={character} onChange={setCharacter} />
            </div>
          </>
        )}
        <JoyToggles character={character} onChange={setCharacter} />
        <div className="field">
          <span className="field-label">{t("createBot.type")}</span>
          <div className="choice-list" role="radiogroup" aria-label={t("createBot.type")}>
            {MODE_IDS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={`choice ${mode === m ? "is-selected" : ""}`} onClick={() => setMode(m)}>
                <span className="choice-title">{t(`mode.${m}.title`)}</span>
                <span className="choice-text">{t(`mode.${m}.text`)}</span>
              </button>
            ))}
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="modal-foot">
          <button type="button" className="link" onClick={() => openModal({ kind: "createRoom" })}>
            {t("createBot.roomInstead")}
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>
            {t(busy ? "common.creating" : "createBot.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Create room ---------- */

export function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const bots = useStore((s) => s.bots);
  const { loadBots, selectBot } = useStore.getState();
  const t = useT();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const agents = useMemo(() => sortedBots(bots).filter((b) => b.kind === "agent").sort((a, b) => Number(b.primary) - Number(a.primary)), [bots]);
  const ready = name.trim().length > 0 && picked.length >= 2;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("POST", "/rooms", { name: name.trim(), botIds: picked });
      await loadBots();
      selectBot(r.id);
      onClose();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={t("createRoom.title")} onClose={onClose} size="md">
      <form className="modal-body" onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor={id}>{t("createRoom.name")}</label>
          <input id={id} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("createRoom.namePlaceholder")} autoComplete="off" />
        </div>
        <div className="field">
          <span className="field-label">{t("createRoom.bots")}</span>
          {agents.length < 2 ? (
            <p className="muted small">{t("createRoom.needTwo")}</p>
          ) : (
            <ul className="check-list">
              {agents.map((b) => {
                const on = picked.includes(b.id);
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className={`check-row ${on ? "is-selected" : ""}`}
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== b.id) : [...p, b.id]))}
                    >
                      <BotAvatar bot={b} size={28} />
                      <span className="truncate grow">{botTitle(b)}</span>
                      <span className="check-box">{on && <Icon name="check" size={13} />}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="field-hint">{t("createRoom.pickTwo")}</p>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
            {t(busy ? "common.creating" : "createRoom.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Search ---------- */

/** Split a snippet around the searched words so they can be emphasised. React escapes every piece. */
function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const words = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((x, y) => y.length - x.length);
  if (words.length === 0) return [{ text, hit: false }];
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).filter((part) => part !== "").map((part, i) => ({ text: part, hit: i % 2 === 1 }));
}

export function Snippet({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => highlightParts(text, query), [text, query]);
  return (
    <span className="search-snippet">
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

/* ---------- Connect apps ---------- */

const logoLetter = (name: string) => (Array.from(name.trim())[0] ?? "?").toUpperCase();
/** Two addresses are the same app when they differ only by case or a trailing slash. */
const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, "").toLowerCase() === b.trim().replace(/\/+$/, "").toLowerCase();

/** Redirect URL to register with the app, plus its client ID and (optional) secret. */
function OAuthClientFields({ redirectUri, clientId, setClientId, clientSecret, setClientSecret, help }: { redirectUri: string; clientId: string; setClientId: (v: string) => void; clientSecret: string; setClientSecret: (v: string) => void; help?: string }) {
  const t = useT();
  const ids = { uri: useId(), id: useId(), secret: useId() };
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(redirectUri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return (
    <div className="oauth-client">
      <p className="field-hint">{help || t("oauth.clientNeeded")}</p>
      <div className="field">
        <label className="field-label" htmlFor={ids.uri}>{t("oauth.redirectUri")}</label>
        <div className="copy-row">
          <input id={ids.uri} className="input" value={redirectUri} readOnly onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-small" onClick={copy}>{copied ? t("oauth.copied") : t("oauth.copy")}</button>
        </div>
      </div>
      <div className="form-cols">
        <div className="field">
          <label className="field-label" htmlFor={ids.id}>{t("oauth.clientId")}</label>
          <input id={ids.id} className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.secret}>{t("oauth.clientSecret")} <span className="muted">{t("common.optional")}</span></label>
          <input id={ids.secret} className="input" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
      </div>
      <p className="field-hint">{t("catalog.tokenStored")}</p>
    </div>
  );
}

function ConnectorRow({ c }: { c: Connector }) {
  const loadConnectors = useStore((s) => s.loadConnectors);
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [clientForm, setClientForm] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const oauth = c.auth === "oauth";
  const needsAuth = c.status === "needs_auth";

  useEffect(() => {
    if (c.status === "ready") setWaiting(false);
  }, [c.status]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/connectors/${c.id}/refresh`);
      await loadConnectors();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setError(null);
    try {
      await api("DELETE", `/connectors/${c.id}`);
      await loadConnectors();
    } catch (e) {
      setError(errText(e));
    }
  };
  const signIn = async () => {
    if (clientForm !== null && !clientId.trim()) return;
    const win = openSignInWindow();
    setBusy(true);
    setError(null);
    try {
      const r = await startSignIn(c.id, win, clientForm !== null ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined } : {});
      if (r.kind === "needsClientId") setClientForm(r.redirectUri);
      else {
        setClientForm(null);
        setWaiting(r.kind === "opened");
        if (r.kind === "done") await loadConnectors();
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    setError(null);
    try {
      await api("POST", `/connectors/${c.id}/oauth/disconnect`);
      await loadConnectors();
    } catch (e) {
      setError(errText(e));
    }
  };

  const credential = c.hasToken ? ` · ${t("connector.tokenSaved")}` : c.oauth?.signedIn ? ` · ${t("connector.signedInOauth")}${c.oauth.customClient ? ` (${t("connector.customClient")})` : ""}` : "";
  return (
    <li className="connector">
      <div className="connector-main">
        <span className="logo-tile" aria-hidden="true">{logoLetter(c.name)}</span>
        <div className="list-row-text">
          <span className="list-row-title">
            {c.name}
            <span className={`chip state-${c.status}`}>{t(`connector.status.${c.status}`)}</span>
          </span>
          <span className="list-row-sub truncate" title={c.url}>{c.url}{credential}</span>
          {c.status === "error" && <span className="list-row-sub is-error">{connectorError(c, t, t("connector.unreachable"))}</span>}
        </div>
        {oauth && (needsAuth || c.status === "error") ? (
          <button type="button" className="btn btn-small btn-primary" disabled={busy || (clientForm !== null && !clientId.trim())} onClick={() => void signIn()} aria-label={t("connector.signInName", { name: c.name })}>
            {busy ? <><Spinner size={13} /> {t("connector.signingIn")}</> : t("connector.signIn")}
          </button>
        ) : (
          <IconButton icon="refresh" size={16} label={t("connector.reconnect", { name: c.name })} className={busy ? "is-spinning" : ""} disabled={busy} onClick={() => void refresh()} />
        )}
        {oauth && c.oauth?.signedIn && <button type="button" className="btn btn-small btn-ghost" onClick={() => void signOut()}>{t("connector.signOut")}</button>}
        <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("connector.remove")} confirmLabel={t("connector.confirmRemove")} busyLabel={t("connector.removing")} onConfirm={remove} />
      </div>
      {needsAuth && !waiting && clientForm === null && <p className="field-hint connector-note">{t("connector.needsAuthHint")}</p>}
      {waiting && needsAuth && <p className="field-hint connector-note"><Spinner size={12} /> {t("connector.waitingSignIn")}</p>}
      {clientForm !== null && <OAuthClientFields redirectUri={clientForm} clientId={clientId} setClientId={setClientId} clientSecret={clientSecret} setClientSecret={setClientSecret} />}
      {!needsAuth && (
        <button type="button" className="connector-tools" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={c.tools.length === 0}>
          <Icon name="chevronRight" size={13} className={open ? "is-rotated" : ""} />
          {c.tools.length === 0 ? t("connector.noTools") : tn("count.tool", c.tools.length)}
        </button>
      )}
      {open && !needsAuth && c.tools.length > 0 && (
        <ul className="tool-list">
          {c.tools.map((tool) => (
            <li key={tool.name}>
              <code>{tool.name}</code>
              {tool.readOnly && <span className="chip">{t("connector.readOnly")}</span>}
              {tool.description && <span className="tool-desc">{tool.description}</span>}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote>{error}</ErrorNote>
    </li>
  );
}

type Prefill = { name: string; botId: string; seq: number };

/** One catalogue app: "Add" opens an inline form (token, client ID or nothing), then connects or opens the app's sign-in page. */
function CatalogCard({ app, existing, redirectUri, open, onToggle, prefill, onAdded }: { app: CatalogApp; existing: Connector | undefined; redirectUri: string; open: boolean; onToggle: () => void; prefill?: Prefill; onAdded: (resolvedCard: boolean) => void }) {
  const t = useT();
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [askClient, setAskClient] = useState(app.oauthClient === "manual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const needsToken = app.auth === "token";
  const oauth = app.auth === "oauth";
  const connected = !!existing;
  // When the modal was opened from a bot's "connect X" card, adding that same app also resolves the card.
  const answersCard = !!prefill && (app.name.toLowerCase().includes(prefill.name.trim().toLowerCase()) || prefill.name.toLowerCase().includes(app.name.toLowerCase()));
  const card = answersCard && prefill ? { botId: prefill.botId, seq: prefill.seq } : {};
  const blocked = busy || (app.instanceUrl && !/^https:\/\/\S+$/i.test(endpoint.trim())) || (needsToken && !token.trim()) || (oauth && askClient && !clientId.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (blocked) return;
    // The sign-in window must open in the click itself, before any request.
    const win = oauth ? openSignInWindow() : null;
    setBusy(true);
    setError(null);
    try {
      const client = askClient && clientId.trim() ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined } : {};
      let target = existing;
      if (!target) {
        target = (await api<{ connector: Connector }>("POST", "/connectors", {
          name: app.name,
          url: app.instanceUrl ? endpoint.trim() : app.url,
          ...(app.instanceUrl ? { catalogId: app.id } : {}),
          ...(needsToken ? { token: token.trim() } : {}),
          ...(oauth ? { auth: "oauth", ...client } : {}),
          ...(oauth ? {} : card),
        })).connector;
      }
      if (target.status === "error" && !oauth) {
        await useStore.getState().loadConnectors();
        setError(connectorError(target, t, t("catalog.failed")));
        return;
      }
      if (oauth) {
        const r = await startSignIn(target.id, win, { ...client, ...card });
        if (r.kind === "needsClientId") {
          setAskClient(true);
          onAdded(false);
          return;
        }
      }
      setToken("");
      onAdded(answersCard && !oauth);
    } catch (err) {
      win?.close();
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const signedIn = connected && existing.status === "ready";
  return (
    <li className={`catalog-card ${open ? "is-open" : ""}`}>
      <div className="catalog-card-main">
        <span className="logo-tile" aria-hidden="true">{logoLetter(app.name)}</span>
        <div className="list-row-text">
          <span className="list-row-title">{app.name}</span>
          <span className="list-row-sub">{app.description}</span>
        </div>
        {signedIn ? (
          <span className="chip state-ready">
            <Icon name="check" size={12} /> {t("catalog.connected")}
          </span>
        ) : (
          <button type="button" className="btn btn-small" aria-expanded={open} aria-controls={`${id}f`} aria-label={connected ? t("connector.signInName", { name: app.name }) : t("catalog.addName", { name: app.name })} onClick={onToggle}>
            {open ? t("common.cancel") : connected ? t("connector.signIn") : t("catalog.add")}
          </button>
        )}
      </div>
      {open && !signedIn && (
        <form id={`${id}f`} className="catalog-form" onSubmit={submit}>
          {app.instanceUrl && <div className="field"><label className="field-label" htmlFor={id + "url"}>{t("manual.url")}</label><input id={id + "url"} className="input" type="url" placeholder="https://…/mcp/" value={endpoint} onChange={e => setEndpoint(e.target.value)} required /></div>}
          {needsToken ? (
            <div className="field">
              <label className="field-label" htmlFor={`${id}t`}>{t("catalog.token")}</label>
              <input id={`${id}t`} className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} data-autofocus="" autoFocus />
              {app.tokenHelp && <p className="field-hint">{app.tokenHelp}</p>}
              <p className="field-hint">{t("catalog.tokenStored")}</p>
            </div>
          ) : oauth ? (
            <>
              <p className="muted small">{t("oauth.browserNote", { name: app.name })}</p>
              {askClient ? (
                <OAuthClientFields redirectUri={redirectUri} clientId={clientId} setClientId={setClientId} clientSecret={clientSecret} setClientSecret={setClientSecret} help={app.oauthClient === "manual" ? app.tokenHelp : undefined} />
              ) : (
                app.tokenHelp && <p className="field-hint">{app.tokenHelp}</p>
              )}
            </>
          ) : (
            <p className="muted small">{t("catalog.noToken")}</p>
          )}
          <ErrorNote>{error}</ErrorNote>
          <div className="row-end">
            <button type="submit" className="btn btn-primary btn-small" disabled={blocked}>
              {busy ? <><Spinner size={13} /> {t("common.connecting")}</> : oauth ? t("oauth.signInWith", { name: app.name }) : t("connect.btn")}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function Catalog({ connectors, prefill, onClose, catalogId }: { catalogId?: string; connectors: Connector[] | null; prefill?: Prefill; onClose: () => void }) {
  const loadConnectors = useStore((s) => s.loadConnectors);
  const t = useT();
  const [apps, setApps] = useState<CatalogApp[] | null>(null);
  const [redirectUri, setRedirectUri] = useState("");
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState(catalogId === "github-repositories" ? "GitHub Repositories" : catalogId === "voicestudio" ? "VoiceStudio" : "");
  const [openId, setOpenId] = useState<string | null>(catalogId ?? null);

  useEffect(() => {
    let dead = false;
    api<{ apps: CatalogApp[]; oauthRedirectUri?: string }>("GET", "/connectors/catalog").then(
      (r) => {
        if (dead) return;
        setApps(Array.isArray(r?.apps) ? r.apps : []);
        setRedirectUri(r?.oauthRedirectUri ?? "");
      },
      () => !dead && setFailed(true),
    );
    return () => {
      dead = true;
    };
  }, []);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = (apps ?? []).filter((a) => !needle || `${a.name} ${a.description}`.toLowerCase().includes(needle));
    const byCategory = new Map<string, CatalogApp[]>();
    for (const a of shown) byCategory.set(a.category, [...(byCategory.get(a.category) ?? []), a]);
    return [...byCategory.entries()];
  }, [apps, q]);

  if (apps && apps.length === 0) return null;

  return (
    <section className="catalog" aria-labelledby="catalog-title">
      <div className="catalog-head">
        <h3 id="catalog-title">{t("catalog.title")}</h3>
        {apps && (
          <div className="search-field is-inline catalog-search">
            <Icon name="search" size={15} />
            <input className="search-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("catalog.search")} aria-label={t("catalog.searchLabel")} />
          </div>
        )}
      </div>
      {!apps && !failed && <Loading label={t("catalog.loading")} />}
      {failed && <p className="muted small">{t("catalog.failed")}</p>}
      {apps && groups.length === 0 && <p className="muted small">{t("catalog.none", { q: q.trim() })}</p>}
      {groups.map(([category, list]) => (
        <div key={category} className="catalog-group">
          <h4>{category}</h4>
          <ul className="catalog-grid">
            {list.map((app) => app.native ? (
              <NativeCatalogCard key={app.id} entry={app} open={openId === app.id} onToggle={() => setOpenId((cur) => (cur === app.id ? null : app.id))} />
            ) : (
              <CatalogCard
                key={app.id}
                app={app}
                existing={connectors?.find((c) => app.instanceUrl ? c.name === app.name && c.status === "ready" : sameUrl(c.url, app.url))}
                redirectUri={redirectUri}
                open={openId === app.id}
                onToggle={() => setOpenId((cur) => (cur === app.id ? null : app.id))}
                prefill={prefill}
                onAdded={(resolvedCard) => {
                  setOpenId(null);
                  void loadConnectors();
                  if (resolvedCard) onClose();
                }}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function ConnectorsModal({ onClose, prefill, catalogId }: { catalogId?: string; onClose: () => void; prefill?: Prefill }) {
  const connectors = useStore((s) => s.connectors);
  const loadError = useStore((s) => s.connectorsError);
  const loadConnectors = useStore((s) => s.loadConnectors);
  const t = useT();
  const [name, setName] = useState(prefill?.name ?? "");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(!!prefill);
  const ids = { name: useId(), url: useId(), token: useId(), form: useId() };
  const nativeAccounts = useNative()?.accounts ?? [];

  useEffect(() => {
    void loadConnectors();
    return onSignInDone(() => void loadConnectors());
  }, [loadConnectors]);

  const valid = name.trim().length > 0 && /^https?:\/\/\S+$/i.test(url.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const added = await api<{ connector: Connector }>("POST", "/connectors", {
        name: name.trim(),
        url: url.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
        ...(prefill ? { botId: prefill.botId, seq: prefill.seq } : {}),
      });
      await loadConnectors();
      // An app that wants a sign-in stays listed above with its "Sign in" button.
      if (prefill && added.connector.status !== "needs_auth") {
        onClose();
        return;
      }
      setName("");
      setUrl("");
      setToken("");
      setFormOpen(false);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={prefill ? t("connect.title", { name: prefill.name }) : t("connectors.title")} onClose={onClose} size="lg">
      <div className="modal-body connectors">
        <p className="muted">{t("connectors.intro")}</p>

        {connectors === null && !loadError && <Loading label={t("connectors.loading")} />}
        {loadError && connectors === null && <ErrorNote>{loadError}</ErrorNote>}
        {connectors && connectors.length + nativeAccounts.length > 0 && (
          <section className="catalog" aria-labelledby="connected-title">
            <div className="catalog-head">
              <h3 id="connected-title">{t("connectors.connected")}</h3>
            </div>
            <ul className="connector-list">
              {nativeAccounts.map((a) => (
                <NativeAccountRow key={a.id} acc={a} />
              ))}
              {connectors.map((c) => (
                <ConnectorRow key={c.id} c={c} />
              ))}
            </ul>
          </section>
        )}
        {connectors && connectors.length + nativeAccounts.length === 0 && !prefill && <Empty icon="plug" title={t("connectors.emptyTitle")}>{t("connectors.emptyText")}</Empty>}

        <Catalog catalogId={catalogId} connectors={connectors} prefill={prefill} onClose={onClose} />

        <div className="disclosure">
          <button type="button" className="disclosure-toggle" aria-expanded={formOpen} aria-controls={ids.form} onClick={() => setFormOpen((v) => !v)}>
            <Icon name="chevronRight" size={14} className={formOpen ? "is-rotated" : ""} />
            {t("manual.disclosure")}
          </button>
          {formOpen && (
            <form id={ids.form} className="connector-form" onSubmit={submit}>
              <p className="muted small">{t("manual.intro")}</p>
              <div className="form-cols">
                <div className="field">
                  <label className="field-label" htmlFor={ids.name}>{t("common.name")}</label>
                  <input id={ids.name} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("manual.namePlaceholder")} autoComplete="off" />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={ids.url}>{t("manual.url")}</label>
                  <input id={ids.url} className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" autoComplete="off" spellCheck={false} />
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={ids.token}>{t("catalog.token")} <span className="muted">{t("common.optional")}</span></label>
                <input id={ids.token} className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder={t("manual.tokenPlaceholder")} />
                <p className="field-hint">{t("catalog.tokenStored")}</p>
              </div>
              <ErrorNote>{error}</ErrorNote>
              <div className="modal-foot">
                <span className="spacer" />
                <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)}>{t("common.cancel")}</button>
                <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
                  {busy ? <><Spinner size={14} /> {t("common.connecting")}</> : t("manual.submit")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}
