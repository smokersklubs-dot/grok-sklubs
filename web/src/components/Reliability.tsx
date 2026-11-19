import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import type { ModelOption, ReliabilitySettings } from "../types";
import { Icon } from "./Icon";
import { ErrorNote, IconButton, Loading, Toggle } from "./ui";
import { ApiProvidersSection, ServerModelPricesSection } from "./SecretsFilesProviders";
import { AiAccountCards } from "./AiAccounts";
import { TeamModels } from "./TeamModels";
import { ClaudeTeamAccess } from "./ClaudeTeamAccess";

/** The models offered on this server (API models only: subscription engines run a different kind of turn). */
export function useApiModels(reload = 0) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  useEffect(() => {
    let dead = false;
    api<{ models: ModelOption[] }>("GET", "/models").then((r) => !dead && setModels(r.models.filter((m) => m.kind === "api" && !m.ref.startsWith("demo:"))), () => !dead && setModels([]));
    return () => { dead = true; };
  }, [reload]);
  return models;
}

/** An ordered list of backup models: add from the server's models, move up and down, remove. At most 5. */
export function FallbackEditor({ value, onChange, models, exclude, label }: { value: string[]; onChange: (next: string[]) => void; models: ModelOption[]; exclude?: string; label: string }) {
  const t = useT();
  const [adding, setAdding] = useState("");
  const name = (ref: string) => models.find((m) => m.ref === ref);
  const offer = models.filter((m) => !value.includes(m.ref) && m.ref !== exclude);
  const move = (i: number, d: -1 | 1) => { const next = [...value]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };
  return (
    <div className="fallbacks" aria-label={label}>
      {value.length === 0 ? <p className="muted small">{t("models.none")}</p> : (
        <ol className="fallback-list">
          {value.map((ref, i) => {
            const m = name(ref);
            return (
              <li key={ref} className="fallback-row">
                <span className="fallback-rank" aria-hidden="true">{i + 1}</span>
                <span className="fallback-text">
                  <span className="fallback-title">{m?.model ?? ref}</span>
                  <span className="fallback-sub">{m ? m.provider : t("models.unavailable")}</span>
                </span>
                <IconButton icon="arrowUp" size={15} label={t("models.up", { model: m?.model ?? ref })} onClick={() => move(i, -1)} disabled={i === 0} />
                <IconButton icon="arrowDown" size={15} label={t("models.down", { model: m?.model ?? ref })} onClick={() => move(i, 1)} disabled={i === value.length - 1} />
                <IconButton icon="close" size={15} label={t("models.remove", { model: m?.model ?? ref })} onClick={() => onChange(value.filter((r) => r !== ref))} />
              </li>
            );
          })}
        </ol>
      )}
      {value.length < 5 && offer.length > 0 && (
        <div className="fallback-add">
          <select className="input" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={t("models.pick")}>
            <option value="">{t("models.pick")}</option>
            {offer.map((m) => <option key={m.ref} value={m.ref}>{m.model} — {m.provider}</option>)}
          </select>
          <button type="button" className="btn btn-small" disabled={!adding} onClick={() => { onChange([...value, adding]); setAdding(""); }}>
            <Icon name="plus" size={14} /> {t("models.add")}
          </button>
        </div>
      )}
    </div>
  );
}

const RETRIES = [0, 1, 2, 3, 4, 5, 6];
const CONTINUATIONS = [0, 1, 2, 3, 4, 5];

