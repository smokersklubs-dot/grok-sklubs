import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { tn, useT } from "../i18n";
import { sortedBots, useStore } from "../store";
import { AVATAR_COLORS, AVATAR_SHAPES } from "../types";
import type { AvatarColor, AvatarShape, Bot, BotMode, CatalogApp, Connector, SearchHit } from "../types";
import { colorOf } from "../lib/colors";
import { botTitle, relTime } from "../lib/format";
import { Avatar, BotAvatar } from "./Avatar";
import { Icon, Spinner } from "./Icon";
import { ConfirmButton, Empty, ErrorNote, IconButton, Loading, Modal, useTick } from "./ui";

/* ---------- Look picker (shared with bot settings) ---------- */

export function LookPicker({
  name,
  shape,
  color,
  onShape,
  onColor,
}: {
  name: string;
  shape: AvatarShape;
  color: AvatarColor;
  onShape: (s: AvatarShape) => void;
  onColor: (c: AvatarColor) => void;
}) {
  const t = useT();
  return (
    <div className="look">
      <div className="look-grid" role="radiogroup" aria-label={t("look.shape")}>
        {AVATAR_SHAPES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={shape === s} aria-label={t(`shape.${s}`)} title={t(`shape.${s}`)} className={`look-shape ${shape === s ? "is-selected" : ""}`} onClick={() => onShape(s)}>
            <Avatar shape={s} color={color} name={name || "A"} size={36} />
          </button>
        ))}
      </div>
      <div className="look-colors" role="radiogroup" aria-label={t("look.colour")}>
        {AVATAR_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={t(`color.${c}`)}
            title={t(`color.${c}`)}
            className={`swatch ${color === c ? "is-selected" : ""}`}
            style={{ background: colorOf(c).bg }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>
    </div>
  );
}

/** Titles and descriptions are `mode.<id>.title` / `mode.<id>.text` in the dictionaries. */
export const MODE_IDS: BotMode[] = ["personal", "teammate"];

/* ---------- Create bot ---------- */

export function CreateBotModal({ onClose }: { onClose: () => void }) {
  const { upsertBot, selectBot, openModal } = useStore.getState();
  const t = useT();
  const [name, setName] = useState("");
  const [shape, setShape] = useState<AvatarShape>("squircle");
  const [color, setColor] = useState<AvatarColor>("ember");
  const [mode, setMode] = useState<BotMode>("personal");
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
      const r = await api<{ bot: Bot }>("POST", "/bots", { name: n, shape, color, mode });
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
          <Avatar shape={shape} color={color} name={name || "A"} size={72} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={id}>{t("common.name")}</label>
          <input id={id} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("createBot.namePlaceholder")} autoComplete="off" />
        </div>
        <div className="field">
          <span className="field-label">{t("createBot.look")}</span>
          <LookPicker name={name} shape={shape} color={color} onShape={setShape} onColor={setColor} />
        </div>
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

