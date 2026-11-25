import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { prettyModel } from "../lib/engines";
import type { ModelOption } from "../types";
import { EFFORTS } from "./ComposerReasoning";
import { ErrorNote } from "./ui";

/**
 * L150 « préréglages par projet » (server projectpresets.ts): in a project's window, the model and the reasoning level the
 * bots of this project use in your conversations, unless a conversation has its own choice. Saved as soon as it changes.
 */
export function ProjectModelPresetField({ sectionId, initial }: { sectionId: string; initial?: { preset: { model: string; effort: string }; models: ModelOption[] } }) {
  const t = useT();
  const [p, setP] = useState<{ model: string; effort: string } | null>(initial?.preset ?? null);
  const [models, setModels] = useState<ModelOption[]>(initial?.models ?? []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initial) return;
    let dead = false;
    api<{ model: string; effort: string }>("GET", `/sections/${enc(sectionId)}/model-preset`).then((v) => !dead && setP(v), (e) => !dead && setError(errText(e)));
    api<{ models: ModelOption[] }>("GET", "/models").then((r) => !dead && setModels(r.models.filter((m) => !m.ref.startsWith("demo:"))), () => undefined);
    return () => { dead = true; };
  }, [sectionId, initial]);
  const save = async (next: { model: string; effort: string }) => {
    setP(next);
    setError(null);
    try { setP(await api<{ model: string; effort: string }>("PUT", `/sections/${enc(sectionId)}/model-preset`, next)); } catch (e) { setError(errText(e)); }
  };
  const known = !p?.model || models.some((m) => m.ref === p.model);
  return (
    <div className="field project-preset">
      <label className="field"><span>{t("preset.model")}</span>
        <select className="input" disabled={!p} value={p?.model ?? ""} onChange={(e) => p && void save({ ...p, model: e.target.value })}>
          <option value="">{t("preset.botOwn")}</option>
          {!known && p && <option value={p.model}>{prettyModel(p.model.split(":").slice(1).join(":") || p.model)}</option>}
          {models.map((m) => <option key={m.ref} value={m.ref}>{prettyModel(m.model)} · {m.provider}</option>)}
        </select>
      </label>
      <label className="field"><span>{t("preset.effort")}</span>
        <select className="input" disabled={!p} value={p?.effort ?? ""} onChange={(e) => p && void save({ ...p, effort: e.target.value })}>
          <option value="">{t("preset.botOwn")}</option>
          {EFFORTS.map((e) => <option key={e} value={e}>{t(`effort.${e}.title`)}</option>)}
        </select>
      </label>
      <p className="muted">{t("preset.help")}</p>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
