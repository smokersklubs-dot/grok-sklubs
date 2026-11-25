import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiBlob, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import type { BoardIdea, BoardTask, BoardView, IdeaUrgency, TaskKind } from "../../../server/src/workboardtypes";
import { BOARD_TABS, byColumn, MAX_FILE, openBoard, REFUSED_EXT, sizeText, sortIdeas, useBoard, withZone, type BoardTab, type EventTrigger, type FlowRunView, type FlowView, type GuestView, type TeamNote, type WeekReview } from "../lib/workboard";
import { relTime } from "../lib/format";
import { Icon } from "./Icon";
import { Empty, ErrorNote, Loading, Modal } from "./ui";
import { BoardDecisions, BoardRolesPanel, TaskKindModel, TaskRunLine } from "./BoardRoles";
import { TaskDelivery } from "./BoardDelivery";
import "./WorkBoard.css";

/**
 * « Tableau de travail » (L163) and its neighbours in one window: the kanban (ideas, to do, under way, blocked, done),
 * the recorded flows (L165), the automations without AI and triggers (L173), the team memory (L171) and the week's
 * work review (L70). Data: /api/board, /api/flows, /api/triggers, /api/team-memory, /api/work-lessons (server
 * workroutes.ts). Opened from the « Centre de commandement ».
 */

const TAB_KEY: Record<BoardTab, Key> = { board: "board.tab.board", flows: "board.tab.flows", automations: "board.tab.automations", team: "board.tab.team", lessons: "board.tab.lessons" };
const COL_KEY: Record<string, Key> = { ideas: "board.col.ideas", waiting: "board.col.waiting", running: "board.col.running", blocked: "board.col.blocked", done: "board.col.done" };
const STATE_KEY: Record<string, Key> = { waiting: "board.state.waiting", running: "board.state.running", review: "board.state.review", delivering: "board.state.delivering", blocked: "board.state.blocked", done: "board.state.done" };
const URG_KEY: Record<IdeaUrgency, Key> = { critical: "board.urgency.critical", bug: "board.urgency.bug", minor: "board.urgency.minor", idea: "board.urgency.idea" };
const PROG_KEY: Record<string, Key> = { todo: "board.progress.todo", analysed: "board.progress.analysed", partial: "board.progress.partial", to_test: "board.progress.to_test", done: "board.progress.done" };
const TONE: Record<string, string> = { waiting: "muted", running: "info", review: "warn", delivering: "info", blocked: "danger", done: "ok" };

function agentBots(bots: Record<string, Bot>): Bot[] {
  return Object.values(bots).filter((b) => b.kind === "agent" && !b.access).sort((a, b) => a.name.localeCompare(b.name));
}
const toast = (e: unknown) => useStore.getState().showToast(errText(e));

/** Mounted once in the app shell. */
export function WorkBoardOverlay() {
  const open = useBoard((s) => s.open);
  const t = useT();
  if (!open) return null;
  return (
    <Modal title={t("board.title")} onClose={() => openBoard(null)} size="xl" className="wb-modal">
      <div className="modal-body wb-body">
        <WorkBoardTabs tab={open} onTab={(x) => openBoard(x)} />
        {open === "board" ? <BoardPanel /> : open === "flows" ? <FlowsPanel /> : open === "automations" ? <AutomationsPanel /> : open === "team" ? <TeamPanel /> : <LessonsPanel />}
      </div>
    </Modal>
  );
}

export function WorkBoardTabs({ tab, onTab }: { tab: BoardTab; onTab: (t: BoardTab) => void }) {
  const t = useT();
  return (
    <div className="wb-tabs" role="tablist" aria-label={t("board.title")}>
      {BOARD_TABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={`wb-tab${tab === x ? " is-on" : ""}`} onClick={() => onTab(x)}>{t(TAB_KEY[x])}</button>)}
    </div>
  );
}

/** « Tableau de travail » in the command center: one line and the button. */
export function WorkBoardCommandStrip() {
  const t = useT();
  return (
    <div className="chantier-strip">
      <Icon name="tasks" size={16} />
      <span className="chantier-strip-text"><strong>{t("board.title")}</strong> · <span className="muted">{t("board.strip")}</span></span>
      <button type="button" className="btn btn-small" onClick={() => openBoard("board")}>{t("board.open")}</button>
      <button type="button" className="btn btn-small" onClick={() => openBoard("flows")}>{t("board.tab.flows")}</button>
    </div>
  );
}

