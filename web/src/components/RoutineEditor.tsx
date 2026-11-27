import { useEffect, useId, useMemo, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot, ModelOption, Routine } from "../types";
import { dateTime } from "../lib/format";
import { Icon, Spinner } from "./Icon";
import { ErrorNote } from "./ui";
import { RoutineOptions } from "./RoutineOptions";
import { RoutineRunForm } from "./RoutineParams";
import "./RoutineEditor.css";

/**
 * nod items 2, 8, 13 on a routine of Settings → Routines (server: routineplus.ts / routineplusroutes.ts):
 *  - live activity of a run under way (steps, what it is doing, what it waits for);
 *  - the run track: due / started / skipped while the server was off;
 *  - « Modifier »: name, instruction, schedule and time zone, with a preview of the next runs that saves nothing;
 *    only the changed fields are saved; « Lancer maintenant » waits until the changes are saved;
 *  - « Approuver toute la consigne »: targets, a daily limit, an end date — the approval lapses when the instruction changes.
 */
interface Approval { state: "none" | "approved" | "stale" | "expired"; scope: { targets: string[]; maxRunsPerDay: number | null; until: number | null } | null; approvedAt: number | null }
interface Track { runId: string; dueAt: number | null; startedAt: number; missed: number; lateMs: number; line: string }
interface Extras { revision: number; editedAt: number | null; model: string; effectiveModel: string; approval: Approval; track: Track[] }
interface Live { routineId: string; steps: number; caption: string | null; activity: string | null; since: number | null; awaiting: string | null }

function useModels(botId: string) {
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    let dead = false;
    api<{ models: ModelOption[] }>("GET", `/models?bot=${enc(botId)}`).then((r) => { if (!dead) setModels(Array.isArray(r?.models) ? r.models : []); }, () => undefined);
    return () => { dead = true; };
  }, [botId]);
  return models;
}

function ModelSelect({ id, value, onChange, models, label }: { id: string; value: string; onChange: (v: string) => void; models: ModelOption[]; label: string }) {
  const t = useT();
  const refs = models.map((m) => m.ref);
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{t("routineEdit.botModel")}</option>
      {value && !refs.includes(value) && <option value={value}>{value}</option>}
      {models.map((m) => <option key={m.ref} value={m.ref}>{m.ref}</option>)}
    </select>
  );
}

export function RoutineMore({ r, onNote, onError, open }: { r: Routine; onNote: (t: string) => void; onError: (t: string | null) => void; /** Gallery: the editor and the approval form start open. */ open?: boolean }) {
  const tick = useStore((s) => s.routineTicks[r.botId] ?? 0);
  const [extras, setExtras] = useState<Extras | null>(null);
  const load = () => api<Extras>("GET", `/routines/${enc(r.id)}/extras`).then(setExtras, () => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [r.id, tick]);
  const late = extras?.track.find((x) => x.line);
  return (
    <div className="routine-more">
      {r.running && <RoutineLive r={r} />}
      {late && <p className="small routine-track"><Icon name="clock" size={12} /><span>{late.line}</span></p>}
      <RoutineRunForm r={r} revision={extras?.revision} onNote={onNote} />
      {extras && <RoutineEdit r={r} extras={extras} startOpen={open} onSaved={(x) => setExtras(x)} onNote={onNote} onError={onError} />}
      {extras && <ApproveInstruction r={r} approval={extras.approval} startOpen={open} onChange={() => void load()} />}
      <RoutineOptions r={r} startOpen={open} />
    </div>
  );
}

function RoutineLive({ r }: { r: Routine }) {
  const t = useT();
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => {
    let dead = false;
    const poll = () => api<{ live: Live[] }>("GET", `/bots/${enc(r.botId)}/routines/live`).then((res) => { if (!dead) setLive(res.live.find((l) => l.routineId === r.id) ?? null); }, () => undefined);
    void poll();
    const timer = window.setInterval(poll, 4000);
    return () => { dead = true; window.clearInterval(timer); };
  }, [r.id, r.botId]);
  if (!live) return null;
  return (
    <p className="small routine-live" role="status">
      <Spinner size={11} />
      <span>{live.awaiting ? t("routineEdit.liveWaiting", { reason: live.awaiting }) : t("routineEdit.live", { n: live.steps })}{live.caption && !live.awaiting ? <span className="routine-live-caption"> · {live.caption}</span> : null}</span>
    </p>
  );
}

