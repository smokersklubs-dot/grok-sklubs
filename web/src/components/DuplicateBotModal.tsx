import { useId, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { BotAvatar } from "./Avatar";
import { ErrorNote, Modal, Toggle } from "./ui";

/** Duplicate a bot: settings, look, instructions and skills always; memories and the conversation only if chosen. */
export function DuplicateBotModal({ botId, onClose }: { botId: string; onClose: () => void }) {
  const bot = useStore((s) => s.bots[botId]);
  const t = useT();
  const uid = useId();
  const [name, setName] = useState(() => (bot ? t("duplicate.defaultName", { name: bot.name }) : ""));
  const [memories, setMemories] = useState(false);
  const [conversation, setConversation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!bot) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ bot: Bot }>("POST", `/bots/${enc(bot.id)}/duplicate`, { name: name.trim(), memories, conversation });
      const s = useStore.getState();
      s.upsertBot(r.bot);
      onClose();
      s.selectBot(r.bot.id);
      s.showToast(t("duplicate.done", { name: r.bot.name }));
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title={t("duplicate.title", { name: bot.name })} onClose={onClose} size="sm">
      <form className="modal-body duplicate-form" onSubmit={submit}>
        <div className="duplicate-head">
          <BotAvatar bot={bot} size={44} badge />
          <p className="muted small">{t("duplicate.copies")}</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}n`}>{t("common.name")}</label>
          <input id={`${uid}n`} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="action-row">
          <div>
            <p className="action-title">{t("duplicate.memories")}</p>
            <p className="muted small">{t("duplicate.memoriesHint")}</p>
          </div>
          <Toggle checked={memories} label={t("duplicate.memories")} onChange={setMemories} />
        </div>
        <div className="action-row">
          <div>
            <p className="action-title">{t("duplicate.conversation")}</p>
            <p className="muted small">{t("duplicate.conversationHint")}</p>
          </div>
          <Toggle checked={conversation} label={t("duplicate.conversation")} onChange={setConversation} />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{t(busy ? "common.creating" : "duplicate.go")}</button>
        </div>
      </form>
    </Modal>
  );
}