// ── Board ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function BoardPanel({ data }: { data?: BoardView }) {
  const t = useT();
  const bots = agentBots(useStore((s) => s.bots));
  const [view, setView] = useState<BoardView | null>(data ?? null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { if (!data) api<BoardView>("GET", "/board").then(setView, (e) => setError(errText(e))); }, [data]);
  useEffect(() => { load(); if (data) return; const id = setInterval(load, 10_000); return () => clearInterval(id); }, [load, data]);
  if (!view) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  const cols = byColumn(view.tasks);
  const titleOf = (id: string) => view.tasks.find((x) => x.id === id)?.title ?? "?";
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); load(); } catch (e) { toast(e); } };
  return (
    <div className="wb-board">
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <BoardDecisions decisions={view.decisions} />
      <NewTask bots={bots} tasks={view.tasks} onDone={load} />
      <BoardRolesPanel roles={view.roles} sets={view.modelSets} bots={bots} act={act} />
      <div className="wb-cols">
        <section className="wb-col" aria-label={t("board.col.ideas")}>
          <h4>{t("board.col.ideas")} <span className="chip">{view.ideas.length}</span></h4>
          <NewIdea onDone={load} />
          {sortIdeas(view.ideas).map((i) => <IdeaCard key={i.id} idea={i} bots={bots} act={act} />)}
        </section>
        {(["waiting", "running", "blocked", "done"] as const).map((k) => (
          <section key={k} className="wb-col" aria-label={t(COL_KEY[k])}>
            <h4>{t(COL_KEY[k])} <span className="chip">{cols[k].length}</span></h4>
            {!cols[k].length && <p className="muted wb-empty">{t("board.col.empty")}</p>}
            {cols[k].map((task) => <TaskCard key={task.id} task={task} bots={bots} titleOf={titleOf} act={act} />)}
          </section>
        ))}
      </div>
    </div>
  );
}

function NewTask({ bots, tasks, onDone }: { bots: Bot[]; tasks: BoardTask[]; onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [botId, setBotId] = useState("");
  const [priority, setPriority] = useState(3);
  const [start, setStart] = useState("");
  const [deps, setDeps] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [kind, setKind] = useState<TaskKind | "">("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <div className="wb-new-row"><button type="button" className="btn btn-primary btn-small" onClick={() => setOpen(true)}><Icon name="plus" size={14} />{t("board.task.new")}</button></div>;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ task: BoardTask; warning: string }>("POST", "/board/tasks", { title, description, botId: botId || null, priority, startAt: withZone(start), deps, acceptance: review ? "owner" : "auto", kind, model });
      if (r.warning) useStore.getState().showToast(t("board.task.farStart"));
      setOpen(false); setTitle(""); setDescription(""); setDeps([]); setStart("");
      onDone();
    } catch (e) { toast(e); } finally { setBusy(false); }
  };
  return (
    <form className="wb-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="field"><span>{t("board.task.title")}</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required /></label>
      <label className="field"><span>{t("board.task.description")}</span><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="wb-form-grid">
        <label className="field"><span>{t("board.task.bot")}</span><select value={botId} onChange={(e) => setBotId(e.target.value)}><option value="">{t("board.task.noBot")}</option>{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="field"><span>{t("board.task.priority")}</span><select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>{t("board.priority", { n: p })}</option>)}</select></label>
        <label className="field"><span>{t("board.task.start")}</span><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <TaskKindModel kind={kind} model={model} onKind={setKind} onModel={setModel} />
      </div>
      {tasks.length > 0 && (
        <fieldset className="wb-deps"><legend>{t("board.task.deps")}</legend>
          {tasks.filter((x) => x.column !== "done" || x.state === "done").slice(0, 30).map((x) => (
            <label key={x.id} className="wb-check"><input type="checkbox" checked={deps.includes(x.id)} onChange={(e) => setDeps((d) => (e.target.checked ? [...d, x.id] : d.filter((y) => y !== x.id)))} />{x.title}</label>
          ))}
        </fieldset>
      )}
      <label className="wb-check"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />{t("board.task.review")}</label>
      <div className="chantier-actions"><button type="submit" className="btn btn-primary btn-small" disabled={busy || !title.trim()}>{t("board.task.create")}</button><button type="button" className="btn btn-small" onClick={() => setOpen(false)}>{t("common.cancel")}</button></div>
    </form>
  );
}

async function sendFile(path: string, file: File) {
  if (REFUSED_EXT.test(file.name)) throw new Error(`${file.name} : ${useStore.getState().locale === "fr" ? "ce type de fichier n'est pas accepté" : "this type of file is not accepted"}`);
  if (file.size > MAX_FILE) throw new Error(`${file.name} : > 15 Mo`);
  return apiBlob(`${path}?name=${enc(file.name)}`, file);
}