/** Settings → Models: the account's backup models and how hard a turn tries before giving up. */
export function ModelsSection() {
  const t = useT();
  const [reload, setReload] = useState(0);
  const models = useApiModels(reload);
  const [state, setState] = useState<ReliabilitySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<ReliabilitySettings>("GET", "/reliability").then(setState, (e) => setError(errText(e)));
  }, []);
  const save = async (patch: Partial<ReliabilitySettings>) => {
    if (!state) return;
    setState({ ...state, ...patch });
    setError(null);
    try {
      setState(await api<ReliabilitySettings>("PUT", "/reliability", patch));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <>
      <h2>{t("settings.section.models")}</h2>
      <AiAccountCards subscriptionsOnly />
      <TeamModels />
      <ClaudeTeamAccess />
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <details className="model-advanced">
        <summary>{t("models.advancedApi")}</summary>
        <ApiProvidersSection onChanged={() => setReload((n) => n + 1)} />
        <ServerModelPricesSection />
      </details>
      {!state || !models ? <Loading /> : (
        <>
          <h3 className="pane-heading">{t("models.fallbacks")}</h3>
          <p className="muted small">{t("models.fallbacksHint")}</p>
          <FallbackEditor label={t("models.fallbacks")} value={state.fallbackModels} models={models} onChange={(fallbackModels) => void save({ fallbackModels })} />
          {state.fallbackModels.length === 0 && state.envFallbacks.length > 0 && <p className="muted small">{t("models.envFallbacks", { list: state.envFallbacks.join(", ") })}</p>}

          <h3 className="pane-heading">{t("models.tries")}</h3>
          <div className="field-row">
            <label className="field">
              <span className="field-label">{t("models.retries")}</span>
              <select className="input" value={state.maxRetries} onChange={(e) => void save({ maxRetries: Number(e.target.value) })}>
                {RETRIES.map((n) => <option key={n} value={n}>{n === 0 ? t("models.never") : String(n)}</option>)}
              </select>
              <span className="field-hint">{t("models.retriesHint")}</span>
            </label>
            <label className="field">
              <span className="field-label">{t("models.continuations")}</span>
              <select className="input" value={state.maxContinuations} onChange={(e) => void save({ maxContinuations: Number(e.target.value) })}>
                {CONTINUATIONS.map((n) => <option key={n} value={n}>{n === 0 ? t("models.never") : String(n)}</option>)}
              </select>
              <span className="field-hint">{t("models.continuationsHint")}</span>
            </label>
          </div>
          <h3 className="pane-heading">{t("models.mutualAid")}</h3>
          <div className="action-row">
            <div>
              <p className="action-title">{t("models.mutualAid")}</p>
              <p className="muted small">{t("models.mutualAidHint")}</p>
            </div>
            <Toggle checked={state.mutualAid} label={t("models.mutualAid")} onChange={(mutualAid) => void save({ mutualAid })} />
          </div>
          <ul className="list reliability-facts">
            <li className="list-row is-card"><Icon name="refresh" size={16} /><span className="list-row-text"><span className="list-row-title">{t("models.fact.retry")}</span><span className="list-row-sub">{t("models.fact.retryText")}</span></span></li>
            <li className="list-row is-card"><Icon name="clock" size={16} /><span className="list-row-text"><span className="list-row-title">{t("models.fact.stuck")}</span><span className="list-row-sub">{t("models.fact.stuckText")}</span></span></li>
            <li className="list-row is-card"><Icon name="shield" size={16} /><span className="list-row-text"><span className="list-row-title">{t("models.fact.loop")}</span><span className="list-row-sub">{t("models.fact.loopText")}</span></span></li>
          </ul>
          {saved && <p className="muted small" role="status">{t("common.saved")}</p>}
        </>
      )}
    </>
  );
}

/** In a bot's settings: its own backup list, or the account's. Saved at once. */
export function BotFallbacks({ botId, value, ownModel }: { botId: string; value: string[] | null; ownModel: string }) {
  const t = useT();
  const models = useApiModels();
  const [list, setList] = useState<string[] | null>(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setList(value), [value]);
  const save = async (next: string[] | null) => {
    setList(next);
    setError(null);
    try { await api("PATCH", `/bots/${botId}`, { fallbackModels: next }); } catch (e) { setError(errText(e)); }
  };
  return (
    <div className="field">
      <span className="field-label">{t("models.botHeading")}</span>
      <label className="check-row">
        <input type="checkbox" checked={list === null} onChange={(e) => void save(e.target.checked ? null : [])} />
        <span>{t("models.botUseAccount")}</span>
      </label>
      {list !== null && models && <FallbackEditor label={t("models.botHeading")} value={list} models={models} exclude={ownModel} onChange={(next) => void save(next)} />}
      <p className="field-hint">{t("models.botHint")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}
