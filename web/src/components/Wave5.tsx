import { useEffect, useId, useMemo, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { relTime } from "../lib/format";
import type { Bot, Card, Grant, MemorySettings, ModelOption, NudgeSettings, Rule, RulesState, SensitiveCategory } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, ErrorNote, Loading, Toggle } from "./ui";

/* ---------- Shared bits ---------- */

/** What allowed a state-changing step: the user's quote, the reviewer's reason, a card, a retry. */
export function GrantLine({ grant }: { grant: Grant }) {
  const t = useT();
  return (
    <span className={`step-grant is-${grant.by}`}>
      <Icon name={grant.by === "reviewer" ? "shield" : grant.by === "words" ? "chat" : "check"} size={12} />
      {grant.by === "words" && grant.quote ? <span>{t("grant.words", { quote: grant.quote })}</span>
        : grant.by === "reviewer" ? <span>{t("grant.reviewer", { reason: grant.reason ?? "" })}{grant.quote ? ` · ${t("grant.words", { quote: grant.quote })}` : ""}</span>
        : grant.by === "approval" ? <span>{t("grant.approval")}</span>
        : <span>{t("grant.retry")}</span>}
    </span>
  );
}

function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  return { busy, error, run, setError };
}

/* ---------- Cards ---------- */

type UncertainCard = Extract<Card, { type: "uncertain" }>;
type TaskCard = Extract<Card, { type: "task" }>;
type NudgeCard = Extract<Card, { type: "nudge" }>;

/** An action whose outcome is unknown: never replayed on its own; the user says what to do. */
export function Uncertain({ card }: { card: UncertainCard }) {
  const t = useT();
  const { busy, error, run } = useBusy();
  const act = (action: "done" | "check" | "retry") => run(action, () => api("POST", `/executions/${enc(card.executionId)}`, { action }));
  const pending = card.status === "pending";
  return (
    <div className={`card uncertain-card ${pending ? "is-pending" : ""}`}>
      <div className="card-head">
        <span className="logo-tile is-warn" aria-hidden="true"><Icon name="alert" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("uncertain.title")}</p>
          <p className="card-sub">{card.title}</p>
        </div>
      </div>
      {card.detail && <pre className="card-detail">{card.detail}</pre>}
      {pending ? (
        <>
          <p className="card-reason">{t("uncertain.hint")}</p>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void act("retry")}>{t(busy === "retry" ? "common.working" : "uncertain.retry")}</button>
            <span className="spacer" />
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void act("check")}><Icon name="search" size={14} /> {t(busy === "check" ? "common.working" : "uncertain.check")}</button>
            <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => void act("done")}><Icon name="check" size={14} /> {t(busy === "done" ? "common.working" : "uncertain.done")}</button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      ) : (
        <p className={`card-outcome is-${card.status === "done" ? "allowed" : "denied"}`}>
          <Icon name={card.status === "done" ? "check" : card.status === "checking" ? "search" : card.status === "retried" ? "refresh" : "close"} size={14} />
          {t(`uncertain.status.${card.status}` as Key)}
        </p>
      )}
    </div>
  );
}

const TASK_ICON: Record<TaskCard["state"], "refresh" | "hand" | "check" | "alert" | "stop"> = { running: "refresh", waiting: "hand", done: "check", failed: "alert", stopped: "stop" };

