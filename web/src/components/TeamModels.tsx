import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { ENGINE_BRAND, engineOfRef, prettyModel } from "../lib/engines";
import { useStore } from "../store";
import type { Bot, ModelOption } from "../types";
import { ErrorNote } from "./ui";
import { ConnectFlow } from "./AiAccounts";

function modelName(m: ModelOption) {
  const engine = engineOfRef(m.ref);
  return engine ? `${ENGINE_BRAND[engine]} · ${prettyModel(m.model)}` : `${m.provider} · ${m.model}`;
}

function ModelRow({ bot, models, main }: { bot: Bot; models: ModelOption[]; main?: Bot }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"unchecked" | "connected" | "missing">("unchecked");
  const [connecting, setConnecting] = useState(false);
  const engine = engineOfRef(bot.model);
  async function checkConnection() {
    if (!engine) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ signedIn: boolean }>("GET", `/connect-subscription/status?bot=${enc(bot.id)}&engine=${engine}`);
      setConnection(result.signedIn ? "connected" : "missing");
    } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  }
  async function save(model: string) {
    setBusy(true); setError("");
    try {
      const result = await api<{ bot: Bot }>("PATCH", `/bots/${enc(bot.id)}`, { model });
      useStore.getState().upsertBot(result.bot);
    } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  }
  const choices = models.filter((m) => !m.ref.startsWith("demo:") || m.ref === bot.model);
  return <div className="team-model-row">
    <label htmlFor={`team-model-${bot.id}`}>{bot.name}{bot.primary && <span className="muted small"> · {t("teamModels.main")}</span>}</label>
    <select className="input" id={`team-model-${bot.id}`} disabled={busy} value={bot.model} onChange={(e) => void save(e.target.value)}>
      <option value="">{t("bot.serverDefault")}</option>
      {bot.model && !choices.some((m) => m.ref === bot.model) && <option value={bot.model}>{bot.model}</option>}
      {choices.map((m) => <option key={m.ref} value={m.ref}>{modelName(m)}</option>)}
    </select>
    {engine && <div className="team-model-connection">
      {connection !== "unchecked" && <span role="status">{t(connection === "connected" ? "teamModels.connected" : "teamModels.missing")}</span>}
      {connection === "missing" ? <button type="button" className="link" disabled={busy} onClick={() => setConnecting(true)}>{t("teamModels.connect", { brand: ENGINE_BRAND[engine] })}</button> :
        <button type="button" className="link" disabled={busy} onClick={() => void checkConnection()}>{t("teamModels.check")}</button>}
    </div>}
    {connecting && engine && <ConnectFlow engine={engine} info={{ allowed: true, why: null, whyText: null, bots: [bot], mainBotId: bot.id }}
      onClose={() => { setConnecting(false); void checkConnection(); }} />}
    {main?.model && main.id !== bot.id && main.model !== bot.model && choices.some((m) => m.ref === main.model) &&
      <button type="button" disabled={busy} className="link" onClick={() => void save(main.model)}>{t("teamModels.copy", { name: main.name })}</button>}
    {error && <ErrorNote>{error}</ErrorNote>}
  </div>;
}

export function TeamModels() {
  const bots = useStore((s) => s.bots);
  const t = useT();
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api<{ models: ModelOption[] }>("GET", "/models").then((r) => {
      if (active) setModels(r.models);
    }, (e) => { if (active) setError(errText(e)); });
    return () => { active = false; };
  }, [attempt]);
  const agents = Object.values(bots).filter((b) => b.kind === "agent" && !b.access).sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
  return <section className="team-models"><h3 className="pane-heading">{t("teamModels.title")}</h3>
    <p className="muted small">{t("teamModels.hint")}</p>
    {error && <><ErrorNote>{error}</ErrorNote><button type="button" className="btn btn-small" onClick={() => { setError(""); setAttempt((n) => n + 1); }}>{t("localTools.retry")}</button></>}
    {models ? agents.map((bot) => <ModelRow key={bot.id + ":" + bot.model} bot={bot} models={models} main={agents.find((b) => b.primary)} />) : !error && <p role="status">{t("common.loading")}</p>}
  </section>;
}
