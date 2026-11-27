import { useEffect, useId, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import type { Routine } from "../types";
import { Icon, Spinner } from "./Icon";
import { ErrorNote } from "./ui";

/**
 * Wave 6 options of a routine (server routineoptions.ts):
 *  - L54 « Où l'annoncer » : dans son propre fil (default) or dans la discussion;
 *  - L86 « Condition » : a plain-language condition a small model checks on each new item before the bot is woken;
 *  - L183 « Travail lourd » : waits for the subscription's quota window instead of running while it is at its limit.
 */
interface Options { announce: "thread" | "chat"; condition: string; heavy: boolean }

export function RoutineOptions({ r, startOpen }: { r: Routine; startOpen?: boolean }) {
  const t = useT();
  const ids = { announce: useId(), condition: useId(), heavy: useId() };
  const [open, setOpen] = useState(!!startOpen);
  const [saved, setSaved] = useState<Options | null>(null);
  const [form, setForm] = useState<Options | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let dead = false;
    api<Options>("GET", `/routines/${enc(r.id)}/options`).then((o) => { if (!dead) { setSaved(o); setForm(o); } }, (e: unknown) => { if (!dead) setError(errText(e)); });
    return () => { dead = true; };
  }, [open, r.id]);
  const dirty = !!form && !!saved && (form.announce !== saved.announce || form.condition !== saved.condition || form.heavy !== saved.heavy);
  const changes = r.trigger !== "cron" && r.trigger !== "once";
  const save = async () => {
    if (!form) return;
    setBusy(true); setError(null);
    try { const o = await api<Options>("PUT", `/routines/${enc(r.id)}/options`, form); setSaved(o); setForm(o); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="routine-edit">
      <button type="button" className="link small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="settings" size={12} /> {t("routineOpt.open")}
      </button>
      {open && (
        <form className="routine-edit-form" onSubmit={(e) => { e.preventDefault(); if (dirty && !busy) void save(); }}>
          {!form ? <p className="small muted"><Spinner size={11} /> {t("common.loading")}</p> : (
            <>
              <div className="field">
                <label className="field-label" htmlFor={ids.announce}>{t("routineOpt.announce")}</label>
                <select id={ids.announce} className="input" value={form.announce} onChange={(e) => setForm({ ...form, announce: e.target.value === "chat" ? "chat" : "thread" })}>
                  <option value="thread">{t("routineOpt.announceThread")}</option>
                  <option value="chat">{t("routineOpt.announceChat")}</option>
                </select>
                <p className="field-hint">{t("routineOpt.announceHint")}</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={ids.condition}>{t("routineOpt.condition")}</label>
                <input id={ids.condition} className="input" value={form.condition} maxLength={500} placeholder={t("routineOpt.conditionPlaceholder")} onChange={(e) => setForm({ ...form, condition: e.target.value })} />
                <p className="field-hint">{t(changes ? "routineOpt.conditionHint" : "routineOpt.conditionHintSchedule")}</p>
              </div>
              <label className="check-row" htmlFor={ids.heavy}>
                <input id={ids.heavy} type="checkbox" checked={form.heavy} onChange={(e) => setForm({ ...form, heavy: e.target.checked })} />
                <span><strong>{t("routineOpt.heavy")}</strong><br /><span className="small muted">{t("routineOpt.heavyHint")}</span></span>
              </label>
            </>
          )}
          <ErrorNote>{error}</ErrorNote>
          <div className="row-end">
            <span className="spacer" />
            <button type="submit" className="btn btn-small btn-primary" disabled={!dirty || busy}>
              {busy ? <><Spinner size={12} /> {t("routineEdit.saving")}</> : t("routineEdit.save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
