import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import { useScreen } from "../lib/screen";
import { BotAvatar } from "./Avatar";
import { Icon, Spinner } from "./Icon";
import { IconButton, useDialogFocus, useEscape } from "./ui";

const SPECIAL_KEYS = new Set(["Enter", "Backspace", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"]);
type Input =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; x: number; y: number; dy: number }
  | { type: "goto"; url: string };

/** Full-screen view of a bot's browser desktop: watch, or take control. */
export function ComputerViewer({ botId }: { botId: string }) {
  const bot = useStore((s) => s.bots[botId]);
  const computer = useStore((s) => s.computer);
  const closeViewer = useStore((s) => s.closeViewer);
  const [control, setControl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const typed = useRef("");
  const typeTimer = useRef<number | undefined>(undefined);
  const wheel = useRef<{ x: number; y: number; dy: number } | null>(null);
  const wheelTimer = useRef<number | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);

  const engine = computer ? computer.browser : true;
  const { url, status, refresh } = useScreen(botId, 1000, engine);
  const desktop = computer?.desktops.find((d) => d.botId === botId);

  useDialogFocus(root);
  // In control mode Escape belongs to the remote desktop, so the overlay ignores it.
  useEscape(control ? () => undefined : closeViewer);

  useEffect(() => {
    if (!bot) closeViewer();
  }, [bot, closeViewer]);

  useEffect(() => {
    if (control) stage.current?.focus();
  }, [control]);

  useEffect(
    () => () => {
      window.clearTimeout(typeTimer.current);
      window.clearTimeout(wheelTimer.current);
      window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  const send = useCallback(
    (input: Input) => {
      chain.current = chain.current
        .then(() => api("POST", `/bots/${botId}/screen/input`, input))
        .then(
          () => {
            setError(null);
            window.clearTimeout(refreshTimer.current);
            refreshTimer.current = window.setTimeout(refresh, 250);
          },
          (e: unknown) => setError(errText(e)),
        );
    },
    [botId, refresh],
  );

  const flushTyped = useCallback(() => {
    window.clearTimeout(typeTimer.current);
    if (!typed.current) return;
    const text = typed.current;
    typed.current = "";
    send({ type: "type", text });
  }, [send]);

  const point = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const el = img.current;
    if (!el || !el.naturalWidth) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const x = Math.round(((clientX - r.left) * el.naturalWidth) / r.width);
    const y = Math.round(((clientY - r.top) * el.naturalHeight) / r.height);
    if (x < 0 || y < 0 || x > el.naturalWidth || y > el.naturalHeight) return null;
    return { x, y };
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!control || e.metaKey || e.ctrlKey || e.altKey) return;
    if (SPECIAL_KEYS.has(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      flushTyped();
      send({ type: "key", key: e.key });
    } else if (e.key.length === 1) {
      e.preventDefault();
      typed.current += e.key;
      window.clearTimeout(typeTimer.current);
      typeTimer.current = window.setTimeout(flushTyped, 160);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!control) return;
    const p = point(e.clientX, e.clientY);
    if (!p) return;
    wheel.current = { ...p, dy: (wheel.current?.dy ?? 0) + e.deltaY };
    if (wheelTimer.current !== undefined) return;
    wheelTimer.current = window.setTimeout(() => {
      wheelTimer.current = undefined;
      const w = wheel.current;
      wheel.current = null;
      if (w && w.dy !== 0) send({ type: "scroll", x: w.x, y: w.y, dy: Math.round(w.dy) });
    }, 120);
  };

  const go = (e: FormEvent) => {
    e.preventDefault();
    let target = address.trim();
    if (!target) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = `https://${target}`;
    send({ type: "goto", url: target });
    stage.current?.focus();
  };

  if (!bot) return null;

  const statusText = !engine
    ? "Browser engine not installed"
    : status === "ok"
      ? control
        ? "You're in control"
        : "Watching live"
      : status === "none"
        ? "No desktop open"
        : status === "error"
          ? "Can't reach the desktop"
          : "Connecting…";

  return (
    <div
      className="viewer"
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={`${bot.name}'s computer`}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!control && e.target === e.currentTarget) closeViewer();
      }}
    >
      <header className="viewer-bar">
        <BotAvatar bot={bot} size={28} />
        <div className="viewer-title">
          <strong>{bot.name}'s computer</strong>
          <span>
            {control && status === "ok" && <span className="dot-inline dot-live" />}
            {statusText}
            {desktop?.url && status === "ok" ? ` · ${desktop.url}` : ""}
          </span>
        </div>
        <IconButton icon="close" label="Close" onClick={closeViewer} />
      </header>

      <div
        className={`viewer-stage ${control ? "is-control" : ""}`}
        ref={stage}
        tabIndex={control ? 0 : -1}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onMouseDown={(e) => {
          if (!control && e.target === e.currentTarget) closeViewer();
        }}
        aria-label={control ? "Remote desktop — keys you press are sent to it" : undefined}
      >
        {!engine ? (
          <div className="viewer-empty">
            <Icon name="monitor" size={40} />
            <h3>No browser engine on this server</h3>
            <p>Bots need a browser engine installed on the server to open and operate web pages. Ask whoever runs this server to install it, then reopen this view.</p>
          </div>
        ) : url ? (
          <img
            ref={img}
            src={url}
            alt={`${bot.name}'s screen`}
            draggable={false}
            onClick={(e) => {
              if (!control) return;
              const p = point(e.clientX, e.clientY);
              if (!p) return;
              flushTyped();
              send({ type: "click", ...p });
              stage.current?.focus();
            }}
          />
        ) : status === "none" ? (
          <div className="viewer-empty">
            <Icon name="monitor" size={40} />
            <h3>No desktop open yet</h3>
            <p>{bot.name} opens a desktop the first time it needs to browse. {control ? "Enter an address below to open one now." : "Take control to open a page yourself."}</p>
          </div>
        ) : status === "error" ? (
          <div className="viewer-empty">
            <Icon name="alert" size={40} />
            <h3>Can't reach the desktop</h3>
            <p>The screen couldn't be loaded. It will keep retrying.</p>
            <button type="button" className="btn" onClick={refresh}>Retry now</button>
          </div>
        ) : (
          <div className="viewer-empty">
            <Spinner size={28} />
            <p>Connecting…</p>
          </div>
        )}
      </div>

      {engine && (
        <footer className="viewer-foot">
          {control ? (
            <>
              <form className="viewer-url" onSubmit={go}>
                <label className="sr-only" htmlFor="viewer-url">Address</label>
                <input id="viewer-url" className="input input-small" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Go to an address…" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
                <button type="submit" className="btn btn-small" disabled={!address.trim()}>Go</button>
              </form>
              <span className="viewer-hint">Click, type and scroll on the screen.</span>
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => {
                  flushTyped();
                  setControl(false);
                }}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <span className="viewer-hint">
                <Icon name="eye" size={15} /> You're watching. {bot.name} keeps working while you look.
              </span>
              <button type="button" className="btn btn-small btn-primary" onClick={() => setControl(true)}>
                <Icon name="cursor" size={14} /> Take control
              </button>
            </>
          )}
          {error && <span className="viewer-error" role="alert">{error}</span>}
        </footer>
      )}
    </div>
  );
}