function TaskCard({ task, bots, titleOf, act }: { task: BoardTask; bots: Bot[]; titleOf: (id: string) => string; act: (fn: () => Promise<unknown>) => void }) {
  const t = useT();
  const [fix, setFix] = useState<string | null>(null);
  const bot = bots.find((b) => b.id === task.botId);
  const tone = TONE[task.state] ?? "ok";
  return (
    <article className={`wb-card ch-tone-${tone}${task.priority <= 2 ? " is-urgent" : ""}`}>
      <div className="wb-card-head">
        <span className="ch-dot" aria-hidden="true" />
        <strong className="wb-card-title">{task.title}</strong>
        <span className="chip wb-prio">{t("board.priority", { n: task.priority })}</span>
      </div>
      <div className="wb-meta">
        <span className={`chip ch-tone-${tone}`}>{STATE_KEY[task.state] ? t(STATE_KEY[task.state]) : task.state}</span>
        <span>{bot ? bot.name : t("board.task.noBot")}</span>
        {task.startAt && <span><Icon name="clock" size={12} /> {new Date(task.startAt).toLocaleString()}</span>}
        {task.files.length > 0 && <span><Icon name="clip" size={12} /> {task.files.length}</span>}
      </div>
      <TaskRunLine task={task} bots={bots} />
      {task.waitingOn.length > 0 && <p className="wb-line wb-wait" title={task.waitingOn.map(titleOf).join(", ")}>{t("board.task.waits", { n: task.waitingOn.length })} : {task.waitingOn.map(titleOf).join(", ")}</p>}
      {task.dependents.length > 0 && <p className="wb-line muted">{t("board.task.unblocks", { n: task.dependents.length })}</p>}
      {task.note && <p className="wb-line wb-note">{task.note}</p>}
      {task.summary && <p className="wb-line">{task.summary}</p>}
      <TaskDelivery task={task} act={act} />
      <div className="wb-card-actions">
        {(task.state === "waiting" || task.state === "blocked") && !task.armed && <button type="button" className="btn btn-small btn-primary" onClick={() => act(() => api("POST", "/board/tasks/launch", { ids: [task.id] }))}>{t("board.task.launch")}</button>}
        {task.state === "waiting" && task.armed && <span className="muted wb-small">{task.waitingOn.length ? t("board.task.armedWaiting") : t("board.task.armed")}</span>}
        {(task.state === "running" || task.armed) && task.state !== "done" && <button type="button" className="btn btn-small" onClick={() => act(() => api("POST", `/board/tasks/${task.id}/stop`))}>{t("board.task.stop")}</button>}
        {task.state === "review" && <>
          <button type="button" className="btn btn-small btn-primary" onClick={() => act(() => api("POST", `/board/tasks/${task.id}/accept`))}>{t("board.task.accept")}</button>
          <button type="button" className="btn btn-small" onClick={() => setFix("")}>{t("board.task.fix")}</button>
        </>}
        {task.state !== "running" && task.state !== "review" && task.state !== "delivering" && <label className="btn btn-small wb-file"><Icon name="clip" size={13} />{t("board.file.add")}<input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) act(() => sendFile(`/board/tasks/${task.id}/files`, f)); }} /></label>}
        {task.state !== "running" && task.state !== "review" && task.state !== "delivering" && <button type="button" className="btn btn-small btn-ghost" aria-label={t("board.task.delete")} onClick={() => act(() => api("DELETE", `/board/tasks/${task.id}`))}><Icon name="trash" size={13} /></button>}
      </div>
      {task.files.length > 0 && <ul className="wb-files">{task.files.map((f) => <li key={f.id}><a href={`/api/board/tasks/${task.id}/files/${f.id}`}>{f.name}</a> <span className="muted">{sizeText(f.size)}</span></li>)}</ul>}
      {fix !== null && (
        <form className="wb-fix" onSubmit={(e) => { e.preventDefault(); act(() => api("POST", `/board/tasks/${task.id}/reject`, { note: fix })); setFix(null); }}>
          <textarea rows={2} value={fix} onChange={(e) => setFix(e.target.value)} placeholder={t("board.task.fixHint")} aria-label={t("board.task.fix")} />
          <button type="submit" className="btn btn-small btn-primary" disabled={!fix.trim()}>{t("board.task.sendBack")}</button>
        </form>
      )}
    </article>
  );
}

function NewIdea({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [urgency, setUrgency] = useState<IdeaUrgency>("idea");
  return (
    <form className="wb-idea-new" onSubmit={async (e) => { e.preventDefault(); try { await api("POST", "/board/ideas", { title, urgency }); setTitle(""); onDone(); } catch (err) { toast(err); } }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("board.idea.placeholder")} aria-label={t("board.idea.placeholder")} maxLength={160} />
      <select value={urgency} onChange={(e) => setUrgency(e.target.value as IdeaUrgency)} aria-label={t("board.idea.urgency")}>{(["critical", "bug", "minor", "idea"] as const).map((u) => <option key={u} value={u}>{t(URG_KEY[u])}</option>)}</select>
      <button type="submit" className="btn btn-small" disabled={!title.trim()}>{t("board.idea.add")}</button>
    </form>
  );
}

function IdeaCard({ idea, bots, act }: { idea: BoardIdea; bots: Bot[]; act: (fn: () => Promise<unknown>) => void }) {
  const t = useT();
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const done = idea.progress === "done";
  return (
    <article className={`wb-card wb-idea${done ? " is-done" : ""}`}>
      <div className="wb-card-head">
        <span className="muted wb-num">#{idea.number}</span>
        <strong className="wb-card-title">{idea.title}</strong>
      </div>
      <div className="wb-meta">
        <span className={`chip wb-urg-${idea.urgency}`}>{t(URG_KEY[idea.urgency])}</span>
        <span className="chip">{t(PROG_KEY[idea.progress])}{idea.total > 0 ? ` ${idea.done}/${idea.total}` : ""}</span>
        {idea.files.length > 0 && <span><Icon name="clip" size={12} /> {idea.files.length}</span>}
      </div>
      {idea.body && <p className="wb-line">{idea.body}</p>}
      {!done && (
        <div className="wb-card-actions">
          {idea.total === 0 && <>
            <select value={botId} onChange={(e) => setBotId(e.target.value)} aria-label={t("board.task.bot")}>{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <button type="button" className="btn btn-small btn-primary" onClick={() => act(() => api("POST", `/board/ideas/${idea.id}/promote`, { botId }))}>{t("board.idea.promote")}</button>
          </>}
          <button type="button" className="btn btn-small" onClick={() => act(async () => { await api("POST", `/board/ideas/${idea.id}/send`); useStore.getState().showToast(t("board.idea.sent")); })}>{t("board.idea.send")}</button>
          <label className="btn btn-small wb-file"><Icon name="clip" size={13} /><span className="sr-only">{t("board.file.add")}</span><input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) act(() => sendFile(`/board/ideas/${idea.id}/files`, f)); }} /></label>
          <button type="button" className="btn btn-small btn-ghost" aria-label={t("board.idea.delete")} onClick={() => act(() => api("DELETE", `/board/ideas/${idea.id}`))}><Icon name="trash" size={13} /></button>
        </div>
      )}
    </article>
  );
}