/** A background task: state, live step counter, Stop, replies routed to the task, its approval answered here. */
export function TaskCardView({ card, botId }: { card: TaskCard; botId: string }) {
  const t = useT();
  const live = useStore((s) => s.live[card.helperId]);
  const [reply, setReply] = useState("");
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useBusy();
  const running = card.state === "running";
  const steps = card.steps + (running ? live?.steps ?? 0 : 0);
  const now = running ? (live?.caption || (live?.activity ? t((live.activity.kind === "thinking" ? "activity.thinking.0" : `activity.${live.activity.kind}`) as Key) : "")) : "";
  const send = () => run("reply", async () => { await api("POST", `/bots/${enc(botId)}/bgtasks/${enc(card.taskId)}/reply`, { text: reply.trim() }); setReply(""); });
  const decide = (decision: "allow" | "deny") => run(decision, () => api("POST", `/approvals/${enc(card.approval!.approvalId)}`, { decision }));
  return (
    <div className={`card task-card is-${card.state}`}>
      <div className="card-head">
        <span className={`logo-tile is-task is-${card.state}`} aria-hidden="true"><Icon name={TASK_ICON[card.state]} size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{card.title}</p>
          <p className="card-sub">
            <span className={`chip task-state is-${card.state}`}>{t(`task.state.${card.state}` as Key)}</span>
            {" "}<span className="task-steps">{t("task.steps", { n: steps })}</span>
          </p>
        </div>
        <span className="spacer" />
        {(running || card.state === "waiting") && (
          <button type="button" className="btn btn-small btn-ghost-danger" disabled={busy !== null} onClick={() => void run("stop", () => api("POST", `/bots/${enc(botId)}/bgtasks/${enc(card.taskId)}/stop`))}>
            <Icon name="stop" size={13} /> {t(busy === "stop" ? "common.working" : "task.stop")}
          </button>
        )}
      </div>
      {running && now && <p className="task-now"><span className="dot-inline dot-step-running" /> {now}</p>}
      {card.approval && (
        <div className="task-approval">
          <p className="card-title small">{card.approval.title}</p>
          {card.approval.detail && <pre className="card-detail">{card.approval.detail}</pre>}
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void decide("deny")}>{t("approval.deny")}</button>
            <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => void decide("allow")}>{t("approval.allow")}</button>
          </div>
        </div>
      )}
      {card.question && <p className="card-reason task-question"><Icon name="hand" size={13} /> {card.question}</p>}
      {card.result && (
        <div className={`task-result ${open ? "is-open" : ""}`}>
          <p>{card.result}</p>
          {card.result.length > 280 && <button type="button" className="link" onClick={() => setOpen((v) => !v)}>{t(open ? "task.less" : "task.more")}</button>}
        </div>
      )}
      <form className="task-reply" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) void send(); }}>
        <input className="input input-small" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t(card.state === "done" || card.state === "stopped" || card.state === "failed" ? "task.resumePlaceholder" : "task.replyPlaceholder")} aria-label={t("task.replyLabel", { title: card.title })} maxLength={4000} />
        <button type="submit" className="icon-btn" disabled={!reply.trim() || busy !== null} aria-label={t("task.send")}><Icon name="send" size={15} /></button>
      </form>
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

/** A nudge from a quiet preparation pass: do it, later, never for this. */
export function NudgeCardView({ card, botId }: { card: NudgeCard; botId: string }) {
  const t = useT();
  const { busy, error, run } = useBusy();
  const act = (action: "do" | "later" | "never") => run(action, () => api("POST", `/bots/${enc(botId)}/nudges/${enc(card.nudgeId)}`, { action }));
  const pending = card.status === "pending";
  return (
    <div className={`card nudge-card ${pending ? "is-pending" : ""}`}>
      <div className="card-head">
        <span className="logo-tile is-nudge" aria-hidden="true"><Icon name="bulb" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{card.title}</p>
          <p className="card-sub">{t("nudge.sub")}</p>
        </div>
      </div>
      <p className="card-reason">{card.body}</p>
      {pending ? (
        <>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void act("never")}>{t("nudge.never")}</button>
            <span className="spacer" />
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void act("later")}><Icon name="clock" size={14} /> {t("nudge.later")}</button>
            <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => void act("do")}><Icon name="bolt" size={14} /> {t(busy === "do" ? "common.working" : "nudge.do")}</button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      ) : (
        <p className={`card-outcome is-${card.status === "doing" ? "allowed" : "denied"}`}>
          <Icon name={card.status === "doing" ? "check" : card.status === "later" ? "clock" : "close"} size={14} />
          {t(`nudge.status.${card.status}` as Key)}
        </p>
      )}
    </div>
  );
}

