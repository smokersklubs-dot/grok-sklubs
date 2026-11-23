import { useEffect, useState } from "react";
import { api } from "../api";
import { useT, type Key } from "../i18n";
import type { Bot, ModelOption } from "../types";
import { TASK_KINDS, type BoardDecision, type BoardModelSet, type BoardRole, type BoardTask, type TaskKind } from "../../../server/src/workboardtypes";
import { Icon } from "./Icon";

/**
 * « Tableau de travail », the rest of L163 (server workboardroles.ts; clean room: 10-timon.md T10–T12): the open
 * decisions at the top of the board, the project roles (who holds each, its model, « épinglé »), the saved model sets,
 * and on a task its kind, its model, the model it will run on and who really runs it, with why.
 */
const ROLE_KEY: Record<string, Key> = { lead: "board.role.lead", code: "board.role.code", review: "board.role.review", research: "board.role.research", docs: "board.role.docs", chore: "board.role.chore" };
const WHY_KEY: Record<string, Key> = { pinned: "board.exec.pinned", named: "board.exec.named", role: "board.exec.role", "lead-redirected": "board.exec.leadRedirected", "other-role": "board.exec.otherRole", none: "board.exec.none" };
const FROM_KEY: Record<string, Key> = { task: "board.model.fromTask", role: "board.model.fromRole", bot: "board.model.fromBot" };

let modelCache: Promise<string[]> | null = null;
/** The account's models, for the pickers (one request per page). */
export function useModels(): string[] {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    modelCache ??= api<{ models: ModelOption[] }>("GET", "/models").then((r) => r.models.filter((m) => !m.ref.startsWith("demo:")).map((m) => m.ref), () => []);
    let live = true;
    void modelCache.then((l) => { if (live) setList(l); });
    return () => { live = false; };
  }, []);
  return list;
}

function ModelSelect({ value, onChange, label, models, empty }: { value: string; onChange: (v: string) => void; label: string; models: string[]; empty: string }) {
  const all = value && !models.includes(value) ? [value, ...models] : models;
  return <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}><option value="">{empty}</option>{all.map((m) => <option key={m} value={m}>{m}</option>)}</select>;
}