// ── Recorded flows (L165) ─────────────────────────────────────────────────────────────────────────────────────
export function FlowsPanel({ data }: { data?: { flows: FlowView[]; runs: Record<string, FlowRunView[]> } }) {
  const t = useT();
  const bots = agentBots(useStore((s) => s.bots));
  const [flows, setFlows] = useState<FlowView[] | null>(data?.flows ?? null);
  const [runs, setRuns] = useState<Record<string, FlowRunView[]>>(data?.runs ?? {});
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [name, setName] = useState("");
  const load = useCallback(async () => {
    if (data) return;
    try {
      const r = await api<{ flows: FlowView[] }>("GET", "/flows");
      setFlows(r.flows);
      const all: Record<string, FlowRunView[]> = {};
      for (const f of r.flows.slice(0, 20)) all[f.id] = (await api<{ runs: FlowRunView[] }>("GET", `/flows/${f.id}/runs`)).runs;
      setRuns(all);
    } catch (e) { toast(e); }
  }, [data]);
  useEffect(() => { void load(); if (data) return; const id = setInterval(() => void load(), 8000); return () => clearInterval(id); }, [load, data]);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { toast(e); } };
  if (!flows) return <Loading />;
  return (
    <div className="wb-flows">
      <p className="muted">{t("flows.intro")}</p>
      <form className="wb-form wb-inline" onSubmit={(e) => { e.preventDefault(); act(() => api("POST", "/flows/record", { botId, name })); setName(""); }}>
        <select value={botId} onChange={(e) => setBotId(e.target.value)} aria-label={t("board.task.bot")}>{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("flows.name")} aria-label={t("flows.name")} maxLength={80} />
        <button type="submit" className="btn btn-small btn-primary" disabled={!botId}><Icon name="record" size={13} />{t("flows.record")}</button>
      </form>
      {!flows.length && <Empty icon="play" title={t("flows.empty")} />}
      {flows.map((f) => {
        const last = runs[f.id]?.[0];
        return (
          <article key={f.id} className="chantier-section wb-flow">
            <div className="chantier-head">
              <div className="chantier-head-text"><h4>{f.name}</h4>{f.recording && <span className="chip ch-tone-danger"><span className="ch-dot" /> {t("flows.recording")}</span>}</div>
              <div className="chantier-actions">
                {f.recording ? <button type="button" className="btn btn-small btn-primary" onClick={() => act(() => api("POST", `/flows/${f.id}/stop`))}>{t("flows.stop")}</button>
                  : <button type="button" className="btn btn-small btn-primary" disabled={!f.steps.length} onClick={() => act(() => api("POST", `/flows/${f.id}/replay`))}><Icon name="play" size={13} />{t("flows.replay")}</button>}
                <button type="button" className="btn btn-small btn-ghost" aria-label={t("flows.delete")} onClick={() => act(() => api("DELETE", `/flows/${f.id}`))}><Icon name="trash" size={13} /></button>
              </div>
            </div>
            <p className="muted wb-small">{t("flows.steps", { n: f.steps.length })} · {t("flows.commits", { n: f.commitSteps })}{f.blockedSteps ? ` · ${t("flows.blocked", { n: f.blockedSteps })}` : ""}{f.lastRunAt ? ` · ${relTime(f.lastRunAt)}` : ""}</p>
            <ol className="wb-steps">{f.steps.map((s, i) => <li key={i} className={s.kind === "blocked" ? "is-blocked" : s.commit ? "is-commit" : ""}>{stepText(s, t)}{s.commit && s.kind !== "blocked" && <span className="chip ch-tone-warn">{t("flows.commit")}</span>}</li>)}</ol>
            {last && <RunView run={last} onApprove={(step) => act(() => api("POST", `/flow-runs/${last.id}/approve`, { step }))} onStop={() => act(() => api("POST", `/flow-runs/${last.id}/stop`))} />}
          </article>
        );
      })}
    </div>
  );
}

