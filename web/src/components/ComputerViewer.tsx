import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { useScreen } from "../lib/screen";
import { BotAvatar } from "./Avatar";
import { LiveScreen } from "./LiveScreen";
import { ScreenFrame } from "./ScreenFrame";
import { Icon, Spinner } from "./Icon";
import { IconButton, useDialogFocus, useEscape, useTick } from "./ui";
import type { Recording } from "../types";

const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** The red "recording" badge over the bot's screen while the user demonstrates a task. */
function RecordingBadge({ rec }: { rec: Recording }) {
  const now = useTick(1000);
  const t = useT();
  if (rec.status === "recording") {
    return (
      <div className="rec-badge" role="status">
        <span className="rec-dot" aria-hidden="true" />
        <strong>{t("teach.rec")}</strong>
        <span className="rec-time">{clock(Math.max(0, now - rec.startedAt))} / {clock(rec.maxMs)}</span>
        <span className="rec-count">{t("teach.counts", { events: rec.events, frames: rec.frames })}</span>
      </div>
    );
  }
  if (rec.status === "processing") {
    return (
      <div className="rec-badge is-processing" role="status">
        <Spinner size={14} />
        <span>{t("teach.processing")}</span>
      </div>
    );
  }
  return null;
}

/** The skill the bot drafted from the demonstration, for the user to check and edit before it is saved. */
function SkillReview({ botId, rec, botName }: { botId: string; rec: Recording; botName: string }) {
  const t = useT();
  const [name, setName] = useState(rec.draft?.name ?? "");
  const [when, setWhen] = useState(rec.draft?.when ?? "");
  const [steps, setSteps] = useState(rec.draft?.steps ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/bots/${botId}/teach/${path}`, body);
      if (path === "save") useStore.getState().showToast(t("teach.saved", { name: name.trim() }));
      if (path !== "retry") useStore.getState().setRecording(botId, null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="skill-review" role="dialog" aria-modal="false" aria-label={t("teach.reviewTitle")}>
      <header className="skill-review-head">
        <Icon name="book" size={18} />
        <div>
          <h3>{t("teach.reviewTitle")}</h3>
          <p>{rec.status === "error" ? t("teach.failed", { error: rec.error ?? "" }) : t("teach.reviewText", { name: botName })}</p>
        </div>
      </header>
      {rec.status === "review" && (
        <div className="skill-review-body">
          <label className="field">
            <span className="field-label">{t("teach.name")}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
          <label className="field">
            <span className="field-label">{t("teach.when")}</span>
            <input className="input" value={when} onChange={(e) => setWhen(e.target.value)} maxLength={300} />
          </label>
          <label className="field">
            <span className="field-label">{t("teach.steps")}</span>
            <textarea className="input skill-steps" value={steps} onChange={(e) => setSteps(e.target.value)} rows={9} />
          </label>
          <p className="field-hint">{t("teach.privacy")}</p>
        </div>
      )}
      {error && <p className="viewer-error" role="alert">{error}</p>}
      <footer className="skill-review-foot">
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run("discard")}>{t("teach.discard")}</button>
        {rec.status === "error" && <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run("retry")}>{t("common.tryAgain")}</button>}
        {rec.status === "review" && (
          <button type="button" className="btn btn-small btn-primary" disabled={busy || !name.trim() || !steps.trim()} onClick={() => void run("save", { name, when, steps })}>
            {t(busy ? "common.saving" : "teach.save")}
          </button>
        )}
      </footer>
    </div>
  );
}

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
  const t = useT();
  // Read once: the details panel can open the viewer straight in control mode.
  const [control, setControl] = useState(() => useStore.getState().viewerControl);
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
  const linux = computer?.kind === "linux";
  const [waking, setWaking] = useState(false);
  const wakeUp = async () => {
    setWaking(true);
    try { await api("POST", `/bots/${botId}/desktop/wake`); } catch { /* the status line shows the problem */ }
    setWaking(false);
    refresh();
  };
  const { url, status, refresh } = useScreen(botId, 1000, engine);
  const rec = useStore((s) => s.recordings[botId] ?? null);
  const [note, setNote] = useState("");
  const [teachError, setTeachError] = useState<string | null>(null);
  useEffect(() => {
    void useStore.getState().loadRecording(botId);
  }, [botId]);
  const teach = async (path: "start" | "stop") => {
    setTeachError(null);
    try {
      const r = await api<{ recording: Recording }>("POST", `/bots/${botId}/teach/${path}`, path === "stop" ? { note } : undefined);
      useStore.getState().setRecording(botId, r.recording);
      if (path === "stop") setNote("");
      stage.current?.focus();
    } catch (e) {
      setTeachError(errText(e));
    }
  };
  const desktop = computer?.desktops.find((d) => d.botId === botId);
  // On a Linux computer the screen is streamed live; screenshots remain the fallback if the stream cannot open.
  // A failed stream falls back to screenshots until the mode or the computer's state changes.
  const liveKey = `${control}-${desktop?.open}`;
  const [liveFailedFor, setLiveFailedFor] = useState<string | null>(null);
  const [liveUp, setLiveUp] = useState(false);
  const live = linux && !!desktop?.open && liveFailedFor !== liveKey;

  // Leaving control mode ("Hand back", closing the viewer while in control) tells the server once,
  // so the bot looks at its screen again before relying on what it saw earlier.
  const controlling = useRef(false);
  const handBack = useCallback(() => {
    if (!controlling.current) return;
    controlling.current = false;
    api("POST", `/bots/${botId}/desktop/handback`).catch(() => undefined);
  }, [botId]);
  useEffect(() => {
    if (control) controlling.current = true;
  }, [control]);
  // While in control mode the server is told so (and reminded every 30 s): the bot's own screen actions wait.
  useEffect(() => {
    if (!control) return;
    const hold = () => api("POST", `/bots/${botId}/desktop/control`, { on: true }).catch(() => undefined);
    void hold();
    const timer = window.setInterval(hold, 30_000);
    return () => window.clearInterval(timer);
  }, [control, botId]);
  // The bot asked for the user (ask_takeover): "I'm done" hands the screen back and lets it carry on.
  const takeover = useStore((s) => {
    const rows = s.threads[botId]?.rows ?? [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const b = rows[i].body;
      if (b.kind === "card" && b.card.type === "takeover") return b.card.status === "pending" ? b.card : null;
    }
    return null;
  });
  const finishTakeover = async () => {
    if (!takeover) return;
    flushTyped();
    controlling.current = false;
    try {
      await api("POST", `/bots/${botId}/takeover/${encodeURIComponent(takeover.takeoverId)}/done`);
      closeViewer();
    } catch (e) {
      setError(errText(e));
    }
  };
  // Closing the viewer while in control hands back too. The check waits a tick so a development
  // remount (StrictMode) doesn't count as closing.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.setTimeout(() => {
        if (!mounted.current) handBack();
      }, 0);
    };
  }, [handBack]);

  useDialogFocus(root);
  // Escape closes the viewer only in watch mode and outside full screen: while driving it belongs to the remote desktop,
  // and in full screen the browser uses it to leave full screen.
  useEscape(() => { if (!control && !document.fullscreenElement) closeViewer(); });

  // Opened while the computer sleeps: wake it, once (U-007).
  const wokeOnce = useRef(false);
  useEffect(() => {
    if (wokeOnce.current || !linux || desktop?.open !== false) return;
    wokeOnce.current = true;
    void wakeUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linux, desktop?.open]);
  // A successful reset reconnects the stream (U-007).
  const [liveAttempt, setLiveAttempt] = useState(0);
  const resetScreen = async () => {
    await api("POST", `/bots/${botId}/desktop/tidy`);
    setLiveUp(false);
    setLiveAttempt((n) => n + 1);
  };
  const leaveControl = () => {
    flushTyped();
    // Handing back ends a demonstration under way.
    if (rec?.status === "recording") void teach("stop");
    setControl(false);
    handBack();
  };

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
    ? t("computer.noneTitle")
    : status === "ok"
      ? control
        ? t("viewer.inControl")
        : t("viewer.watching")
      : status === "none"
        ? linux ? t("viewer.asleep") : t("viewer.noDesktop")
        : status === "error"
          ? t("details.unreachable")
          : t("common.connecting");

  return (
    <div
      className="viewer"
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t("viewer.title", { name: bot.name })}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!control && e.target === e.currentTarget) closeViewer();
      }}
    >
      <header className="viewer-bar">
        <BotAvatar bot={bot} size={28} />
        <div className="viewer-title">
          <strong>{t("viewer.title", { name: bot.name })}</strong>
          <span>
            {control && status === "ok" && <span className="dot-inline dot-live" />}
            {statusText}
            {desktop?.url && status === "ok" ? ` · ${desktop.url}` : ""}
          </span>
        </div>
        <IconButton icon="close" label={t("common.close")} onClick={closeViewer} />
      </header>

      <div
        className={`viewer-stage ${control ? "is-control" : ""}`}
        ref={stage}
        tabIndex={control ? 0 : -1}
        onKeyDown={live ? undefined : onKeyDown}
        onWheel={live ? undefined : onWheel}
        onMouseDown={(e) => {
          if (!control && e.target === e.currentTarget) closeViewer();
        }}
        aria-label={control ? t("viewer.remote") : undefined}
      >
        {rec && <RecordingBadge rec={rec} />}
        {rec && (rec.status === "review" || rec.status === "error") && <SkillReview key={rec.id + rec.status} botId={botId} rec={rec} botName={bot.name} />}
        {!engine ? (
          <div className="viewer-empty">
            <Icon name="monitor" size={40} />
            <h3>{t("viewer.noneTitle")}</h3>
            <p>{t("viewer.noneText")}</p>
          </div>
        ) : live ? (
          <>
            <ScreenFrame bot={bot} variant="stage" live={liveUp} control={control} hint={takeover ? t("takeover.bar", { name: bot.name }) : null}
              onTakeControl={() => setControl(true)} onHandBack={leaveControl} onReset={resetScreen}>
              <LiveScreen key={liveAttempt} botId={botId} control={control} label={t("viewer.screenAlt", { name: bot.name })} onConnect={() => setLiveUp(true)} onClose={() => { if (!liveUp) setLiveFailedFor(liveKey); setLiveUp(false); }} />
              {!liveUp && <div className="viewer-empty live-wait"><Spinner size={28} /><p>{t("common.connecting")}</p></div>}
            </ScreenFrame>
          </>
        ) : url ? (
          <img
            ref={img}
            src={url}
            alt={t("viewer.screenAlt", { name: bot.name })}
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
            <h3>{linux ? t("viewer.asleepTitle", { name: bot.name }) : t("viewer.noDesktopTitle")}</h3>
            <p>{linux ? t("viewer.asleepText") : `${t("viewer.noDesktopText", { name: bot.name })} ${t(control ? "viewer.hintControl" : "viewer.hintWatch")}`}</p>
            {linux && <button type="button" className="btn btn-primary" disabled={waking} onClick={wakeUp}>{t(waking ? "viewer.waking" : "viewer.wake")}</button>}
          </div>
        ) : status === "error" ? (
          <div className="viewer-empty">
            <Icon name="alert" size={40} />
            <h3>{t("details.unreachable")}</h3>
            <p>{t("viewer.unreachableText")}</p>
            <button type="button" className="btn" onClick={refresh}>{t("viewer.retry")}</button>
          </div>
        ) : (
          <div className="viewer-empty">
            <Spinner size={28} />
            <p>{t("common.connecting")}</p>
          </div>
        )}
      </div>

      {engine && (
        <footer className="viewer-foot">
          {control ? (
            <>
              {!live && <form className="viewer-url" onSubmit={go}>
                <label className="sr-only" htmlFor="viewer-url">{t("viewer.address")}</label>
                <input id="viewer-url" className="input input-small" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("viewer.addressPlaceholder")} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
                <button type="submit" className="btn btn-small" disabled={!address.trim()}>{t("viewer.go")}</button>
              </form>}
              {rec?.status === "recording" ? (
                <form className="teach-stop" onSubmit={(e) => { e.preventDefault(); void teach("stop"); }}>
                  <label className="sr-only" htmlFor="teach-note">{t("teach.note")}</label>
                  <input id="teach-note" className="input input-small" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("teach.note")} maxLength={2000} />
                  <button type="submit" className="btn btn-small btn-danger"><Icon name="stop" size={12} /> {t("teach.stop")}</button>
                </form>
              ) : (
                <>
                  <span className="viewer-hint">{t("viewer.controlHint")}</span>
                  {status === "ok" && !rec && (
                    <button type="button" className="btn btn-small" onClick={() => void teach("start")} title={t("teach.startHint")}>
                      <Icon name="record" size={14} className="rec-icon" /> {t("teach.start")}
                    </button>
                  )}
                </>
              )}
              {teachError && <span className="viewer-error" role="alert">{teachError}</span>}
              {takeover && (
                <button type="button" className="btn btn-small btn-accent" onClick={() => void finishTakeover()}>
                  <Icon name="check" size={14} /> {t("takeover.done")}
                </button>
              )}
              {!live && (
                <button type="button" className={`btn btn-small ${takeover ? "" : "btn-primary"}`} onClick={leaveControl}>
                  {t("viewer.handBack")}
                </button>
              )}
            </>
          ) : (
            <>
              <span className="viewer-hint">
                <Icon name="eye" size={15} /> {t("viewer.watchingHint", { name: bot.name })}
              </span>
              <button type="button" className="btn btn-small btn-primary" onClick={() => setControl(true)}>
                <Icon name="cursor" size={14} /> {t("viewer.take")}
              </button>
            </>
          )}
          {error && <span className="viewer-error" role="alert">{error}</span>}
        </footer>
      )}
      {engine && control && !live && (
        <div className="viewer-control-bar" role="status">
          <span className="dot-inline dot-live" />
          {takeover ? t("takeover.bar", { name: bot.name }) : t("viewer.controlBar", { name: bot.name })}
        </div>
      )}
      {engine && !control && takeover && (
        <div className="viewer-control-bar is-ask" role="status">
          <Icon name="hand" size={14} /> {t("takeover.title", { name: bot.name })}
        </div>
      )}
    </div>
  );
}
