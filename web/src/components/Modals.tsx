import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { sortedBots, useStore } from "../store";
import { AVATAR_COLORS, AVATAR_SHAPES } from "../types";
import type { AvatarColor, AvatarShape, Bot, BotMode, Connector } from "../types";
import { colorOf } from "../lib/colors";
import { botTitle, plural } from "../lib/format";
import { Avatar, BotAvatar } from "./Avatar";
import { Icon, Spinner } from "./Icon";
import { ConfirmButton, Empty, ErrorNote, IconButton, Loading, Modal } from "./ui";

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
  return (
    <div className="look">
      <div className="look-grid" role="radiogroup" aria-label="Shape">
        {AVATAR_SHAPES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={shape === s} aria-label={s} title={s} className={`look-shape ${shape === s ? "is-selected" : ""}`} onClick={() => onShape(s)}>
            <Avatar shape={s} color={color} name={name || "A"} size={36} />
          </button>
        ))}
      </div>
      <div className="look-colors" role="radiogroup" aria-label="Colour">
        {AVATAR_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={colorOf(c).label}
            title={colorOf(c).label}
            className={`swatch ${color === c ? "is-selected" : ""}`}
            style={{ background: colorOf(c).bg }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>
    </div>
  );
}

export const MODES: { id: BotMode; title: string; text: string }[] = [
  { id: "personal", title: "Personal assistant", text: "Works for you alone and acts on your behalf." },
  { id: "teammate", title: "Teammate", text: "Owns one job and can work alongside your other bots." },
];

/* ---------- Create bot ---------- */