function stepText(s: FlowView["steps"][number], t: ReturnType<typeof useT>): string {
  if (s.kind === "open") return t("flows.step.open", { url: s.url ?? "" });
  if (s.kind === "click" || s.kind === "element_click") return t("flows.step.click", { label: s.label || "?" });
  if (s.kind === "type" || s.kind === "element_type") return t("flows.step.type", { n: (s.text ?? "").length });
  if (s.kind === "key") return t("flows.step.key", { keys: s.keys ?? "" });
  if (s.kind === "read") return t("flows.step.read");
  if (s.kind === "scroll") return t("flows.step.scroll");
  if (s.kind === "element_select") return t("flows.step.select", { option: s.option ?? "" });
  return t("flows.step.blocked", { why: s.why ?? "?" });
}

function RunView({ run, onApprove, onStop }: { run: FlowRunView; onApprove: (step: number) => void; onStop: () => void }) {
  const t = useT();
  const tone = run.status === "done" ? "ok" : run.status === "failed" ? "danger" : run.status === "waiting_approval" ? "warn" : "info";
  return (
    <div className="wb-run">
      <div className="wb-meta"><span className={`chip ch-tone-${tone}`}>{t(`flows.run.${run.status}` as Key)}</span>{run.changed && <span className="chip ch-tone-info">{t("flows.changed")}</span>}<span className="muted">{relTime(run.startedAt)}</span></div>
      {run.note && <p className="wb-line wb-note">{run.note}</p>}
      {run.status === "waiting_approval" && <div className="chantier-actions"><button type="button" className="btn btn-small btn-primary" onClick={() => onApprove(run.atStep)}>{t("flows.approve", { n: run.atStep + 1 })}</button><button type="button" className="btn btn-small" onClick={onStop}>{t("flows.stopRun")}</button></div>}
      {run.evidence.length > 0 && (
        <details className="wb-evidence"><summary>{t("flows.evidence", { n: run.evidence.length })}</summary>
          <ol>{run.evidence.map((e) => (
            <li key={e.n}>
              <span className={e.ok ? "" : "wb-bad"}>{e.ok ? "✓" : "✗"}</span> <strong>{e.title || e.url}</strong> <span className="muted wb-small">{e.url} · #{e.hash}</span>
              {e.shot && <a className="wb-small" href={`/api/flow-runs/${run.id}/shots/${e.n}`} target="_blank" rel="noreferrer">{t("flows.shot")}</a>}
              {e.diff && <div className="wb-diff">{e.diff.added.map((l, i) => <div key={`a${i}`} className="wb-add">+ {l}</div>)}{e.diff.removed.map((l, i) => <div key={`r${i}`} className="wb-del">− {l}</div>)}</div>}
            </li>
          ))}</ol>
        </details>
      )}
    </div>
  );
}

// ── Automations (L173) ────────────────────────────────────────────────────────────────────────────────────────
const EVENTS = ["board.task_done", "board.task_blocked", "idea.resolved", "routine.run_ok", "routine.run_failed", "flow.page_changed", "flow.run_failed"] as const;
const ACTIONS = ["notice", "flow", "routine", "webhook"] as const;
const MODES = ["ai", "flow", "webhook", "notice", "script"] as const;

