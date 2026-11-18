import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, errText } from "../api";
import { t as tNow, useT, type Key } from "../i18n";
import { ENGINE_BRAND, ENGINE_TOOL, engineOf, engineOfRef, prettyModel } from "../lib/engines";
import { useStore } from "../store";
import type { Bot, Engine, EngineRuntime, EngineStatus, ModelOption } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote } from "./ui";

/** How often the status is re-checked while the user signs in, and for how long. */
const POLL_MS = 5000;
const WAIT_MAX_MS = 5 * 60 * 1000;

interface Card { ref: string; title: string; text: string }

function Cards({ label, value, cards, onChange }: { label: string; value: string; cards: Card[]; onChange: (ref: string) => void }) {
  return (
    <div className="choice-grid" role="radiogroup" aria-label={label}>
      {cards.map((c) => (
        <button key={c.ref || "default"} type="button" role="radio" aria-checked={value === c.ref} className={`choice ${value === c.ref ? "is-selected" : ""}`} onClick={() => onChange(c.ref)}>
          <span className="choice-title">{c.title}</span>
          <span className="choice-text">{c.text}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The "Brain" block of a bot's General settings: server default, the user's subscriptions
 * (run through the provider's own tool on the bot's computer) and the API models of the server.
 */
export function BrainPicker({ bot, value, onChange, models }: {
  bot: Bot;
  value: string;
  onChange: (ref: string) => void;
  models: { models: ModelOption[]; defaultRef: string } | null;
}) {
  const t = useT();
  const list = models?.models ?? [];
  const subscriptionOf = (m: Pick<ModelOption, "ref" | "kind" | "engine">) => m.kind === "subscription" || engineOf(m) !== null;
  const subs = list.filter(subscriptionOf);
  const apis = list.filter((m) => !subscriptionOf(m));
  // A ref the server no longer lists (still set on the bot): kept visible in its group.
  const orphan = [bot.model, value].find((r) => r && !list.some((m) => m.ref === r)) ?? "";
  const orphanEngine = orphan ? engineOfRef(orphan) : null;

  const subCard = (m: Pick<ModelOption, "ref" | "model" | "engine">): Card => {
    const engine = engineOf(m) ?? "claude-code";
    const name = m.model || m.ref.slice(m.ref.indexOf(":") + 1);
    return { ref: m.ref, title: `${ENGINE_BRAND[engine]} — ${prettyModel(name)}`, text: t("brain.subscriptionText", { tool: ENGINE_TOOL[engine] }) };
  };
  const subCards = subs.map(subCard);
  const apiCards: Card[] = apis.map((m) => ({ ref: m.ref, title: m.model, text: m.provider || t("brain.apiText") }));
  if (orphan) {
    if (orphanEngine) subCards.unshift({ ...subCard({ ref: orphan, model: "", engine: orphanEngine }), text: t("brain.current") });
    else apiCards.unshift({ ref: orphan, title: orphan, text: t("brain.current") });
  }
  const defaultCard: Card = {
    ref: "",
    title: t("bot.serverDefault"),
    text: models?.defaultRef ? t("brain.defaultText", { ref: models.defaultRef }) : t("brain.defaultTextNone"),
  };
  const engine = engineOfRef(value);

  return (
    <div className="field brain">
      <span className="field-label">{t("brain.heading")}</span>
      <p className="field-hint">{t("brain.intro", { name: bot.name })}</p>
      <Cards label={t("bot.serverDefault")} value={value} cards={[defaultCard]} onChange={onChange} />

      {subCards.length > 0 && (
        <>
          <span className="brain-group">{t("brain.subscriptions")}</span>
          <Cards label={t("brain.subscriptions")} value={value} cards={subCards} onChange={onChange} />
          <p className="field-hint">{t("brain.subscriptionNote", { name: bot.name })}</p>
          {engine && <EngineStatusBox key={engine} bot={bot} engine={engine} />}
        </>
      )}

      {apiCards.length > 0 && (
        <>
          <span className="brain-group">{t("brain.api")}</span>
          <Cards label={t("brain.api")} value={value} cards={apiCards} onChange={onChange} />
        </>
      )}
    </div>
  );
}

/** Whether the subscription tool is on the bot's computer and signed in; sign-in and sign-out. */
function EngineStatusBox({ bot, engine }: { bot: Bot; engine: Engine }) {
  const t = useT();
  const { openViewer } = useStore.getState();
  const tool = ENGINE_TOOL[engine];
  const [status, setStatus] = useState<EngineStatus | null | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"login" | "wake" | null>(null);
  /** When the user started signing in; the status is polled until it says signed in. */
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [waitStopped, setWaitStopped] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);
  /** The engine's state (B-4): ready, working, starting, error or stopped; and the restart under way. */
  const [runtime, setRuntime] = useState<EngineRuntime | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = useCallback(async () => {
    const mine = ++seq.current;
    setChecking(true);
    try {
      const r = await api<{ engines: EngineStatus[]; runtime?: EngineRuntime }>("GET", `/bots/${bot.id}/engine`);
      if (!alive.current || mine !== seq.current) return;
      setStatus(r.engines.find((e) => e.engine === engine) ?? null);
      if (r.runtime) setRuntime(r.runtime);
      setError(null);
    } catch (e) {
      if (alive.current && mine === seq.current) setError(tNow("engine.checkFailed", { error: errText(e) }));
    } finally {
      if (alive.current && mine === seq.current) setChecking(false);
    }
  }, [bot.id, engine]);

  useEffect(() => {
    void check();
  }, [check]);

  // While the engine starts again, its state is refreshed quietly every 3 s until it is ready (or failed).
  useEffect(() => {
    if (runtime?.status !== "starting") return;
    const timer = window.setInterval(async () => {
      try {
        const r = await api<{ runtime: EngineRuntime }>("GET", `/bots/${bot.id}/engine?runtime=1`);
        if (alive.current) setRuntime(r.runtime);
      } catch { /* the next tick tries again */ }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [runtime?.status, bot.id]);

  const restart = async () => {
    setRestarting(true);
    setRestartError(null);
    try {
      const r = await api<{ runtime: EngineRuntime }>("POST", `/bots/${bot.id}/engine/restart`);
      if (alive.current) setRuntime(r.runtime);
    } catch (e) {
      if (alive.current) setRestartError(tNow("engine.restartFailed", { error: errText(e) }));
    } finally {
      if (alive.current) setRestarting(false);
    }
  };

  // Signed in: stop waiting.
  useEffect(() => {
    if (status?.signedIn) setWaitingSince(null);
  }, [status]);

  // While waiting for the sign-in: re-check every 5 s, for at most 5 minutes.
  useEffect(() => {
    if (waitingSince === null) return;
    const timer = window.setInterval(() => {
      if (Date.now() - waitingSince > WAIT_MAX_MS) {
        setWaitingSince(null);
        setWaitStopped(true);
        return;
      }
      void check();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waitingSince, check]);

  // Re-check when the viewer on this bot's screen closes.
  const viewerOpen = useStore((s) => s.viewerBotId === bot.id);
  const wasOpen = useRef(viewerOpen);
  useEffect(() => {
    if (wasOpen.current && !viewerOpen) void check();
    wasOpen.current = viewerOpen;
  }, [viewerOpen, check]);

  const signIn = async () => {
    setBusy("login");
    setError(null);
    try {
      await api("POST", `/bots/${bot.id}/engine/login`, { engine });
      if (!alive.current) return;
      setWaitStopped(false);
      setWaitingSince(Date.now());
      openViewer(bot.id, { control: true });
    } catch (e) {
      if (alive.current) setError(errText(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const wake = async () => {
    setBusy("wake");
    setError(null);
    try {
      await api("POST", `/bots/${bot.id}/desktop/wake`);
    } catch (e) {
      if (alive.current) setError(errText(e));
    }
    if (!alive.current) return;
    setBusy(null);
    await check();
  };

  const signOut = async () => {
    setError(null);
    try {
      await api("POST", `/bots/${bot.id}/engine/logout`, { engine });
    } catch (e) {
      if (alive.current) setError(errText(e));
    }
    if (alive.current) await check();
  };

  let body: ReactNode;
  if (status === undefined) {
    body = error ? null : <p className="muted small" role="status">{t("engine.checking", { tool, name: bot.name })}</p>;
  } else if (status === null || !status.installed) {
    body = (
      <div className="callout is-warn">
        <Icon name="alert" size={16} />
        <span>{t("engine.notInstalled", { tool, name: bot.name })}</span>
      </div>
    );
  } else if (status.signedIn === null) {
    body = (
      <div className="engine-row">
        <span className="muted small">{t("engine.asleep")}</span>
        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void wake()}>
          {busy === "wake" ? t("common.working") : t("computer.wake")}
        </button>
      </div>
    );
  } else if (status.signedIn) {
    body = (
      <div className="engine-row">
        <span className="engine-ok">
          <Icon name="check" size={14} />
          {status.account ? t("engine.signedInAs", { account: status.account }) : t("engine.signedIn")}
        </span>
        <ConfirmButton label={t("engine.signOut")} confirmLabel={t("engine.signOutConfirm")} busyLabel={t("engine.signingOut")} className="btn btn-ghost btn-small" onConfirm={signOut} />
      </div>
    );
  } else {
    body = (
      <>
        {waitingSince === null && <p className="small">{t("engine.notSignedIn", { tool, name: bot.name })}</p>}
        <div className="row-gap engine-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={busy !== null} onClick={() => void signIn()}>
            <Icon name="key" size={14} /> {busy === "login" ? t("engine.signingIn") : t("engine.signIn", { name: bot.name })}
          </button>
          {waitingSince !== null && (
            <button type="button" className="btn btn-small" onClick={() => openViewer(bot.id, { control: true })}>
              <Icon name="monitor" size={14} /> {t("engine.openScreen")}
            </button>
          )}
        </div>
        {waitingSince !== null && (
          <div className="engine-wait" role="status">
            <Icon name="info" size={16} />
            <span>
              {t("engine.waitHint")} <span className="muted">{t("engine.waiting")}</span>
            </span>
          </div>
        )}
        {waitStopped && (
          <div className="engine-row">
            <span className="muted small">{t("engine.waitStopped")}</span>
            <button type="button" className="btn btn-small" disabled={checking} onClick={() => void check()}>{t("engine.checkAgain")}</button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="engine-box" aria-busy={checking}>
      <div className="engine-head">
        <span className="choice-title">{t("engine.heading", { tool })}</span>
        {status !== undefined && (
          <button type="button" className="btn btn-ghost btn-small" disabled={checking} onClick={() => void check()} aria-label={t("engine.checkAgain")} title={t("engine.checkAgain")}>
            <Icon name="refresh" size={14} />
          </button>
        )}
      </div>
      {body}
      <ErrorNote>{error}</ErrorNote>
      {error && status === undefined && (
        <button type="button" className="btn btn-small" disabled={checking} onClick={() => void check()}>{t("common.tryAgain")}</button>
      )}
      {runtime && (
        <div className={`engine-foot is-${runtime.status}`}>
          <span className="engine-state">
            <span className={`dot-inline engine-dot is-${runtime.status}`} />
            <span className="truncate">{[tool, runtime.model || "default", t(`engine.state.${runtime.status}` as Key)].join(" · ")}</span>
          </span>
          <button type="button" className={`btn btn-small ${runtime.status === "error" || runtime.status === "stopped" ? "btn-primary" : "btn-ghost"}`} disabled={restarting || runtime.status === "starting"} onClick={() => void restart()} title={t("engine.restartHint")}>
            <Icon name="refresh" size={13} /> {t(restarting || runtime.status === "starting" ? "engine.restarting" : "engine.restart")}
          </button>
        </div>
      )}
      {runtime?.status === "error" && runtime.error && <p className="engine-error small" role="alert">{runtime.error}</p>}
      {restartError && <p className="engine-error small" role="alert">{restartError}</p>}
    </div>
  );
}

/** A small "subscription" chip for a bot whose model runs on the user's own plan. */
export function SubscriptionBadge({ model }: { model: string }) {
  const t = useT();
  const engine = engineOfRef(model);
  if (!engine) return null;
  return (
    <span className="chip sub-badge" title={t("badge.subscriptionTitle", { brand: ENGINE_BRAND[engine], tool: ENGINE_TOOL[engine] })}>
      <Icon name="key" size={11} /> {ENGINE_BRAND[engine]} · {model.endsWith(":default") ? t("badge.subscription") : prettyModel(model.slice(model.indexOf(":") + 1))}
    </span>
  );
}
