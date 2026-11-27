import { useMemo, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { welcomeFor } from "../lib/starters";
import { useStore } from "../store";
import type { Bot } from "../types";
import { Icon } from "./Icon";
import "./Comfort7.css";

/**
 * L145 « Tour d'accueil »: in a new bot's empty chat, one question with 3 choices (one click sends it) and four starter
 * requests fitted to its role (they go into the message box, to adjust before sending). Nothing runs until a click.
 */
export function BotWelcome({ bot }: { bot: Bot }) {
  const t = useT();
  const w = useMemo(() => welcomeFor(bot, (key) => t(key as Key)), [bot, t]);
  const [sending, setSending] = useState<string | null>(null);
  const send = async (label: string, prompt: string) => {
    setSending(label);
    try { await api("POST", `/bots/${enc(bot.id)}/messages`, { text: prompt }); } catch (e) { useStore.getState().showToast(errText(e)); setSending(null); }
  };
  const draft = (prompt: string) => { const s = useStore.getState(); s.setDraft(bot.id, prompt); s.focusComposer(); };
  return (
    <section className="welcome" aria-labelledby={`welcome-${bot.id}`}>
      <p className="welcome-q" id={`welcome-${bot.id}`}><Icon name="chat" size={15} /> {w.question}</p>
      <div className="welcome-choices">
        {w.choices.map((c) => (
          <button key={c.label} type="button" className="btn welcome-choice" disabled={sending !== null} onClick={() => void send(c.label, c.prompt)}>
            {sending === c.label ? "…" : c.label}
          </button>
        ))}
      </div>
      <p className="welcome-sub muted small">{t("c7.welcome.starters")}</p>
      <div className="ideas-grid welcome-starters">
        {w.starters.map((s) => (
          <button key={s.label} type="button" className="idea" onClick={() => draft(s.prompt)} title={s.prompt}>
            <span className="idea-title">{s.label}</span>
            <span className="idea-why muted small">{s.prompt}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