export function AutomationsPanel({ data }: { data?: { triggers: EventTrigger[]; flows: FlowView[] } }) {
  const t = useT();
  const bots = agentBots(useStore((s) => s.bots));
  const [list, setList] = useState<EventTrigger[] | null>(data?.triggers ?? null);
  const [flows, setFlows] = useState<FlowView[]>(data?.flows ?? []);
  const [routines, setRoutines] = useState<{ id: string; name: string; botId: string }[]>([]);
  const [form, setForm] = useState({ event: "board.task_done", botId: bots[0]?.id ?? "", action: "notice", target: "" });
  const load = useCallback(async () => {
    if (data) return;
    try {
      setList((await api<{ triggers: EventTrigger[] }>("GET", "/triggers")).triggers);
      setFlows((await api<{ flows: FlowView[] }>("GET", "/flows")).flows);
      const all: { id: string; name: string; botId: string }[] = [];
      for (const b of bots.slice(0, 12)) for (const r of (await api<{ routines: { id: string; name: string }[] }>("GET", `/bots/${b.id}/routines`)).routines) all.push({ ...r, botId: b.id });
      setRoutines(all);
    } catch (e) { toast(e); }
  }, [data, bots.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { toast(e); } };
  if (!list) return <Loading />;
  const label = (tr: EventTrigger) => tr.action === "flow" ? flows.find((f) => f.id === tr.target)?.name ?? "?" : tr.action === "routine" ? routines.find((r) => r.id === tr.target)?.name ?? "?" : tr.target;
  return (
    <div className="wb-auto">
      <section className="chantier-section">
        <h4>{t("auto.triggers")}</h4>
        <p className="muted wb-small">{t("auto.triggersIntro")}</p>
        {!list.length && <p className="muted">{t("auto.none")}</p>}
        <ul className="wb-list">{list.map((tr) => (
          <li key={tr.id}>
            <span><strong>{t(`auto.event.${tr.event}` as Key)}</strong> → {t(`auto.action.${tr.action}` as Key)} « {label(tr)} »</span>
            <span className="muted wb-small">{t("auto.fired", { n: tr.fired })}{tr.lastNote ? ` · ${tr.lastNote}` : ""}</span>
            <span className="chantier-actions">
              <button type="button" className="btn btn-small" onClick={() => act(async () => useStore.getState().showToast((await api<{ note: string }>("POST", `/triggers/${tr.id}/test`)).note))}>{t("auto.test")}</button>
              <button type="button" className="btn btn-small" onClick={() => act(() => api("PATCH", `/triggers/${tr.id}`, { enabled: !tr.enabled }))}>{tr.enabled ? t("auto.pause") : t("auto.resume")}</button>
              <button type="button" className="btn btn-small btn-ghost" aria-label={t("auto.delete")} onClick={() => act(() => api("DELETE", `/triggers/${tr.id}`))}><Icon name="trash" size={13} /></button>
            </span>
          </li>
        ))}</ul>
        <form className="wb-form" onSubmit={(e) => { e.preventDefault(); act(() => api("POST", "/triggers", form)); }}>
          <div className="wb-form-grid">
            <label className="field"><span>{t("auto.when")}</span><select value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })}>{EVENTS.map((x) => <option key={x} value={x}>{t(`auto.event.${x}` as Key)}</option>)}</select></label>
            <label className="field"><span>{t("board.task.bot")}</span><select value={form.botId} onChange={(e) => setForm({ ...form, botId: e.target.value })}>{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="field"><span>{t("auto.then")}</span><select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value, target: "" })}>{ACTIONS.map((x) => <option key={x} value={x}>{t(`auto.action.${x}` as Key)}</option>)}</select></label>
          </div>
          <TargetField kind={form.action} value={form.target} onChange={(v) => setForm({ ...form, target: v })} flows={flows} routines={routines} />
          <div className="chantier-actions"><button type="submit" className="btn btn-small btn-primary" disabled={!form.target || !form.botId}>{t("auto.add")}</button></div>
        </form>
      </section>
      <RoutineModes routines={routines} flows={flows} />
    </div>
  );
}