/* ---------- Settings → Rules ---------- */

function useModels(): ModelOption[] {
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => { api<{ models: ModelOption[] }>("GET", "/models").then((r) => setModels(r.models ?? []), () => undefined); }, []);
  return models;
}

function RuleList({ rules, onChange }: { rules: Rule[]; onChange: () => void }) {
  const t = useT();
  const { error, run } = useBusy();
  if (!rules.length) return <p className="muted small">{t("rules.none")}</p>;
  return (
    <>
      <ul className="list">
        {rules.map((r) => (
          <li key={r.id} className="list-row is-card">
            <div className="list-row-text">
              <span className={`rule-text ${r.enabled ? "" : "is-off"}`}>« {r.text} »</span>
              <span className="list-row-sub">{relTime(r.createdAt)}</span>
            </div>
            <Toggle checked={r.enabled} label={t("rules.enabled")} onChange={(on) => void run("t", async () => { await api("PATCH", `/rules/${enc(r.id)}`, { enabled: on }); onChange(); })} />
            <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("rules.remove")} confirmLabel={t("common.confirmDelete")} onConfirm={async () => { await api("DELETE", `/rules/${enc(r.id)}`); onChange(); }} />
          </li>
        ))}
      </ul>
      <ErrorNote>{error}</ErrorNote>
    </>
  );
}

function AddRule({ botId, onAdded }: { botId: string | null; onAdded: () => void }) {
  const t = useT();
  const uid = useId();
  const [text, setText] = useState("");
  const { busy, error, run } = useBusy();
  return (
    <form className="rule-add" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void run("add", async () => { await api("POST", "/rules", { text: text.trim(), botId }); setText(""); onAdded(); }); }}>
      <label className="sr-only" htmlFor={uid}>{t("rules.addLabel")}</label>
      <div className="field-inline">
        <input id={uid} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("rules.placeholder")} maxLength={500} />
        <button type="submit" className="btn btn-primary btn-small" disabled={busy !== null || !text.trim()}><Icon name="plus" size={14} /> {t("rules.add")}</button>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}

export function RulesSection() {
  const t = useT();
  const tick = useStore((s) => s.rulesTick);
  const bots = useStore((s) => s.bots);
  const models = useModels();
  const [state, setState] = useState<RulesState | null>(null);
  const { error, run, setError } = useBusy();
  const load = () => api<RulesState>("GET", "/rules").then(setState, (e) => setError(errText(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [tick]);
  const account = state?.rules.filter((r) => !r.botId) ?? [];
  const perBot = useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of state?.rules ?? []) if (r.botId) m.set(r.botId, [...(m.get(r.botId) ?? []), r]);
    return [...m.entries()];
  }, [state]);
  const autoBots = Object.values(bots).filter((b) => b.kind === "agent" && b.autonomy === "auto");
  return (
    <>
      <h2>{t("settings.section.rules")}</h2>
      <p className="muted">{t("rules.intro")}</p>
      <ErrorNote>{error}</ErrorNote>
      {!state ? <Loading /> : (
        <>
          <h3 className="pane-heading">{t("rules.account")}</h3>
          <RuleList rules={account} onChange={() => void load()} />
          <AddRule botId={null} onAdded={() => void load()} />
          <p className="muted small rule-tips note-line"><Icon name="bulb" size={13} /> <span>{t("rules.tips")}</span></p>
          {perBot.length > 0 && <h3 className="pane-heading">{t("rules.perBot")}</h3>}
          {perBot.map(([botId, list]) => (
            <div key={botId} className="rule-bot">
              <p className="action-title">{bots[botId]?.name ?? "—"}</p>
              <RuleList rules={list} onChange={() => void load()} />
            </div>
          ))}

          <h3 className="pane-heading">{t("rules.reviewer")}</h3>
          <p className="muted small">{t("rules.reviewerIntro")}</p>
          <div className="field-inline">
            <select className="input" value={state.reviewerModel} onChange={(e) => void run("model", async () => setState(await api<RulesState>("PUT", "/rules/reviewer", { model: e.target.value })))} aria-label={t("rules.reviewerModel")}>
              <option value="">{state.auxModel ? t("rules.reviewerAux", { model: state.auxModel }) : t("rules.reviewerBot")}</option>
              {models.filter((m) => m.kind === "api").map((m) => <option key={m.ref} value={m.ref}>{m.ref}</option>)}
            </select>
          </div>
          <div className="floor-box">
            <p className="action-title"><Icon name="shield" size={14} /> {t("rules.floorTitle")}</p>
            <ul className="floor-list">
              {(["rules.floor.pay", "rules.floor.delete", "rules.floor.newRecipient", "rules.floor.computer", "rules.floor.unavailable"] as Key[]).map((k) => <li key={k}>{t(k)}</li>)}
            </ul>
          </div>
          <p className="muted small">{autoBots.length ? t("rules.autoBots", { names: autoBots.map((b) => b.name).join(", ") }) : t("rules.noAutoBots")}</p>
        </>
      )}
    </>
  );
}

