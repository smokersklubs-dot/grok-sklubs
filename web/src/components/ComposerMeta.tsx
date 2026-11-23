import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { prettyModel } from "../lib/engines";
import { useStore } from "../store";
import type { Bot, Live, ModelOption } from "../types";
import type { PromptView } from "../types";
import { Gloss } from "./Gloss";
import { Icon } from "./Icon";
import { Menu, MenuItem } from "./ui";
import "./Comfort7.css";

/**
 * Above the composer (backlog A-FAIRE L150 / L138): the model of this conversation, changed in two clicks (the bot's own
 * model stays its default), and how full the conversation's context is, with « Compacter » one tap away in the bot's
 * memory settings. Both read from the server; nothing is guessed: an unknown value shows « — », never 0 %.
 */
export function ComposerMeta({ bot, live }: { bot: Bot; live: Live }) {
  const t = useT();
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [percent, setPercent] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const running = live.running;
  useEffect(() => {
    let dead = false;
    api<{ conversations: { generation: number; model: string; current: boolean }[] }>("GET", `/bots/${enc(bot.id)}/conversations`)
      .then((r) => !dead && setChosen(r.conversations.find((c) => c.current)?.model ?? ""), () => !dead && setChosen(""));
    return () => { dead = true; };
  }, [bot.id, bot.generation]);
  useEffect(() => {
    if (running) return;
    let dead = false;
    api<PromptView>("GET", `/bots/${enc(bot.id)}/prompt-view`).then((r) => !dead && setPercent(Number.isFinite(r.context?.percent) ? r.context.percent : null), () => !dead && setPercent(null));
    return () => { dead = true; };
  }, [bot.id, bot.generation, running]);
  const openMenu = () => {
    setMenu((v) => !v);
    if (!models) api<{ models: ModelOption[] }>("GET", `/models?bot=${enc(bot.id)}`).then((r) => setModels(r.models.filter((m) => !m.ref.startsWith("demo:"))), () => setModels([]));
  };
  const pick = async (ref: string) => {
    setMenu(false);
    try {
      await api("PATCH", `/bots/${enc(bot.id)}/conversations/${bot.generation}`, { model: ref });
      setChosen(ref);
      useStore.getState().showToast(ref ? t("c7.model.set", { model: prettyModel(ref.split(":").slice(1).join(":")) }) : t("c7.model.reset"));
    } catch (e) { useStore.getState().showToast(errText(e)); }
  };
  const label = (ref: string) => { const m = ref.split(":").slice(1).join(":") || ref; return m === "default" ? t("c7.model.default") : prettyModel(m); };
  const current = chosen || bot.model;
  const level = percent === null ? "unknown" : percent >= 85 ? "high" : percent >= 60 ? "mid" : "low";
  return (
    <div className="composer-meta">
      <div className="menu-wrap">
        <button type="button" className={`chip chip-button composer-model${chosen ? " is-chosen" : ""}`} aria-haspopup="menu" aria-expanded={menu} onClick={openMenu}
          title={t("c7.model.title")} aria-label={t("c7.model.aria", { model: current ? label(current) : t("c7.model.default") })}>
          <Icon name="brain" size={13} /> <span className="truncate">{current ? label(current) : t("c7.model.default")}</span>{chosen && <span className="composer-model-tag">{t("c7.model.thisChat")}</span>}
          <Icon name="chevronDown" size={12} />
        </button>
        <Menu open={menu} onClose={() => setMenu(false)} side="top" label={t("c7.model.title")}>
          <MenuItem icon={chosen ? "refresh" : "check"} onClick={() => void pick("")}>{t("c7.model.botDefault", { model: bot.model ? label(bot.model) : t("c7.model.default") })}</MenuItem>
          {models === null && <MenuItem icon="clock" onClick={() => {}}>{t("common.loading")}</MenuItem>}
          {models?.map((m) => (
            <MenuItem key={m.ref} icon={m.ref === chosen ? "check" : "brain"} hint={m.provider} onClick={() => void pick(m.ref)}>{prettyModel(m.model)}</MenuItem>
          ))}
        </Menu>
      </div>
      <span className="composer-gauge" data-level={level}>
        <Gloss term="context" />
        <span className="gauge-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? t("c7.ctx.unknown") : `${percent} %`} aria-label={t("c7.ctx.label")}>
          <span style={{ width: `${Math.min(100, percent ?? 0)}%` }} />
        </span>
        <button type="button" className="link small" onClick={() => useStore.getState().openBotSettings(bot.id, "memories")} title={t("c7.ctx.open")}>
          {percent === null ? "—" : `${percent} %`}
        </button>
      </span>
    </div>
  );
}