function Snippet({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => highlightParts(text, query), [text, query]);
  return (
    <span className="search-snippet">
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

export function SearchModal({ onClose }: { onClose: () => void }) {
  const bots = useStore((s) => s.bots);
  const { selectBot, jumpTo, openHistory } = useStore.getState();
  const t = useT();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const [found, setFound] = useState<{ q: string; hits: SearchHit[]; error: string | null } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const now = useTick(60_000);
  const needle = q.trim();
  const searching = needle.length >= 2;

  const results = useMemo(() => {
    const lower = needle.toLowerCase();
    const all = sortedBots(bots).sort((a, b) => Number(b.primary) - Number(a.primary));
    if (!lower) return all;
    return all.filter((b) => `${b.name} ${b.label} ${b.description}`.toLowerCase().includes(lower));
  }, [bots, needle]);

  // Messages: asked 250 ms after the last keystroke, and only the latest answer is kept.
  useEffect(() => {
    if (!searching) return;
    let dead = false;
    const timer = window.setTimeout(() => {
      api<{ hits: SearchHit[] }>("GET", `/search?q=${enc(needle)}`).then(
        (r) => !dead && setFound({ q: needle, hits: Array.isArray(r?.hits) ? r.hits : [], error: null }),
        (e: unknown) => !dead && setFound({ q: needle, hits: [], error: errText(e) }),
      );
    }, 250);
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [needle, searching]);

  const loadingHits = searching && found?.q !== needle;
  const hits = searching && found?.q === needle ? found.hits : [];
  const hitsError = searching && found?.q === needle ? found.error : null;
  const total = results.length + hits.length;

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    list.current?.querySelector(".is-highlight")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const open = (b: Bot | undefined) => {
    if (!b) return;
    selectBot(b.id);
    onClose();
  };
  const openHit = (h: SearchHit | undefined) => {
    if (!h) return;
    onClose();
    if (h.current) jumpTo(h.botId, h.seq);
    else openHistory({ botId: h.botId, generation: h.generation, seq: h.seq });
  };

  return (
    <Modal title={t("sidebar.search")} onClose={onClose} size="md" hideTitle className="search-modal">
      <div className="search-field">
        <Icon name="search" size={18} />
        <input
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.label")}
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, total - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (index < results.length) open(results[index]);
              else openHit(hits[index - results.length]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <ul className="search-results" id="search-results" role="listbox" ref={list}>
        {searching && results.length > 0 && <li className="search-group" role="presentation">{t("search.groupBots")}</li>}
        {results.map((b, i) => (
          <li key={b.id} role="option" aria-selected={i === index}>
            <button type="button" tabIndex={-1} className={`search-row ${i === index ? "is-highlight" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => open(b)}>
              <BotAvatar bot={b} size={32} badge />
              <span className="bot-row-text">
                <span className="bot-row-name truncate">{botTitle(b)}</span>
                <span className="bot-row-preview truncate">{b.preview || b.description || (b.kind === "room" ? t("search.room") : t("sidebar.noMessages"))}</span>
              </span>
            </button>
          </li>
        ))}
        {!searching && results.length === 0 && <li className="search-none">{t("search.none", { q: needle })}</li>}
        {searching && (
          <>
            <li className="search-group" role="presentation">{t("search.groupMessages")}</li>
            {loadingHits && (
              <li className="search-state" role="status">
                <Spinner size={14} /> {t("search.searching")}
              </li>
            )}
            {hitsError && <li className="search-state is-error" role="alert">{hitsError}</li>}
            {!loadingHits && !hitsError && hits.length === 0 && <li className="search-state">{t("search.noMessages", { q: needle })}</li>}
            {hits.map((h, j) => {
              const i = results.length + j;
              const b = bots[h.botId];
              return (
                <li key={`${h.botId}:${h.generation}:${h.seq}`} role="option" aria-selected={i === index}>
                  <button type="button" tabIndex={-1} className={`search-row is-hit ${i === index ? "is-highlight" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => openHit(h)}>
                    {b ? <BotAvatar bot={b} size={28} /> : <Avatar shape="circle" color="slate" name={h.botName} size={28} />}
                    <span className="bot-row-text">
                      <span className="search-hit-head">
                        <span className="bot-row-name truncate">{b?.name ?? h.botName}</span>
                        <span className="search-hit-meta">
                          {h.role === "user" ? t("common.you") : t("search.roleBot")} · {relTime(h.at, now)}
                        </span>
                        {!h.current && <span className="chip">{t("search.earlier")}</span>}
                      </span>
                      <Snippet text={h.snippet} query={needle} />
                    </span>
                  </button>
                </li>
              );
            })}
          </>
        )}
      </ul>
    </Modal>
  );
}

/* ---------- Connect apps ---------- */

const logoLetter = (name: string) => (Array.from(name.trim())[0] ?? "?").toUpperCase();
/** Two addresses are the same app when they differ only by case or a trailing slash. */
const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, "").toLowerCase() === b.trim().replace(/\/+$/, "").toLowerCase();

function ConnectorRow({ c }: { c: Connector }) {
  const loadConnectors = useStore((s) => s.loadConnectors);
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <li className="connector">
      <div className="connector-main">
        <span className="logo-tile" aria-hidden="true">{logoLetter(c.name)}</span>
        <div className="list-row-text">
          <span className="list-row-title">
            {c.name}
            <span className={`chip state-${c.status}`}>{t(`connector.status.${c.status}`)}</span>
          </span>
          <span className="list-row-sub truncate" title={c.url}>{c.url}{c.hasToken ? ` · ${t("connector.tokenSaved")}` : ""}</span>
          {c.status === "error" && <span className="list-row-sub is-error">{c.error || t("connector.unreachable")}</span>}
        </div>
        <IconButton icon="refresh" size={16} label={t("connector.reconnect", { name: c.name })} className={busy ? "is-spinning" : ""} disabled={busy} onClick={() => void refresh()} />
        <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("connector.remove")} confirmLabel={t("connector.confirmRemove")} busyLabel={t("connector.removing")} onConfirm={remove} />
      </div>
      <button type="button" className="connector-tools" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={c.tools.length === 0}>
        <Icon name="chevronRight" size={13} className={open ? "is-rotated" : ""} />
        {c.tools.length === 0 ? t("connector.noTools") : tn("count.tool", c.tools.length)}
      </button>
      {open && (
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

/** One catalogue app: "Add" opens an inline form (token if needed), "Connect" adds it in one step. */
function CatalogCard({ app, connected, open, onToggle, prefill, onAdded }: { app: CatalogApp; connected: boolean; open: boolean; onToggle: () => void; prefill?: Prefill; onAdded: (resolvedCard: boolean) => void }) {
  const t = useT();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const needsToken = app.auth === "token";
  // When the modal was opened from a bot's "connect X" card, adding that same app also resolves the card.
  const answersCard = !!prefill && (app.name.toLowerCase().includes(prefill.name.trim().toLowerCase()) || prefill.name.toLowerCase().includes(app.name.toLowerCase()));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || (needsToken && !token.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await api<{ connector: Connector }>("POST", "/connectors", {
        name: app.name,
        url: app.url,
        ...(needsToken ? { token: token.trim() } : {}),
        ...(answersCard && prefill ? { botId: prefill.botId, seq: prefill.seq } : {}),
      });
      setToken("");
      onAdded(answersCard);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`catalog-card ${open ? "is-open" : ""}`}>
      <div className="catalog-card-main">
        <span className="logo-tile" aria-hidden="true">{logoLetter(app.name)}</span>
        <div className="list-row-text">
          <span className="list-row-title">{app.name}</span>
          <span className="list-row-sub">{app.description}</span>
        </div>
        {connected ? (
          <span className="chip state-ready">
            <Icon name="check" size={12} /> {t("catalog.connected")}
          </span>
        ) : (
          <button type="button" className="btn btn-small" aria-expanded={open} aria-controls={`${id}f`} aria-label={t("catalog.addName", { name: app.name })} onClick={onToggle}>
            {open ? t("common.cancel") : t("catalog.add")}
          </button>
        )}
      </div>
      {open && !connected && (
        <form id={`${id}f`} className="catalog-form" onSubmit={submit}>
          {needsToken ? (
            <div className="field">
              <label className="field-label" htmlFor={`${id}t`}>{t("catalog.token")}</label>
              <input id={`${id}t`} className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} data-autofocus="" autoFocus />
              {app.tokenHelp && <p className="field-hint">{app.tokenHelp}</p>}
              <p className="field-hint">{t("catalog.tokenStored")}</p>
            </div>
          ) : (
            <p className="muted small">{t("catalog.noToken")}</p>
          )}
          <ErrorNote>{error}</ErrorNote>
          <div className="row-end">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy || (needsToken && !token.trim())}>
              {busy ? <><Spinner size={13} /> {t("common.connecting")}</> : t("connect.btn")}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

function Catalog({ connectors, prefill, onClose }: { connectors: Connector[] | null; prefill?: Prefill; onClose: () => void }) {
  const loadConnectors = useStore((s) => s.loadConnectors);
  const t = useT();
  const [apps, setApps] = useState<CatalogApp[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    api<{ apps: CatalogApp[] }>("GET", "/connectors/catalog").then(
      (r) => !dead && setApps(Array.isArray(r?.apps) ? r.apps : []),
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
            {list.map((app) => (
              <CatalogCard
                key={app.id}
                app={app}
                connected={!!connectors?.some((c) => sameUrl(c.url, app.url))}
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

export function ConnectorsModal({ onClose, prefill }: { onClose: () => void; prefill?: Prefill }) {
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

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const valid = name.trim().length > 0 && /^https?:\/\/\S+$/i.test(url.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api<{ connector: Connector }>("POST", "/connectors", {
        name: name.trim(),
        url: url.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
        ...(prefill ? { botId: prefill.botId, seq: prefill.seq } : {}),
      });
      await loadConnectors();
      if (prefill) {
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
        {connectors && connectors.length > 0 && (
          <section className="catalog" aria-labelledby="connected-title">
            <div className="catalog-head">
              <h3 id="connected-title">{t("connectors.connected")}</h3>
            </div>
            <ul className="connector-list">
              {connectors.map((c) => (
                <ConnectorRow key={c.id} c={c} />
              ))}
            </ul>
          </section>
        )}
        {connectors && connectors.length === 0 && !prefill && <Empty icon="plug" title={t("connectors.emptyTitle")}>{t("connectors.emptyText")}</Empty>}

        <Catalog connectors={connectors} prefill={prefill} onClose={onClose} />

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