/** In a bot's settings: its own rules and its proactive nudges. */
export function BotRulesAndNudges({ bot }: { bot: Bot }) {
  const t = useT();
  const tick = useStore((s) => s.rulesTick);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [stats, setStats] = useState<{ spentUsd: number; raised: number; passes: number; lastPassAt: number | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useBusy();
  const load = () => api<RulesState>("GET", "/rules").then((s) => setRules(s.rules.filter((r) => r.botId === bot.id)), () => undefined);
  const loadNudges = () => api<{ stats: typeof stats }>("GET", `/bots/${enc(bot.id)}/nudges`).then((r) => setStats(r.stats), () => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); void loadNudges(); }, [tick, bot.id]);
  const n = bot.nudges;
  const save = (patch: Partial<NudgeSettings>) => run("save", async () => {
    const r = await api<{ bot: Bot }>("PATCH", `/bots/${enc(bot.id)}`, { nudges: { ...n, ...patch } });
    useStore.getState().upsertBot(r.bot);
  });
  const tryNow = () => run("try", async () => {
    const r = await api<{ result: { status: string; title?: string; reason?: string } }>("POST", `/bots/${enc(bot.id)}/nudges/run`);
    setNote(r.result.status === "raised" ? t("nudges.raised", { title: r.result.title ?? "" }) : t("nudges.nothing", { reason: r.result.reason ?? "" }));
    void loadNudges();
  });
  return (
    <>
      <div className="field">
        <span className="field-label">{t("rules.botHeading", { name: bot.name })}</span>
        <p className="field-hint">{t("rules.botHint")}</p>
        {rules ? <RuleList rules={rules} onChange={() => void load()} /> : <Loading />}
        <AddRule botId={bot.id} onAdded={() => void load()} />
      </div>
      <div className="field nudges-field">
        <div className="action-row">
          <div>
            <p className="action-title">{t("nudges.title")}</p>
            <p className="muted small">{t("nudges.hint", { name: bot.name })}</p>
          </div>
          <Toggle checked={n.enabled} label={t("nudges.title")} onChange={(on) => void save({ enabled: on })} />
        </div>
        {n.enabled && (
          <div className="nudge-settings">
            <label><span className="field-label">{t("nudges.perDay")}</span>
              <input type="number" className="input input-small" min={1} max={10} value={n.perDay} onChange={(e) => void save({ perDay: Number(e.target.value) })} /></label>
            <label><span className="field-label">{t("nudges.budget")}</span>
              <input type="number" className="input input-small" min={0.01} max={5} step={0.05} value={n.budgetUsd} onChange={(e) => void save({ budgetUsd: Number(e.target.value) })} /></label>
            <label><span className="field-label">{t("nudges.every")}</span>
              <select className="input input-small" value={n.everyMin} onChange={(e) => void save({ everyMin: Number(e.target.value) })}>
                {[30, 60, 120, 240, 720].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
              </select></label>
          </div>
        )}
        <p className="muted small">
          {t("nudges.quiet")}{stats ? ` · ${t("nudges.today", { raised: stats.raised, spent: stats.spentUsd.toFixed(3) })}` : ""}{" "}
          <button type="button" className="link" disabled={busy !== null} onClick={() => void tryNow()}>{t(busy === "try" ? "common.working" : "nudges.tryNow")}</button>
        </p>
        {note && <p className="muted small" role="status">{note}</p>}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </>
  );
}

