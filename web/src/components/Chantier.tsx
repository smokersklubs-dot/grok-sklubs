import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { api, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import type {
  ChantierAttempt, ChantierDecision, ChantierLesson, ChantierPlan, ChantierStatus, ChantierSummary, ChantierTask, ChantierView,
  CheckResult, DecisionAnswer, PlanTask, TaskState,
} from "../../../server/src/chantiertypes";
import { ARTICLE_CARDS_BRIEF, ARTICLE_CARDS_TITLE } from "../../../server/src/chantierexample";
import { duration, fromLines, graphLayout, NODE_H, NODE_W, openChantiers, STATE_TONE, toLines, useChantiers } from "../lib/chantiers";
import { money, relTime } from "../lib/format";
import { Icon } from "./Icon";
import { Empty, ErrorNote, Loading, Modal, useTick } from "./ui";
import "./Chantier.css";

/**
 * « Chantier »: a piece of work split between bots, on one page — what the planner understood, the requirements, the
 * graph of tasks (coloured by state, each link named by what passes along it), each task's contract, checks and attempts,
 * the failure reports, the owner's cards, the lessons and the figures. Before anything runs the plan is a proposal the
 * owner edits and approves. Data: /api/chantiers (server chantierroutes.ts). Opened from the composer (« Nouveau chantier »)
 * or the « Centre de commandement ».
 */

type View = ChantierView & { problems?: string[] };
const STATUS_TONE: Record<ChantierStatus, string> = { planning: "info", proposed: "warn", running: "info", waiting_owner: "warn", done: "ok", stopped: "muted" };
const ANSWER_KEY: Record<DecisionAnswer, Key> = { retry: "chantier.answer.retry", accept: "chantier.answer.accept", redo: "chantier.answer.redo", stop_branch: "chantier.answer.stop_branch", resume: "chantier.answer.resume" };

/** Mounted once in the app shell: the list, the « Nouveau chantier » form or one chantier, in a large window. */
export function ChantierOverlay() {
  const open = useChantiers((s) => s.open);
  const t = useT();
  if (!open) return null;
  const close = () => openChantiers(null);
  return (
    <Modal title={open.kind === "new" ? t("chantier.new.title") : t("chantier.title")} onClose={close} size="xl" className="chantier-modal">
      <div className="modal-body chantier-body">
        {open.kind === "new" ? <NewChantier botId={open.botId} brief={open.brief} /> : open.kind === "page" ? <ChantierPage id={open.id} /> : <ChantierList />}
      </div>
    </Modal>
  );
}

function agentBots(bots: Record<string, Bot>): Bot[] {
  return Object.values(bots).filter((b) => b.kind === "agent" && !b.access).sort((a, b) => a.name.localeCompare(b.name));
}

// ── The list (command center) ────────────────────────────────────────────────────────────────────────────────────
export function ChantierList({ data }: { data?: ChantierSummary[] }) {
  const t = useT();
  const [list, setList] = useState<ChantierSummary[] | null>(data ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!data) api<{ chantiers: ChantierSummary[] }>("GET", "/chantiers").then((r) => setList(r.chantiers), (e) => setError(errText(e))); }, [data]);
  return (
    <div className="chantier-list">
      <div className="chantier-row-head">
        <p className="muted">{t("chantier.list.intro")}</p>
        <button type="button" className="btn btn-primary btn-small" onClick={() => openChantiers({ kind: "new" })}><Icon name="plus" size={14} />{t("chantier.new.button")}</button>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!list && !error && <Loading label={t("common.loading")} />}
      {list && list.length === 0 && <Empty icon="target" title={t("chantier.list.emptyTitle")}>{t("chantier.list.emptyText")}</Empty>}
      {list && list.length > 0 && (
        <ul className="chantier-items">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className="chantier-item" onClick={() => openChantiers({ kind: "page", id: c.id })}>
                <span className="chantier-item-title">{c.title}</span>
                <span className={`chip ch-tone-${STATUS_TONE[c.status]}`}>{t(`chantier.status.${c.status}` as Key)}</span>
                <span className="muted chantier-item-sub">
                  {t("chantier.list.progress", { done: c.accepted, total: c.tasks })}
                  {c.openDecisions > 0 && <> · <strong className="chantier-wait">{t("chantier.list.cards", { n: c.openDecisions })}</strong></>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** « Chantiers » in the command center: a line with the count of cards waiting, and the two buttons. */
export function ChantiersCommandStrip() {
  const t = useT();
  const [pending, setPending] = useState(0);
  useEffect(() => { api<{ pending: number }>("GET", "/chantiers").then((r) => setPending(r.pending), () => undefined); }, []);
  return (
    <div className="chantier-strip">
      <Icon name="target" size={16} />
      <span className="chantier-strip-text"><strong>{t("chantier.title")}</strong>{pending > 0 && <> · <span className="chantier-wait">{t("chantier.list.cards", { n: pending })}</span></>}</span>
      <button type="button" className="btn btn-small" onClick={() => openChantiers({ kind: "list" })}>{t("chantier.list.open")}</button>
      <button type="button" className="btn btn-small btn-primary" onClick={() => openChantiers({ kind: "new" })}>{t("chantier.new.button")}</button>
    </div>
  );
}

// ── New chantier ─────────────────────────────────────────────────────────────────────────────────────────────────
export function NewChantier({ botId, brief: initial }: { botId?: string; brief?: string }) {
  const t = useT();
  const bots = agentBots(useStore((s) => s.bots));
  const [planner, setPlanner] = useState(botId && bots.some((b) => b.id === botId) ? botId : bots[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true); setError(null);
    try { const v = await api<View>("POST", "/chantiers", { title, brief, plannerBotId: planner }); openChantiers({ kind: "page", id: v.chantier.id }); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <form className="chantier-new" onSubmit={(e) => { e.preventDefault(); void start(); }}>
      <p className="muted">{t("chantier.new.intro")}</p>
      <label className="field"><span className="field-label">{t("chantier.new.what")}</span>
        <textarea className="input" rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("chantier.new.whatPlaceholder")} required /></label>
      <label className="field"><span className="field-label">{t("chantier.new.name")}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("chantier.new.namePlaceholder")} /></label>
      <label className="field"><span className="field-label">{t("chantier.new.planner")}</span>
        <select className="input" value={planner} onChange={(e) => setPlanner(e.target.value)}>{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="chantier-actions">
        <button type="button" className="btn btn-small" onClick={() => { setTitle(ARTICLE_CARDS_TITLE); setBrief(ARTICLE_CARDS_BRIEF); }}>{t("chantier.new.example")}</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !brief.trim() || !planner}>{t("chantier.new.start")}</button>
      </div>
      <p className="muted chantier-small">{t("chantier.new.safety")}</p>
    </form>
  );
}

// ── One chantier ─────────────────────────────────────────────────────────────────────────────────────────────────
export function ChantierPage({ id, data }: { id: string; data?: View }) {
  const t = useT();
  const [view, setView] = useState<View | null>(data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => { if (data) return; try { setView(await api<View>("GET", `/chantiers/${id}`)); } catch (e) { setError(errText(e)); } }, [id, data]);
  useEffect(() => { void load(); if (data) return; const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 4000); return () => window.clearInterval(timer); }, [load, data]);
  const act = async (method: string, path: string, body?: unknown) => {
    setBusy(true); setError(null);
    try { setView(await api<View>(method, `/chantiers/${id}${path}`, body)); } catch (e) {
      setError(errText(e));
      // « Le plan n'est pas encore prêt »: the page shows what is left (the server lists it with the plan).
      if (path === "/approve" && body) { try { await api("PUT", `/chantiers/${id}/plan`, body); } catch { /* shown above */ } void load(); }
    } finally { setBusy(false); }
  };
  if (!view) return error ? <ErrorNote>{error}</ErrorNote> : <Loading label={t("common.loading")} />;
  const c = view.chantier;
  const plan = c.plan;
  const live = c.status === "running" || c.status === "waiting_owner";
  const open = view.decisions.filter((d) => d.status === "open");
  // What needs the owner is shown first: the task of an open card, else a blocked or repairing one.
  const focus = selected ?? open[0]?.taskKey ?? view.tasks.find((x) => x.state === "blocked" || x.state === "repairing")?.key ?? null;
  const sel = plan?.tasks.find((x) => x.key === focus) ?? null;
  return (
    <div className="chantier-page">
      <header className="chantier-head">
        <div className="chantier-head-text">
          <h3>{c.title}</h3>
          <span className={`chip ch-tone-${STATUS_TONE[c.status]}`}>{t(`chantier.status.${c.status}` as Key)}</span>
        </div>
        <div className="chantier-actions">
          <button type="button" className="btn btn-small" onClick={() => openChantiers({ kind: "list" })}><Icon name="arrowLeft" size={14} />{t("chantier.list.back")}</button>
          {live && <button type="button" className="btn btn-small btn-danger" disabled={busy} onClick={() => { if (window.confirm(t("chantier.stopConfirm"))) void act("POST", "/stop"); }}><Icon name="stop" size={14} />{t("chantier.stop")}</button>}
        </div>
      </header>
      {c.note && <p className="chantier-note">{c.note}</p>}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {c.status === "planning" && <Loading label={t("chantier.planning")} />}
      {open.length > 0 && (
        <section className="chantier-section" aria-label={t("chantier.cards.title")}>
          <h4><Icon name="hand" size={15} />{t("chantier.cards.title")}</h4>
          {open.map((d) => <DecisionCard key={d.id} d={d} task={plan?.tasks.find((x) => x.key === d.taskKey)} busy={busy} onAnswer={(answer, note) => void act("POST", `/decisions/${d.id}`, { answer, note })} />)}
        </section>
      )}
      {c.status !== "planning" && c.status !== "proposed" && <Metrics view={view} />}
      {plan && c.status === "proposed" && <PlanEditor key={JSON.stringify(plan)} plan={plan} problems={view.problems ?? []} busy={busy} onSave={(p) => void act("PUT", "/plan", { plan: p })} onApprove={(p) => void act("POST", "/approve", { plan: p })} onReplan={() => void act("POST", "/replan")} />}
      {plan && c.status !== "proposed" && (
        <>
          <section className="chantier-section" aria-label={t("chantier.graph.title")}>
            <h4>{t("chantier.graph.title")}</h4>
            <Legend />
            <Graph plan={plan} tasks={view.tasks} selected={focus} onSelect={setSelected} />
          </section>
          {sel && <TaskDetail task={sel} state={view.tasks.find((x) => x.key === sel.key)} attempts={view.attempts.filter((a) => a.taskKey === sel.key)} plan={plan} live={live} busy={busy}
            onNudge={(kind, reason, text) => void act("POST", `/tasks/${sel.key}/nudge`, { kind, reason, text })} />}
          <Understanding plan={plan} />
        </>
      )}
      <Lessons lessons={view.lessons} />
      {view.nudges.length > 0 && (
        <section className="chantier-section" aria-label={t("chantier.history.title")}>
          <h4>{t("chantier.history.title")}</h4>
          <ul className="chantier-history">{view.nudges.map((n, i) => <li key={i}><span className={`chip ch-tone-${n.kind === "intervention" ? "muted" : "warn"}`}>{t(`chantier.nudge.${n.kind}` as Key)}</span> {n.reason}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

function Metrics({ view }: { view: View }) {
  const t = useT();
  const now = useTick(30_000);
  const m = view.metrics;
  const ms = view.chantier.endedAt || !view.chantier.approvedAt ? m.durationMs : Math.max(m.durationMs, now - view.chantier.approvedAt);
  const items: [Key, string, string?][] = [
    ["chantier.metric.time", duration(ms)],
    ["chantier.metric.cost", money(m.costUsd), m.tokens ? t("chantier.metric.tokens", { n: m.tokens }) : undefined],
    ["chantier.metric.defects", String(m.defects)],
    ["chantier.metric.attempts", String(m.attempts)],
    ["chantier.metric.interventions", String(m.interventions)],
    ["chantier.metric.continues", String(m.continues)],
    ["chantier.metric.restates", String(m.restates)],
  ];
  return <ul className="chantier-metrics" aria-label={t("chantier.metric.title")}>{items.map(([k, v, sub]) => <li key={k}><strong>{v}</strong><span>{t(k)}</span>{sub && <small className="muted">{sub}</small>}</li>)}</ul>;
}

function DecisionCard({ d, task, busy, onAnswer }: { d: ChantierDecision; task?: PlanTask; busy: boolean; onAnswer: (a: DecisionAnswer, note: string) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  return (
    <div className={`chantier-card kind-${d.kind}`}>
      <p className="chantier-card-kind">{t(`chantier.cards.${d.kind}` as Key)}{task ? ` — ${task.title}` : ""}</p>
      <p>{d.question}</p>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("chantier.cards.note")} aria-label={t("chantier.cards.note")} />
      <div className="chantier-actions">{d.options.map((o) => <button key={o} type="button" className={`btn btn-small ${o === "stop_branch" ? "" : "btn-primary"}`} disabled={busy} onClick={() => onAnswer(o, note)}>{t(ANSWER_KEY[o])}</button>)}</div>
    </div>
  );
}

function Legend() {
  const t = useT();
  const shown: TaskState[] = ["waiting", "running", "accepted", "repairing", "blocked"];
  return <ul className="chantier-legend">{shown.map((s) => <li key={s}><span className={`ch-dot ch-tone-${STATE_TONE[s]}`} aria-hidden="true" />{t(`chantier.state.${s}` as Key)}</li>)}</ul>;
}

/** The graph: an SVG drawing on wide screens, a list of steps on a phone (same data, same colours). */
function Graph({ plan, tasks, selected, onSelect }: { plan: ChantierPlan; tasks: ChantierTask[]; selected: string | null; onSelect: (k: string) => void }) {
  const t = useT();
  const g = useMemo(() => graphLayout(plan), [plan]);
  const state = (k: string): TaskState => tasks.find((x) => x.key === k)?.state ?? "waiting";
  const title = (k: string) => plan.tasks.find((x) => x.key === k)?.title ?? k;
  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const arrowId = `ch-arrow${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`; // L160 a11y: one marker id per graph (two graphs on a page shared one)
  return (
    <>
      <div className="chantier-graph-svg">
        <svg viewBox={`0 0 ${g.width} ${g.height}`} width={g.width} role="img" aria-label={t("chantier.graph.title")}>
          <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="chantier-arrow" /></marker></defs>
          {g.edges.map((e) => <path key={`${e.from}>${e.to}`} d={e.path} className="chantier-edge" markerEnd={`url(#${arrowId})`} />)}
          {g.edges.map((e) => (
            <g key={`l${e.from}>${e.to}`} transform={`translate(${e.lx},${e.ly})`}>
              <rect x={-Math.min(74, e.artifact.length * 3.1 + 8)} y={-10} width={Math.min(148, e.artifact.length * 6.2 + 16)} height={20} rx={6} className="chantier-edge-label-bg" />
              <text textAnchor="middle" dy="4" className="chantier-edge-label">{short(e.artifact, 23)}</text>
            </g>
          ))}
          {g.nodes.map((n) => (
            <g key={n.key} transform={`translate(${n.x},${n.y})`} className={`chantier-node ch-tone-${STATE_TONE[state(n.key)]} ${selected === n.key ? "is-selected" : ""}`} role="button" tabIndex={0}
              aria-label={`${title(n.key)} — ${t(`chantier.state.${state(n.key)}` as Key)}`} onClick={() => onSelect(n.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(n.key); } }}>
              <rect width={NODE_W} height={NODE_H} rx={10} />
              <text x={12} y={23} className="chantier-node-title">{short(title(n.key), 22)}</text>
              <text x={12} y={43} className="chantier-node-state">{t(`chantier.state.${state(n.key)}` as Key)}</text>
            </g>
          ))}
        </svg>
      </div>
      <ol className="chantier-graph-list">
        {[...new Set(g.nodes.map((n) => n.level))].map((lv) => (
          <li key={lv}>
            <div className="chantier-step-row">
              {g.nodes.filter((n) => n.level === lv).map((n) => (
                <button key={n.key} type="button" className={`chantier-step ch-tone-${STATE_TONE[state(n.key)]} ${selected === n.key ? "is-selected" : ""}`} onClick={() => onSelect(n.key)}>
                  <span className="chantier-step-title">{title(n.key)}</span>
                  <span className="chantier-step-state"><span className={`ch-dot ch-tone-${STATE_TONE[state(n.key)]}`} aria-hidden="true" />{t(`chantier.state.${state(n.key)}` as Key)}</span>
                </button>
              ))}
            </div>
            {g.edges.filter((e) => g.nodes.find((n) => n.key === e.from)?.level === lv).map((e) => (
              <p key={`${e.from}>${e.to}`} className="chantier-step-edge"><Icon name="arrowDown" size={13} />{t("chantier.graph.edge", { artifact: e.artifact, to: title(e.to) })}</p>
            ))}
          </li>
        ))}
      </ol>
      <p className="muted chantier-small">{t("chantier.graph.hint")}</p>
    </>
  );
}

function CheckLine({ c }: { c: CheckResult }) {
  const t = useT();
  return (
    <li className={`chantier-check ${c.pass ? "is-pass" : c.unsure ? "is-unsure" : "is-fail"}`}>
      <Icon name={c.pass ? "check" : c.unsure ? "info" : "close"} size={13} />
      <span><strong>{c.label}</strong>{c.kind === "review" && <span className="chip">{t("chantier.check.reviewer")}</span>} — {c.actual}{!c.pass && <span className="muted"> ({t("chantier.check.expected", { v: c.expected })})</span>}</span>
    </li>
  );
}

function TaskDetail({ task, state, attempts, plan, live, busy, onNudge }: { task: PlanTask; state?: ChantierTask; attempts: ChantierAttempt[]; plan: ChantierPlan; live: boolean; busy: boolean; onNudge: (kind: "continue" | "restate", reason: string, text: string) => void }) {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const now = useTick(30_000);
  const [kind, setKind] = useState<"continue" | "restate" | null>(null);
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const st = state?.state ?? "waiting";
  const c = task.contract;
  return (
    <section className="chantier-section chantier-task" aria-label={task.title}>
      <h4><span className={`ch-dot ch-tone-${STATE_TONE[st]}`} aria-hidden="true" />{task.title} <span className="chip">{t(`chantier.state.${st}` as Key)}</span></h4>
      <p className="muted">{t("chantier.task.who", { bot: bots[task.botId]?.name ?? "?", role: t(`chantier.role.${task.role}` as Key), n: state?.attempts ?? 0, max: plan.maxAttempts + (state?.extra ?? 0) })}{task.reviewerBotId ? ` · ${t("chantier.task.reviewer", { bot: bots[task.reviewerBotId]?.name ?? "?" })}` : ""}</p>
      {state?.waiting === "approval" && <p className="chantier-note">{t("chantier.task.waitsApproval")}</p>}
      {state?.note && <p className="chantier-note">{state.note}</p>}
      <dl className="chantier-contract">
        <dt>{t("chantier.contract.input")}</dt><dd>{c.input}</dd>
        <dt>{t("chantier.contract.output")}</dt><dd>{c.output}</dd>
        <dt>{t("chantier.contract.checks")}</dt><dd><ul>{c.checks.map((x) => <li key={x.id}>{x.label}{x.fromLesson && <span className="chip ch-tone-info">{t("chantier.contract.fromLesson")}</span>}</li>)}</ul></dd>
        {c.criteria.length > 0 && <><dt>{t("chantier.contract.criteria")}</dt><dd><ul>{c.criteria.map((x) => <li key={x.id}>{x.text}</li>)}</ul></dd></>}
        <dt>{t("chantier.contract.scope")}</dt><dd><ul>{c.scope.map((x, i) => <li key={i}>{x}</li>)}</ul></dd>
      </dl>
      <h5>{t("chantier.attempts.title")}</h5>
      {attempts.length === 0 && <p className="muted">{t("chantier.attempts.none")}</p>}
      <ol className="chantier-attempts">
        {[...attempts].reverse().map((a) => (
          <li key={a.id} className={`chantier-attempt result-${a.result}`}>
            <p className="chantier-attempt-head"><strong>{t("chantier.attempts.n", { n: a.n })}</strong> <span className="chip">{t(`chantier.result.${a.result}` as Key)}</span> <span className="muted">{relTime(a.startedAt, Math.max(now, a.startedAt))}</span></p>
            {a.summary && <p>{a.summary}</p>}
            {a.evidence && <p className="muted">{t("chantier.attempts.evidence", { v: a.evidence })}</p>}
            {a.checks.length > 0 && <ul className="chantier-checks">{a.checks.map((x, i) => <CheckLine key={`${x.id}${i}`} c={x} />)}</ul>}
            {a.report && (
              <dl className="chantier-report">
                <dt>{t("chantier.report.component")}</dt><dd>{a.report.component}</dd>
                <dt>{t("chantier.report.conditions")}</dt><dd>{a.report.conditions}</dd>
                <dt>{t("chantier.report.failure")}</dt><dd>{a.report.failure}</dd>
                <dt>{t("chantier.report.expected")}</dt><dd>{a.report.expected}</dd>
                <dt>{t("chantier.report.scope")}</dt><dd>{a.report.repairScope}</dd>
                <dt>{t("chantier.report.recheck")}</dt><dd>{a.report.recheck.join(" ; ")}</dd>
              </dl>
            )}
          </li>
        ))}
      </ol>
      {live && (st === "running" || st === "repairing") && (
        kind ? (
          <form className="chantier-nudge" onSubmit={(e) => { e.preventDefault(); onNudge(kind, reason, text); setKind(null); setReason(""); setText(""); }}>
            {kind === "restate" && <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("chantier.nudge.textPlaceholder")} aria-label={t("chantier.nudge.textPlaceholder")} required />}
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("chantier.nudge.reasonPlaceholder")} aria-label={t("chantier.nudge.reasonPlaceholder")} required />
            <div className="chantier-actions"><button type="button" className="btn btn-small" onClick={() => setKind(null)}>{t("common.cancel")}</button><button type="submit" className="btn btn-small btn-primary" disabled={busy || !reason.trim()}>{t("chantier.nudge.send")}</button></div>
          </form>
        ) : (
          <div className="chantier-actions">
            <button type="button" className="btn btn-small" onClick={() => setKind("continue")}>{t("chantier.nudge.continueButton")}</button>
            <button type="button" className="btn btn-small" onClick={() => setKind("restate")}>{t("chantier.nudge.restateButton")}</button>
          </div>
        )
      )}
    </section>
  );
}

function Understanding({ plan }: { plan: ChantierPlan }) {
  const t = useT();
  return (
    <details className="chantier-section chantier-understanding">
      <summary>{t("chantier.plan.understanding")}</summary>
      <ListBlock title={t("chantier.plan.observations")} items={plan.observations} />
      <ListBlock title={t("chantier.plan.assumptions")} items={plan.assumptions} />
      <ListBlock title={t("chantier.plan.unknowns")} items={plan.unknowns.map((u) => `${u.text}${u.answer ? ` → ${u.answer}` : ""}`)} />
      <ListBlock title={t("chantier.plan.requirements")} items={plan.requirements.map((r) => `${r.text} — ${t("chantier.plan.check")} ${r.acceptance}`)} />
    </details>
  );
}
const ListBlock = ({ title, items }: { title: string; items: string[] }) => (items.length ? <><h5>{title}</h5><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null);

function Lessons({ lessons }: { lessons: ChantierLesson[] }) {
  const t = useT();
  const [list, setList] = useState(lessons);
  useEffect(() => setList(lessons), [lessons]);
  if (!list.length) return null;
  const toggle = async (l: ChantierLesson) => {
    try { const r = await api<{ lesson: ChantierLesson }>("PATCH", `/chantier-lessons/${l.id}`, { status: l.status === "active" ? "retired" : "active" }); setList((xs) => xs.map((x) => (x.id === l.id ? r.lesson : x))); } catch (e) { useStore.getState().showToast(errText(e)); }
  };
  return (
    <section className="chantier-section" aria-label={t("chantier.lessons.title")}>
      <h4><Icon name="bulb" size={15} />{t("chantier.lessons.title")}</h4>
      <ul className="chantier-lessons">
        {list.map((l) => (
          <li key={l.id} className={l.status === "retired" ? "is-retired" : ""}>
            <p><strong>{t("chantier.lessons.rule")}</strong> {l.rule}</p>
            <p><strong>{t("chantier.lessons.evidence")}</strong> {l.evidence}</p>
            <p><strong>{t("chantier.lessons.applies")}</strong> {l.appliesTo}</p>
            <button type="button" className="btn btn-small" onClick={() => void toggle(l)}>{t(l.status === "active" ? "chantier.lessons.retire" : "chantier.lessons.restore")}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── The plan, before anything runs ───────────────────────────────────────────────────────────────────────────────
function PlanEditor({ plan: initial, problems, busy, onSave, onApprove, onReplan }: { plan: ChantierPlan; problems: string[]; busy: boolean; onSave: (p: ChantierPlan) => void; onApprove: (p: ChantierPlan) => void; onReplan: () => void }) {
  const t = useT();
  const bots = agentBots(useStore((s) => s.bots));
  const [p, setP] = useState<ChantierPlan>(initial);
  const [raw, setRaw] = useState<string | null>(null);
  const setTask = (key: string, patch: Partial<PlanTask>) => setP((x) => ({ ...x, tasks: x.tasks.map((y) => (y.key === key ? { ...y, ...patch } : y)) }));
  const setContract = (key: string, patch: Partial<PlanTask["contract"]>) => setP((x) => ({ ...x, tasks: x.tasks.map((y) => (y.key === key ? { ...y, contract: { ...y.contract, ...patch } } : y)) }));
  const current = (): ChantierPlan | null => { if (raw === null) return p; try { return JSON.parse(raw) as ChantierPlan; } catch { useStore.getState().showToast(t("chantier.plan.badJson")); return null; } };
  return (
    <div className="chantier-plan">
      <p className="chantier-note"><Icon name="info" size={14} /> {t("chantier.plan.intro")}</p>
      {problems.length > 0 && (
        <div className="chantier-problems" role="status">
          <p><strong>{t("chantier.plan.problems")}</strong></p>
          <ul>{problems.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {raw !== null ? (
        <label className="field"><span className="field-label">{t("chantier.plan.json")}</span><textarea className="input chantier-json" rows={18} value={raw} onChange={(e) => setRaw(e.target.value)} /></label>
      ) : (
        <>
          {p.unknowns.length > 0 && (
            <section className="chantier-section">
              <h4>{t("chantier.plan.unknowns")}</h4>
              {p.unknowns.map((u) => (
                <label key={u.id} className="field"><span className="field-label">{u.text}</span>
                  <input className="input" value={u.answer} onChange={(e) => setP((x) => ({ ...x, unknowns: x.unknowns.map((y) => (y.id === u.id ? { ...y, answer: e.target.value } : y)) }))} placeholder={t("chantier.plan.answer")} /></label>
              ))}
            </section>
          )}
          <section className="chantier-section">
            <h4>{t("chantier.plan.understanding")}</h4>
            <label className="field"><span className="field-label">{t("chantier.plan.observations")}</span><textarea className="input" rows={3} value={toLines(p.observations)} onChange={(e) => setP({ ...p, observations: fromLines(e.target.value) })} /></label>
            <label className="field"><span className="field-label">{t("chantier.plan.assumptions")}</span><textarea className="input" rows={3} value={toLines(p.assumptions)} onChange={(e) => setP({ ...p, assumptions: fromLines(e.target.value) })} /></label>
            <h5>{t("chantier.plan.requirements")}</h5>
            <ul className="chantier-reqs">{p.requirements.map((r) => <li key={r.id}><strong>{r.text}</strong><span className="muted"> — {t("chantier.plan.check")} {r.acceptance}</span></li>)}</ul>
          </section>
          <section className="chantier-section">
            <h4>{t("chantier.graph.title")}</h4>
            <Graph plan={p} tasks={[]} selected={null} onSelect={() => undefined} />
            <ul className="chantier-edges">
              {p.edges.map((e, i) => (
                <li key={`${e.from}>${e.to}`}>
                  <span className="chantier-edge-ends">{p.tasks.find((x) => x.key === e.from)?.title ?? e.from} → {p.tasks.find((x) => x.key === e.to)?.title ?? e.to}</span>
                  <input className="input" value={e.artifact} aria-label={t("chantier.plan.artifact")} placeholder={t("chantier.plan.artifact")} onChange={(ev) => setP((x) => ({ ...x, edges: x.edges.map((y, j) => (j === i ? { ...y, artifact: ev.target.value } : y)) }))} />
                </li>
              ))}
            </ul>
          </section>
          {p.tasks.map((task) => (
            <section key={task.key} className="chantier-section chantier-task-edit">
              <h4>{task.integration ? t("chantier.plan.integration") : t(`chantier.role.${task.role}` as Key)} — <input className="input chantier-inline" value={task.title} aria-label={t("chantier.plan.taskTitle")} onChange={(e) => setTask(task.key, { title: e.target.value })} /></h4>
              <div className="chantier-grid2">
                <label className="field"><span className="field-label">{t("chantier.plan.bot")}</span><select className="input" value={task.botId} onChange={(e) => setTask(task.key, { botId: e.target.value })}>{!bots.some((b) => b.id === task.botId) && <option value={task.botId}>—</option>}{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <label className="field"><span className="field-label">{t("chantier.plan.reviewer")}</span><select className="input" value={task.reviewerBotId} onChange={(e) => setTask(task.key, { reviewerBotId: e.target.value })}><option value="">{t("chantier.plan.noReviewer")}</option>{bots.filter((b) => b.id !== task.botId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              </div>
              <label className="field"><span className="field-label">{t("chantier.contract.input")}</span><textarea className="input" rows={2} value={task.contract.input} onChange={(e) => setContract(task.key, { input: e.target.value })} /></label>
              <label className="field"><span className="field-label">{t("chantier.contract.output")}</span><textarea className="input" rows={2} value={task.contract.output} onChange={(e) => setContract(task.key, { output: e.target.value })} /></label>
              <div className="field"><span className="field-label">{t("chantier.contract.checks")}</span>
                <ul className="chantier-check-edit">{task.contract.checks.map((x) => <li key={x.id}><span>{x.label}{x.fromLesson && <span className="chip ch-tone-info">{t("chantier.contract.fromLesson")}</span>}</span><button type="button" className="btn btn-small" onClick={() => setContract(task.key, { checks: task.contract.checks.filter((y) => y.id !== x.id) })}>{t("chantier.plan.remove")}</button></li>)}</ul>
              </div>
              <label className="field"><span className="field-label">{t("chantier.contract.criteria")}</span><textarea className="input" rows={2} value={toLines(task.contract.criteria.map((x) => x.text))} onChange={(e) => setContract(task.key, { criteria: fromLines(e.target.value).map((text, i) => ({ id: `k${i + 1}`, text })) })} placeholder={t("chantier.plan.onePerLine")} /></label>
              <label className="field"><span className="field-label">{t("chantier.contract.scope")}</span><textarea className="input" rows={2} value={toLines(task.contract.scope)} onChange={(e) => setContract(task.key, { scope: fromLines(e.target.value) })} placeholder={t("chantier.plan.onePerLine")} /></label>
            </section>
          ))}
          <label className="field chantier-attempts-field"><span className="field-label">{t("chantier.plan.maxAttempts")}</span><input className="input" type="number" min={1} max={10} value={p.maxAttempts} onChange={(e) => setP({ ...p, maxAttempts: Math.max(1, Math.min(10, Number(e.target.value) || 3)) })} /></label>
        </>
      )}
      <div className="chantier-actions chantier-plan-actions">
        <button type="button" className="btn btn-small" onClick={() => setRaw(raw === null ? JSON.stringify(p, null, 2) : null)}>{t(raw === null ? "chantier.plan.advanced" : "chantier.plan.simple")}</button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={onReplan}>{t("chantier.plan.replan")}</button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => { const x = current(); if (x) onSave(x); }}>{t("chantier.plan.save")}</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { const x = current(); if (x) onApprove(x); }}>{t("chantier.plan.approve")}</button>
      </div>
    </div>
  );
}