function RoutineEdit({ r, extras, startOpen, onSaved, onNote, onError }: { r: Routine; extras: Extras; startOpen?: boolean; onSaved: (x: Extras) => void; onNote: (t: string) => void; onError: (t: string | null) => void }) {
  const t = useT();
  // nod item 2: the routine's own model — the turn loop runs the routine on it (server agent/workmodel.ts).
  const ids = { name: useId(), prompt: useId(), schedule: useId(), tz: useId(), model: useId() };
  const models = useModels(r.botId);
  const [open, setOpen] = useState(!!startOpen);
  const initial = useMemo(() => ({ name: r.name, prompt: r.prompt, schedule: r.schedule, timezone: r.timezone, model: extras.model }), [r.name, r.prompt, r.schedule, r.timezone, extras.model]);
  const [form, setForm] = useState(initial);
  useEffect(() => { if (!open) setForm(initial); }, [initial, open]);
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);
  const scheduled = r.trigger === "cron";
  const [preview, setPreview] = useState<{ describe: string; next: number[]; monthlyUsd: number | null } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !scheduled) return;
    const timer = window.setTimeout(() => {
      api<{ describe: string; next: number[]; monthlyUsd: number | null }>("POST", `/bots/${enc(r.botId)}/routines/preview`, { trigger: "cron", schedule: form.schedule, timezone: form.timezone, model: form.model || undefined, routineId: r.id })
        .then((p) => { setPreview(p); setPreviewError(null); }, (e: unknown) => { setPreview(null); setPreviewError(errText(e)); });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, scheduled, form.schedule, form.timezone, form.model, r.botId, r.id]);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy("save"); setError(null);
    try {
      const changed: Record<string, string> = {};
      for (const k of Object.keys(initial) as (keyof typeof initial)[]) if (form[k] !== initial[k]) changed[k] = form[k];
      const res = await api<Extras & { changed: string[] }>("PUT", `/routines/${enc(r.id)}`, { ...changed, revision: extras.revision });
      onSaved({ ...extras, ...res, track: extras.track });
      await useStore.getState().loadBundle(r.botId);
      onNote(t("routineEdit.saved"));
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const runNow = async () => {
    setBusy("run"); setError(null); onError(null);
    try { await api("POST", `/routines/${enc(r.id)}/run`, { revision: extras.revision }); onNote(t("routine.runningNow")); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  return (
    <div className="routine-edit">
      <button type="button" className="link small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="edit" size={12} /> {t("routineEdit.open")}
      </button>
      {open && (
        <form className="routine-edit-form" onSubmit={(e) => { e.preventDefault(); if (dirty && !busy) void save(); }}>
          <div className="field">
            <label className="field-label" htmlFor={ids.name}>{t("common.name")}</label>
            <input id={ids.name} className="input" value={form.name} maxLength={80} onChange={(e) => set("name")(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={ids.prompt}>{t("routineEdit.instruction")}</label>
            <textarea id={ids.prompt} className="input" rows={3} value={form.prompt} maxLength={8000} onChange={(e) => set("prompt")(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={ids.model}>{t("routineEdit.model")}</label>
            <ModelSelect id={ids.model} value={form.model} onChange={set("model")} models={models} label={t("routineEdit.model")} />
            <p className="field-hint">{t("routineEdit.modelHint")}</p>
          </div>
          {scheduled && (
            <div className="form-cols">
              <div className="field">
                <label className="field-label" htmlFor={ids.schedule}>{t("routineEdit.schedule")}</label>
                <input id={ids.schedule} className="input mono" value={form.schedule} spellCheck={false} onChange={(e) => set("schedule")(e.target.value)} />
                <p className="field-hint">{t("routineEdit.scheduleHint")}</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={ids.tz}>{t("routineEdit.timezone")}</label>
                <input id={ids.tz} className="input" value={form.timezone} spellCheck={false} onChange={(e) => set("timezone")(e.target.value)} />
              </div>
            </div>
          )}
          {scheduled && (
            <div className="routine-preview" aria-live="polite">
              {preview && (
                <>
                  <p className="small"><strong>{preview.describe}</strong>{preview.monthlyUsd !== null ? ` · ${t("routine.projected", { usd: preview.monthlyUsd.toFixed(2) })}` : ""}</p>
                  <p className="small muted">{t("routineEdit.nextRuns")} {preview.next.map((n) => dateTime(n, form.timezone || undefined)).join(" · ")}</p>
                </>
              )}
              {previewError && <p className="small is-error">{previewError}</p>}
            </div>
          )}
          <ErrorNote>{error}</ErrorNote>
          <div className="row-end">
            {dirty && <span className="small muted">{t("routineEdit.saveFirst")}</span>}
            <span className="spacer" />
            <button type="button" className="btn btn-small" disabled={dirty || busy !== null} onClick={() => void runNow()} title={dirty ? t("routineEdit.saveFirst") : undefined}>
              <Icon name="bolt" size={13} /> {t(busy === "run" ? "common.starting" : "routine.runNow")}
            </button>
            <button type="submit" className="btn btn-small btn-primary" disabled={!dirty || busy !== null}>
              {busy === "save" ? <><Spinner size={12} /> {t("routineEdit.saving")}</> : t("routineEdit.save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ApproveInstruction({ r, approval, startOpen, onChange }: { r: Routine; approval: Approval; startOpen?: boolean; onChange: () => void }) {
  const t = useT();
  const ids = { targets: useId(), max: useId() };
  const [open, setOpen] = useState(!!startOpen);
  const [targets, setTargets] = useState(approval.scope?.targets.join(", ") ?? "");
  const [max, setMax] = useState(approval.scope?.maxRunsPerDay ? String(approval.scope.maxRunsPerDay) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chip = approval.state === "approved" ? "state-ready" : approval.state === "none" ? "chip-quiet" : "state-needs_auth";
  const approve = async () => {
    setBusy(true); setError(null);
    try {
      await api("POST", `/routines/${enc(r.id)}/approve`, { scope: { targets: targets.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean), maxRunsPerDay: max ? Number(max) : null } });
      setOpen(false); onChange();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const withdraw = async () => {
    setBusy(true); setError(null);
    try { await api("DELETE", `/routines/${enc(r.id)}/approve`); onChange(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="routine-approve">
      <div className="routine-approve-head">
        <span className={`chip ${chip}`}><Icon name="shield" size={11} /> {t(`routineEdit.approval.${approval.state}`)}</span>
        <button type="button" className="link small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t(approval.state === "approved" ? "routineEdit.approveChange" : "routineEdit.approveOpen")}</button>
        {approval.state !== "none" && <button type="button" className="link small" disabled={busy} onClick={() => void withdraw()}>{t("routineEdit.withdraw")}</button>}
      </div>
      {approval.state === "approved" && approval.scope && <p className="small muted">{t("routineEdit.approvedFor", { targets: approval.scope.targets.join(", ") })}</p>}
      {open && (
        <form className="routine-approve-form" onSubmit={(e) => { e.preventDefault(); if (!busy) void approve(); }}>
          <p className="small">{t("routineEdit.approveIntro")}</p>
          <blockquote className="small routine-approve-quote">{r.prompt}</blockquote>
          <div className="form-cols">
            <div className="field">
              <label className="field-label" htmlFor={ids.targets}>{t("routineEdit.targets")}</label>
              <input id={ids.targets} className="input" value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={t("routineEdit.targetsPlaceholder")} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={ids.max}>{t("routineEdit.maxPerDay")} <span className="muted">{t("common.optional")}</span></label>
              <input id={ids.max} className="input" type="number" min={1} max={1440} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
          </div>
          <p className="field-hint">{t("routineEdit.approveHint")}</p>
          <ErrorNote>{error}</ErrorNote>
          <div className="row-end">
            <span className="spacer" />
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn-small btn-primary" disabled={busy || !targets.trim()}>{t("routineEdit.approve")}</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** nod item 2 — the models of the bot's routines, background tasks and other background work ("" = its own model); the turn loop applies them (server agent/workmodel.ts). */
export function WorkModels({ bot }: { bot: Bot }) {
  const t = useT();
  const models = useModels(bot.id);
  const ids = { routines: useId(), tasks: useId(), background: useId() };
  const [value, setValue] = useState<{ routines: string; tasks: string; background: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api<{ routines: string; tasks: string; background: string }>("GET", `/bots/${enc(bot.id)}/work-models`).then(setValue, (e: unknown) => setError(errText(e))); }, [bot.id]);
  if (!value) return error ? <ErrorNote>{error}</ErrorNote> : null;
  const change = (k: keyof typeof value) => (v: string) => {
    const next = { ...value, [k]: v };
    setValue(next); setError(null); setSaved(false);
    api<typeof value>("PUT", `/bots/${enc(bot.id)}/work-models`, { [k]: v }).then((res) => { setValue(res); setSaved(true); }, (e: unknown) => setError(errText(e)));
  };
  return (
    <div className="work-models">
      <p className="small muted">{t("workModels.intro", { name: bot.name })}</p>
      <div className="form-cols work-models-cols">
        {(["routines", "tasks", "background"] as const).map((k) => (
          <div className="field" key={k}>
            <label className="field-label" htmlFor={ids[k]}>{t(`workModels.${k}`)}</label>
            <ModelSelect id={ids[k]} value={value[k]} onChange={change(k)} models={models} label={t(`workModels.${k}`)} />
          </div>
        ))}
      </div>
      {saved && <span className="chip state-ready" role="status">{t("workModels.saved")}</span>}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