/* ---------- Settings → Memory ---------- */

const CATEGORIES: SensitiveCategory[] = ["health", "religion", "politics", "sexuality", "origin", "location", "financial", "legal"];

interface Candidate { text: string; skip: "duplicate" | "secret" | "sensitive" | "empty" | null; category: SensitiveCategory | null }

function ImportExport() {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const agents = Object.values(bots).filter((b) => b.kind === "agent");
  const [botId, setBotId] = useState(agents.find((b) => b.primary)?.id ?? agents[0]?.id ?? "");
  const [text, setText] = useState("");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useBusy();
  const preview = () => run("preview", async () => {
    const r = await api<{ candidates: Candidate[] }>("POST", `/bots/${enc(botId)}/memories/import`, { text });
    setCands(r.candidates.filter((c) => c.skip !== "empty"));
    setChosen(new Set(r.candidates.filter((c) => c.skip === null).map((c) => c.text)));
    setDone(null);
  });
  const commit = () => run("commit", async () => {
    const r = await api<{ imported: number; skipped: number }>("POST", `/bots/${enc(botId)}/memories/import`, { text, commit: true, chosen: [...chosen], allowSensitive: true });
    setDone(t("memset.imported", { n: r.imported, skipped: r.skipped }));
    setCands(null);
    setText("");
  });
  if (!agents.length) return null;
  return (
    <div className="import-export">
      <div className="field-inline">
        <select className="input" value={botId} onChange={(e) => { setBotId(e.target.value); setCands(null); }} aria-label={t("memset.whichBot")}>
          {agents.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <a className="btn btn-small" href={`/api/bots/${enc(botId)}/memories/export?format=md`} download><Icon name="download" size={14} /> Markdown</a>
        <a className="btn btn-small" href={`/api/bots/${enc(botId)}/memories/export?format=json`} download><Icon name="download" size={14} /> JSON</a>
      </div>
      <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("memset.importPlaceholder")} aria-label={t("memset.importLabel")} />
      <div className="row-end">
        {done && <span className="muted small" role="status">{done}</span>}
        <button type="button" className="btn btn-small" disabled={busy !== null || !text.trim()} onClick={() => void preview()}><Icon name="upload" size={14} /> {t(busy === "preview" ? "common.working" : "memset.preview")}</button>
      </div>
      {cands && (
        <>
          <ul className="check-list import-list" role="group" aria-label={t("memset.candidates")}>
            {cands.map((c) => {
              const on = chosen.has(c.text);
              const locked = c.skip === "secret" || c.skip === "duplicate";
              return (
                <li key={c.text}>
                  <button type="button" role="checkbox" aria-checked={on} disabled={locked} className={`check-row ${on ? "is-selected" : ""}`} onClick={() => setChosen((s) => { const n = new Set(s); if (n.has(c.text)) n.delete(c.text); else n.add(c.text); return n; })}>
                    <span className="check-box">{on && <Icon name="check" size={12} />}</span>
                    <span className="check-text">{c.text}</span>
                    {c.skip && <span className={`chip ${c.skip === "secret" ? "state-error" : ""}`}>{t(`memset.skip.${c.skip}` as Key)}{c.category ? ` · ${t(`memset.cat.${c.category}` as Key)}` : ""}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="row-end"><button type="button" className="btn btn-primary btn-small" disabled={busy !== null || !chosen.size} onClick={() => void commit()}>{t("memset.importN", { n: chosen.size })}</button></div>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

export function MemorySettingsSection() {
  const t = useT();
  const tick = useStore((s) => s.memorySettingsTick);
  const [s, setS] = useState<MemorySettings | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run, setError } = useBusy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { api<{ settings: MemorySettings }>("GET", "/memory-settings").then((r) => setS(r.settings), (e) => setError(errText(e))); }, [tick]);
  const save = (patch: Record<string, unknown>) => run("save", async () => setS((await api<{ settings: MemorySettings }>("PUT", "/memory-settings", patch)).settings));
  const learn = () => run("learn", async () => {
    const r = await api<{ settings: MemorySettings; source: string; samples: number }>("POST", "/memory-settings/style/learn");
    setS(r.settings);
    setNote(t(r.source === "mail" ? "memset.learnedMail" : "memset.learnedChat", { n: r.samples }));
  });
  return (
    <>
      <h2>{t("settings.section.memory")}</h2>
      <p className="muted">{t("memset.intro")}</p>
      <ErrorNote>{error}</ErrorNote>
      {!s ? <Loading /> : (
        <>
          <div className="action-row">
            <div>
              <p className="action-title">{t("memset.auto")}</p>
              <p className="muted small">{t("memset.autoHint")}</p>
            </div>
            <Toggle checked={s.autoCapture} label={t("memset.auto")} onChange={(on) => void save({ autoCapture: on })} />
          </div>

          <h3 className="pane-heading">{t("memset.sensitive")}</h3>
          <p className="muted small">{t("memset.sensitiveHint")}</p>
          <ul className="list sensitive-list">
            {CATEGORIES.map((c) => (
              <li key={c} className="list-row">
                <div className="list-row-text">
                  <span className="list-row-title">{t(`memset.cat.${c}` as Key)} {!s.allowSensitive[c] && <span className="chip chip-quiet">{t("memset.excluded")}</span>}</span>
                </div>
                <Toggle checked={s.allowSensitive[c]} label={t("memset.allowCat", { cat: t(`memset.cat.${c}` as Key) })} onChange={(on) => void save({ allowSensitive: { [c]: on } })} />
              </li>
            ))}
          </ul>
          <p className="muted small note-line"><Icon name="lock" size={13} /> <span>{t("memset.secretsNever")}</span></p>

          <h3 className="pane-heading">{t("memset.style")}</h3>
          <div className="action-row">
            <div>
              <p className="action-title">{t("memset.styleTitle")}</p>
              <p className="muted small">{t("memset.styleHint")}</p>
            </div>
            <Toggle checked={s.style.enabled} label={t("memset.styleTitle")} onChange={(on) => void save({ style: { enabled: on } })} />
          </div>
          {s.style.enabled && (
            <div className="style-box">
              {s.style.profile ? (
                <>
                  <pre className="style-profile">{s.style.profile}</pre>
                  <p className="muted small">{t("memset.styleFrom", { n: s.style.samples, source: t(s.style.source === "mail" ? "memset.sourceMail" : "memset.sourceChat"), when: s.style.updatedAt ? relTime(s.style.updatedAt) : "—" })}</p>
                </>
              ) : <p className="muted small">{t("memset.styleEmpty")}</p>}
              <div className="row-end">
                {s.style.profile && <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void save({ style: { clear: true } })}>{t("memset.styleClear")}</button>}
                <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void learn()}><Icon name="refresh" size={14} /> {t(busy === "learn" ? "memset.learning" : s.style.profile ? "memset.relearn" : "memset.learn")}</button>
              </div>
              {note && <p className="muted small" role="status">{note}</p>}
            </div>
          )}

          <h3 className="pane-heading">{t("memset.importExport")}</h3>
          <p className="muted small">{t("memset.importHint")}</p>
          <ImportExport />
        </>
      )}
    </>
  );
}