export function CreateBotModal({ onClose }: { onClose: () => void }) {
  const { upsertBot, selectBot, openModal } = useStore.getState();
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
    <Modal title="Create a bot" onClose={onClose} size="md">
      <form className="modal-body" onSubmit={submit}>
        <div className="create-preview">
          <Avatar shape={shape} color={color} name={name || "A"} size={72} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={id}>Name</label>
          <input id={id} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scout" autoComplete="off" />
        </div>
        <div className="field">
          <span className="field-label">Look</span>
          <LookPicker name={name} shape={shape} color={color} onShape={setShape} onColor={setColor} />
        </div>
        <div className="field">
          <span className="field-label">Type</span>
          <div className="choice-list" role="radiogroup" aria-label="Type">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`choice ${mode === m.id ? "is-selected" : ""}`} onClick={() => setMode(m.id)}>
                <span className="choice-title">{m.title}</span>
                <span className="choice-text">{m.text}</span>
              </button>
            ))}
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="modal-foot">
          <button type="button" className="link" onClick={() => openModal({ kind: "createRoom" })}>
            Create a group room instead
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create bot"}
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
    <Modal title="Create a group room" onClose={onClose} size="md">
      <form className="modal-body" onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor={id}>Room name</label>
          <input id={id} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Launch planning" autoComplete="off" />
        </div>
        <div className="field">
          <span className="field-label">Bots in this room</span>
          {agents.length < 2 ? (
            <p className="muted small">You need at least two bots to start a room.</p>
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
          <p className="field-hint">Pick at least two.</p>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
            {busy ? "Creating…" : "Create room"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Search ---------- */

export function SearchModal({ onClose }: { onClose: () => void }) {
  const bots = useStore((s) => s.bots);
  const selectBot = useStore((s) => s.selectBot);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = sortedBots(bots).sort((a, b) => Number(b.primary) - Number(a.primary));
    if (!needle) return all;
    return all.filter((b) => `${b.name} ${b.label} ${b.description}`.toLowerCase().includes(needle));
  }, [bots, q]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    list.current?.querySelector(".is-highlight")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const open = (b: Bot | undefined) => {
    if (!b) return;
    selectBot(b.id);
    onClose();
  };

  return (
    <Modal title="Search" onClose={onClose} size="md" hideTitle className="search-modal">
      <div className="search-field">
        <Icon name="search" size={18} />
        <input
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search bots and rooms…"
          aria-label="Search bots and rooms"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              open(results[index]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <ul className="search-results" id="search-results" role="listbox" ref={list}>
        {results.map((b, i) => (
          <li key={b.id} role="option" aria-selected={i === index}>
            <button type="button" tabIndex={-1} className={`search-row ${i === index ? "is-highlight" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => open(b)}>
              <BotAvatar bot={b} size={32} badge />
              <span className="bot-row-text">
                <span className="bot-row-name truncate">{botTitle(b)}</span>
                <span className="bot-row-preview truncate">{b.preview || b.description || (b.kind === "room" ? "Group room" : "No messages yet")}</span>
              </span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="search-none">No bots or rooms match “{q.trim()}”.</li>}
      </ul>
    </Modal>
  );
}

/* ---------- Connectors ---------- */

function ConnectorRow({ c }: { c: Connector }) {
  const loadConnectors = useStore((s) => s.loadConnectors);
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
        <span className="logo-tile" aria-hidden="true">{(Array.from(c.name.trim())[0] ?? "?").toUpperCase()}</span>
        <div className="list-row-text">
          <span className="list-row-title">
            {c.name}
            <span className={`chip state-${c.status}`}>{c.status === "ready" ? "Ready" : c.status === "error" ? "Error" : "Connecting…"}</span>
          </span>
          <span className="list-row-sub truncate" title={c.url}>{c.url}{c.hasToken ? " · access token saved" : ""}</span>
          {c.status === "error" && <span className="list-row-sub is-error">{c.error || "The server couldn't be reached."}</span>}
        </div>
        <IconButton icon="refresh" size={16} label={`Reconnect ${c.name}`} className={busy ? "is-spinning" : ""} disabled={busy} onClick={() => void refresh()} />
        <ConfirmButton className="btn btn-small btn-ghost-danger" label="Remove" confirmLabel="Confirm remove" busyLabel="Removing…" onConfirm={remove} />
      </div>
      <button type="button" className="connector-tools" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={c.tools.length === 0}>
        <Icon name="chevronRight" size={13} className={open ? "is-rotated" : ""} />
        {c.tools.length === 0 ? "No tools" : plural(c.tools.length, "tool")}
      </button>
      {open && (
        <ul className="tool-list">
          {c.tools.map((t) => (
            <li key={t.name}>
              <code>{t.name}</code>
              {t.readOnly && <span className="chip">read-only</span>}
              {t.description && <span className="tool-desc">{t.description}</span>}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote>{error}</ErrorNote>
    </li>
  );
}

export function ConnectorsModal({ onClose, prefill }: { onClose: () => void; prefill?: { name: string; botId: string; seq: number } }) {
  const connectors = useStore((s) => s.connectors);
  const loadError = useStore((s) => s.connectorsError);
  const loadConnectors = useStore((s) => s.loadConnectors);
  const [name, setName] = useState(prefill?.name ?? "");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(!!prefill);
  const ids = { name: useId(), url: useId(), token: useId() };

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const showForm = formOpen || (connectors !== null && connectors.length === 0);
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
    <Modal title="Connect apps" onClose={onClose} size="lg">
      <div className="modal-body connectors">
        <p className="muted">
          A connector is a remote MCP tool server: an address your bots can call to use another app's tools — calendars, issue trackers, databases and more.
          Connectors are shared by all your bots.
        </p>

        {connectors === null && !loadError && <Loading label="Loading connectors…" />}
        {loadError && connectors === null && <ErrorNote>{loadError}</ErrorNote>}
        {connectors && connectors.length > 0 && (
          <ul className="connector-list">
            {connectors.map((c) => (
              <ConnectorRow key={c.id} c={c} />
            ))}
          </ul>
        )}
        {connectors && connectors.length === 0 && !prefill && <Empty icon="plug" title="No connectors yet">Add your first one below.</Empty>}

        {showForm ? (
          <form className="connector-form" onSubmit={submit}>
            <h3>{prefill ? `Connect ${prefill.name}` : "Add connector"}</h3>
            <div className="form-cols">
              <div className="field">
                <label className="field-label" htmlFor={ids.name}>Name</label>
                <input id={ids.name} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Calendar" autoComplete="off" />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={ids.url}>Server URL</label>
                <input id={ids.url} className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" autoComplete="off" spellCheck={false} data-autofocus={prefill ? "" : undefined} />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={ids.token}>Access token <span className="muted">(optional)</span></label>
              <input id={ids.token} className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="Sent as a bearer token, if the server needs one" />
              <p className="field-hint">Stored on your server and never shown again.</p>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <div className="modal-foot">
              <span className="spacer" />
              {connectors && connectors.length > 0 && !prefill && (
                <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
              )}
              <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
                {busy ? <><Spinner size={14} /> Connecting…</> : "Add connector"}
              </button>
            </div>
          </form>
        ) : (
          connectors && (
            <button type="button" className="btn" onClick={() => setFormOpen(true)}>
              <Icon name="plus" size={15} /> Add connector
            </button>
          )
        )}
      </div>
    </Modal>
  );
}