export function BoardDecisions({ decisions }: { decisions?: BoardDecision[] }) {
  const t = useT();
  if (!decisions?.length) return null;
  return (
    <section className="wb-decisions" aria-label={t("board.decisions.title")}>
      <h4><Icon name="alert" size={14} /> {t("board.decisions.title")} <span className="chip">{decisions.length}</span></h4>
      <ul>
        {decisions.map((d) => (
          <li key={d.taskId}>
            <strong>{d.title}</strong>
            <span className="muted"> — {d.kind === "review" ? t("board.decisions.review") : d.kind === "nobody" ? t("board.decisions.nobody") : t("board.decisions.blocked", { why: d.why || "?" })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BoardRolesPanel({ roles, sets, bots, act }: { roles?: BoardRole[]; sets?: BoardModelSet[]; bots: Bot[]; act: (fn: () => Promise<unknown>) => void }) {
  const t = useT();
  const models = useModels();
  const [setName, setSetName] = useState("");
  if (!roles) return null;
  const put = (role: string, body: Record<string, unknown>) => act(() => api("PUT", `/board/roles/${role}`, body));
  const withModel = roles.filter((r) => r.model);
  return (
    <details className="wb-roles">
      <summary><Icon name="users" size={14} /> {t("board.roles.title")}</summary>
      <p className="muted wb-small">{t("board.roles.help")}</p>
      <div className="wb-roles-list">
        {roles.map((r) => (
          <div key={r.role} className="wb-role">
            <span className="wb-role-name">{t(ROLE_KEY[r.role])}</span>
            <select value={r.botId ?? ""} onChange={(e) => put(r.role, { botId: e.target.value || null })} aria-label={t("board.roles.botFor", { role: t(ROLE_KEY[r.role]) })}>
              <option value="">{r.role === "lead" ? t("board.roles.mainBot") : t("board.roles.nobody")}</option>
              {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <ModelSelect value={r.model} models={models} onChange={(v) => put(r.role, { model: v })} label={t("board.roles.modelFor", { role: t(ROLE_KEY[r.role]) })} empty={t("board.model.botOwn")} />
            {r.role === "lead" ? <span aria-hidden="true" /> : <label className="wb-check"><input type="checkbox" checked={r.pinned} disabled={!r.botId} onChange={(e) => put(r.role, { pinned: e.target.checked })} />{t("board.roles.pinned")}</label>}
          </div>
        ))}
      </div>
      <div className="wb-sets">
        <strong className="wb-small">{t("board.sets.title")}</strong>
        {(sets ?? []).map((s) => (
          <div key={s.id} className="wb-set">
            <span className="wb-set-name">{s.name}</span>
            <span className="muted wb-small">{Object.entries(s.models).map(([role, m]) => `${t(ROLE_KEY[role])} : ${m}`).join(" · ")}</span>
            <button type="button" className="btn btn-small" onClick={() => act(async () => {
              const r = await api<{ skipped: { role: string; model: string }[] }>("POST", `/board/model-sets/${s.id}/apply`);
              if (r.skipped.length) throw new Error(t("board.sets.skipped", { list: r.skipped.map((x) => `${t(ROLE_KEY[x.role])} (${x.model})`).join(", ") }));
            })}>{t("board.sets.apply")}</button>
            <button type="button" className="btn btn-small btn-ghost" aria-label={t("board.sets.delete", { name: s.name })} onClick={() => act(() => api("DELETE", `/board/model-sets/${s.id}`))}><Icon name="trash" size={13} /></button>
          </div>
        ))}
        {withModel.length > 0 && (
          <form className="wb-inline" onSubmit={(e) => { e.preventDefault(); act(() => api("POST", "/board/model-sets", { name: setName, models: Object.fromEntries(withModel.map((r) => [r.role, r.model])) })); setSetName(""); }}>
            <input value={setName} onChange={(e) => setSetName(e.target.value)} maxLength={60} placeholder={t("board.sets.namePh")} aria-label={t("board.sets.name")} />
            <button type="submit" className="btn btn-small" disabled={!setName.trim()}>{t("board.sets.save")}</button>
          </form>
        )}
      </div>
    </details>
  );
}

/** The kind and model fields of the new-task form. */
export function TaskKindModel({ kind, model, onKind, onModel }: { kind: TaskKind | ""; model: string; onKind: (k: TaskKind | "") => void; onModel: (m: string) => void }) {
  const t = useT();
  const models = useModels();
  return (
    <>
      <label className="field"><span>{t("board.task.kind")}</span><select value={kind} onChange={(e) => onKind(e.target.value as TaskKind | "")}><option value="">{t("board.task.noKind")}</option>{TASK_KINDS.map((k) => <option key={k} value={k}>{t(ROLE_KEY[k])}</option>)}</select></label>
      <label className="field"><span>{t("board.task.model")}</span><ModelSelect value={model} models={models} onChange={onModel} label={t("board.task.model")} empty={t("board.model.roleOrBot")} /></label>
    </>
  );
}

/** On a task card: who really runs it and why; the model it runs on and from where. */
export function TaskRunLine({ task, bots }: { task: BoardTask; bots: Bot[] }) {
  const t = useT();
  if (!task.execReason) return null;
  const who = bots.find((b) => b.id === task.executorId)?.name;
  const moved = task.executorId && task.executorId !== task.botId;
  return (
    <p className="wb-line wb-run muted">
      {task.kind ? <span className="chip">{t(ROLE_KEY[task.kind])}</span> : null}{" "}
      {who ? <span title={t(WHY_KEY[task.execReason])}>{t("board.exec.by", { name: who })}{moved || task.execReason !== "named" ? ` (${t(WHY_KEY[task.execReason])})` : ""}</span> : task.execReason === "none" && task.kind ? <span>{t("board.exec.none")}</span> : null}
      {task.runModel ? <span> · {t("board.model.runs", { model: task.runModel, from: t(FROM_KEY[task.modelFrom ?? "bot"]) })}</span> : null}
    </p>
  );
}