function TargetField({ kind, value, onChange, flows, routines }: { kind: string; value: string; onChange: (v: string) => void; flows: FlowView[]; routines: { id: string; name: string }[] }) {
  const t = useT();
  if (kind === "flow") return <label className="field"><span>{t("auto.target.flow")}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="" />{flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>;
  if (kind === "routine") return <label className="field"><span>{t("auto.target.routine")}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="" />{routines.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>;
  if (kind === "script") return <label className="field"><span>{t("auto.target.script")}</span><textarea rows={4} className="input mono" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
  if (kind === "webhook") return <label className="field"><span>{t("auto.target.webhook")}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder="owh_…" /></label>;
  if (kind === "ai") return null;
  return <label className="field"><span>{t("auto.target.notice")}</span><input value={value} onChange={(e) => onChange(e.target.value)} maxLength={1000} /></label>;
}

function RoutineModes({ routines, flows }: { routines: { id: string; name: string }[]; flows: FlowView[] }) {
  const t = useT();
  const [id, setId] = useState("");
  const [mode, setMode] = useState("ai");
  const [target, setTarget] = useState("");
  const [after, setAfter] = useState("");
  const [when, setWhen] = useState("ok");
  useEffect(() => {
    if (!id) return;
    api<{ automation: { mode: string; target: string; afterRoutineId: string | null; afterWhen: string } }>("GET", `/routines/${id}/automation`).then((r) => { setMode(r.automation.mode); setTarget(r.automation.target); setAfter(r.automation.afterRoutineId ?? ""); setWhen(r.automation.afterWhen); }, toast);
  }, [id]);
  return (
    <section className="chantier-section">
      <h4>{t("auto.routines")}</h4>
      <p className="muted wb-small">{t("auto.routinesIntro")}</p>
      <form className="wb-form" onSubmit={async (e) => { e.preventDefault(); try { await api("PUT", `/routines/${id}/automation`, { mode, target, afterRoutineId: after || null, afterWhen: when }); useStore.getState().showToast(t("auto.saved")); } catch (err) { toast(err); } }}>
        <div className="wb-form-grid">
          <label className="field"><span>{t("auto.routine")}</span><select value={id} onChange={(e) => setId(e.target.value)}><option value="" />{routines.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label className="field"><span>{t("auto.mode")}</span><select value={mode} onChange={(e) => { setMode(e.target.value); setTarget(""); }}>{MODES.map((m) => <option key={m} value={m}>{t(`auto.mode.${m}` as Key)}</option>)}</select></label>
          <label className="field"><span>{t("auto.after")}</span><select value={after} onChange={(e) => setAfter(e.target.value)}><option value="">{t("auto.afterNone")}</option>{routines.filter((r) => r.id !== id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          {after && <label className="field"><span>{t("auto.afterWhen")}</span><select value={when} onChange={(e) => setWhen(e.target.value)}><option value="ok">{t("auto.afterOk")}</option><option value="any">{t("auto.afterAny")}</option></select></label>}
        </div>
        <TargetField kind={mode} value={target} onChange={setTarget} flows={flows} routines={routines} />
        <div className="chantier-actions"><button type="submit" className="btn btn-small btn-primary" disabled={!id}>{t("auto.save")}</button></div>
      </form>
    </section>
  );
}

// ── Team memory (L171) ────────────────────────────────────────────────────────────────────────────────────────
type Space = { kind: "workspace" | "section"; id: string; name: string; admin: boolean };
export function TeamPanel({ data }: { data?: { spaces: Space[]; notes: TeamNote[]; guests: GuestView[] } }) {
  const t = useT();
  const sections = useStore((s) => s.sections);
  const [spaces, setSpaces] = useState<Space[]>(data?.spaces ?? []);
  const [sel, setSel] = useState(data?.spaces[0] ? `${data.spaces[0].kind}:${data.spaces[0].id}` : "");
  const [notes, setNotes] = useState<TeamNote[] | null>(data?.notes ?? null);
  const [guests, setGuests] = useState<GuestView[]>(data?.guests ?? []);
  const [text, setText] = useState("");
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (data) return;
    api<{ workspaces: { id: string; name: string; role: string }[] }>("GET", "/workspaces").then((r) => {
      const all: Space[] = [...r.workspaces.map((w) => ({ kind: "workspace" as const, id: w.id, name: w.name, admin: w.role === "owner" || w.role === "admin" })), ...sections.map((s) => ({ kind: "section" as const, id: s.id, name: s.name, admin: true }))];
      setSpaces(all);
      setSel((x) => x || (all[0] ? `${all[0].kind}:${all[0].id}` : ""));
    }, toast);
  }, [data, sections]);
  const space = useMemo(() => spaces.find((s) => `${s.kind}:${s.id}` === sel) ?? null, [spaces, sel]);
  const load = useCallback(() => {
    if (data || !space) return;
    api<{ notes: TeamNote[] }>("GET", `/team-memory/${space.kind}/${space.id}`).then((r) => setNotes(r.notes), toast);
    if (space.kind === "workspace" && space.admin) api<{ guests: GuestView[] }>("GET", `/team-memory/workspace/${space.id}/guests`).then((r) => setGuests(r.guests), () => setGuests([]));
    else setGuests([]);
  }, [data, space]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); load(); } catch (e) { toast(e); } };
  if (!spaces.length) return <Empty icon="users" title={t("tmem.noSpace")}>{t("tmem.noSpaceHint")}</Empty>;
  return (
    <div className="wb-team">
      <p className="muted">{t("tmem.intro")}</p>
      <label className="field"><span>{t("tmem.space")}</span><select value={sel} onChange={(e) => setSel(e.target.value)}>{spaces.map((s) => <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>{s.kind === "workspace" ? t("tmem.workspace", { name: s.name }) : t("tmem.project", { name: s.name })}</option>)}</select></label>
      <form className="wb-form wb-inline" onSubmit={(e) => { e.preventDefault(); if (space) act(() => api("POST", `/team-memory/${space.kind}/${space.id}`, { text })); setText(""); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("tmem.placeholder")} aria-label={t("tmem.placeholder")} maxLength={1000} />
        <button type="submit" className="btn btn-small btn-primary" disabled={!text.trim()}>{t("tmem.add")}</button>
      </form>
      {notes === null ? <Loading /> : !notes.length ? <p className="muted">{t("tmem.empty")}</p> : (
        <ul className="wb-list">{notes.map((n) => (
          <li key={n.id} className={n.status === "pending" ? "is-pending" : n.status === "archived" ? "is-archived" : ""}>
            <span>{n.text}</span>
            <span className="muted wb-small">{n.authorName}{n.byGuest ? ` · ${t("tmem.guest")}` : ""} · {relTime(n.createdAt)}{n.links.length ? ` · ${t("tmem.links", { n: n.links.length })}` : ""}{n.linkedFrom.length ? ` · ${t("tmem.linkedFrom", { n: n.linkedFrom.length })}` : ""}</span>
            <span className="chantier-actions">
              {n.status === "pending" && space?.admin && <button type="button" className="btn btn-small btn-primary" onClick={() => act(() => api("PATCH", `/team-notes/${n.id}`, { status: "active" }))}>{t("tmem.accept")}</button>}
              {n.status === "pending" && <span className="chip ch-tone-warn">{t("tmem.pending")}</span>}
              {n.status !== "pending" && <button type="button" className="btn btn-small" onClick={() => act(() => api("PATCH", `/team-notes/${n.id}`, { status: n.status === "archived" ? "active" : "archived" }))}>{n.status === "archived" ? t("tmem.unarchive") : t("tmem.archive")}</button>}
              <button type="button" className="btn btn-small btn-ghost" aria-label={t("tmem.delete")} onClick={() => act(() => api("DELETE", `/team-notes/${n.id}`))}><Icon name="trash" size={13} /></button>
            </span>
          </li>
        ))}</ul>
      )}
      {space?.kind === "workspace" && !data && <BotReaders />}
      {space?.kind === "workspace" && space.admin && (
        <section className="chantier-section">
          <h4>{t("tmem.guests")}</h4>
          <p className="muted wb-small">{t("tmem.guestsIntro")}</p>
          {link && <p className="chantier-note wb-link">{t("tmem.linkOnce")} <code>{`${location.origin}/api/team-guest/${link}`}</code></p>}
          <ul className="wb-list">{guests.map((g) => <li key={g.id}><span>{g.name} · {g.canWrite ? t("tmem.canWrite") : t("tmem.readOnly")}</span><span className="muted wb-small">{g.revoked ? t("tmem.revoked") : t("tmem.until", { date: new Date(g.expiresAt).toLocaleDateString() })}</span>{!g.revoked && <button type="button" className="btn btn-small" onClick={() => act(() => api("DELETE", `/team-memory/workspace/${space.id}/guests/${g.id}`))}>{t("tmem.revoke")}</button>}</li>)}</ul>
          <GuestForm onCreate={(name, canWrite) => act(async () => { const r = await api<{ guest: { token: string } }>("POST", `/team-memory/workspace/${space.id}/guests`, { name, canWrite, days: 7 }); setLink(r.guest.token); })} />
        </section>
      )}
    </div>
  );
}

/** Which of the owner's bots read the workspace's team memory (off by default; only a bot shared to that workspace receives it). */
function BotReaders() {
  const t = useT();
  const bots = agentBots(useStore((s) => s.bots));
  const [on, setOn] = useState<Record<string, boolean>>({});
  useEffect(() => { for (const b of bots.slice(0, 20)) api<{ on: boolean }>("GET", `/bots/${b.id}/team-memory`).then((r) => setOn((o) => ({ ...o, [b.id]: r.on })), () => undefined); }, [bots.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="chantier-section">
      <h4>{t("tmem.readers")}</h4>
      <p className="muted wb-small">{t("tmem.readersIntro")}</p>
      {bots.slice(0, 20).map((b) => <label key={b.id} className="wb-check"><input type="checkbox" checked={!!on[b.id]} onChange={async (e) => { const v = e.target.checked; try { await api("PUT", `/bots/${b.id}/team-memory`, { on: v }); setOn((o) => ({ ...o, [b.id]: v })); } catch (err) { toast(err); } }} />{b.name}</label>)}
    </section>
  );
}

function GuestForm({ onCreate }: { onCreate: (name: string, canWrite: boolean) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  return (
    <form className="wb-form wb-inline" onSubmit={(e) => { e.preventDefault(); onCreate(name, write); setName(""); }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("tmem.guestName")} aria-label={t("tmem.guestName")} maxLength={80} />
      <label className="wb-check"><input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} />{t("tmem.canWrite")}</label>
      <button type="submit" className="btn btn-small" disabled={!name.trim()}>{t("tmem.invite")}</button>
    </form>
  );
}

// ── Lessons (L70) ─────────────────────────────────────────────────────────────────────────────────────────────
export function LessonsPanel({ data }: { data?: WeekReview }) {
  const t = useT();
  const [week, setWeek] = useState<WeekReview | null>(data ?? null);
  const load = useCallback(() => { if (!data) api<WeekReview>("GET", "/work-lessons/week").then(setWeek, toast); }, [data]);
  useEffect(load, [load]);
  if (!week) return <Loading />;
  const answer = async (key: string, accept: boolean) => { try { await api("POST", `/work-lessons/proposals/${key}`, { accept }); load(); } catch (e) { toast(e); } };
  return (
    <div className="wb-lessons">
      <p className="muted">{t("lessons.intro")}</p>
      <ul className="chantier-metrics">
        <li><strong>{week.success}</strong><span>{t("lessons.success")}</span></li>
        <li><strong>{week.failure}</strong><span>{t("lessons.failure")}</span></li>
        {week.perBot.map((b) => <li key={b.botId}><strong>{b.success}/{b.success + b.failure}</strong><span>{b.name}</span></li>)}
      </ul>
      <h4>{t("lessons.proposals")}</h4>
      {!week.proposals.length && <p className="muted">{t("lessons.none")}</p>}
      {week.proposals.map((p) => (
        <article key={p.key} className="chantier-section">
          <p><strong>{p.botName}</strong> — {p.text}</p>
          <p className="muted wb-small">{t("lessons.evidence")} : {p.evidence.join(" · ")}</p>
          <div className="chantier-actions"><button type="button" className="btn btn-small btn-primary" onClick={() => answer(p.key, true)}>{t("lessons.accept")}</button><button type="button" className="btn btn-small" onClick={() => answer(p.key, false)}>{t("lessons.dismiss")}</button></div>
        </article>
      ))}
    </div>
  );
}
