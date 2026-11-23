import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { api, enc } from "../api";
import { useT, useLocale, type Key } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { quickSend } from "../lib/quicksend";
import { selfCheckLines, selfCheckMessage, selfCheckToken, type CheckReport, type CheckState } from "../lib/selfcheck";
import { Icon, Spinner } from "./Icon";
import { MenuItem, Modal } from "./ui";
import "./BotSelfCheck.css";

/**
 * L153 « Vérifier ce bot »: one click sends the bot a short test (lib/selfcheck.ts) — read a page, save a file with a
 * one-time word, read it back — and this window follows it live from what the server can see (server/src/selfcheck.ts):
 * the page read, the file, and the journal lines of those steps. Nothing is fixed or changed for the owner.
 */
interface Report extends CheckReport { journal: { id: number; at: number; tool: string; label: string; status: string; decision: string }[] }

const MARK: Record<CheckState, { icon: "check" | "close" | null; key: Key }> = { ok: { icon: "check", key: "selfcheck.ok" }, fail: { icon: "close", key: "selfcheck.fail" }, wait: { icon: null, key: "selfcheck.wait" } };

function Line({ state, label, hint }: { state: CheckState; label: string; hint: string }) {
  const t = useT();
  const m = MARK[state];
  return (
    <li className={`selfcheck-line is-${state}`}>
      <span className="selfcheck-mark" aria-hidden="true">{m.icon ? <Icon name={m.icon} size={14} /> : <Spinner size={14} />}</span>
      <span className="selfcheck-text"><strong>{label}</strong><span className="muted small">{hint}</span></span>
      <span className="selfcheck-state">{t(m.key)}</span>
    </li>
  );
}

export function BotSelfCheck({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const t = useT();
  const lang = useLocale();
  const start = useRef<{ token: string; since: number } | null>(null);
  const [sent, setSent] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [report, setReport] = useState<Report | null>(null);
  const [now, setNow] = useState(Date.now());
  const lines = selfCheckLines(report, start.current ? now - start.current.since : 0);
  const begin = async () => {
    const bytes = crypto.getRandomValues(new Uint32Array(8));
    let i = 0;
    const token = selfCheckToken(() => bytes[i++ % 8] / 2 ** 32);
    start.current = { token, since: Date.now() - 1000 };
    setReport(null); setSent("sending");
    setSent((await quickSend(bot.id, selfCheckMessage(lang, token, location.origin + "/"))) ? "sent" : "error");
  };
  useEffect(() => {
    if (sent !== "sent" || lines.done) return;
    const poll = async () => {
      setNow(Date.now());
      const s = start.current;
      if (s) try { setReport(await api<Report>("GET", `/bots/${enc(bot.id)}/selfcheck?token=${s.token}&since=${s.since}`)); } catch { /* next time */ }
    };
    void poll();
    const timer = setInterval(poll, 4000);
    return () => clearInterval(timer);
  }, [sent, lines.done, bot.id]);
  return (
    <Modal title={t("selfcheck.title", { name: bot.name })} onClose={onClose} size="md" className="selfcheck">
      <div className="selfcheck-body">
        <p className="muted">{t("selfcheck.intro", { name: bot.name })}</p>
        {sent !== "idle" && (
          <ol className="selfcheck-lines">
            <Line state={sent === "error" ? "fail" : lines.page} label={t("selfcheck.page")} hint={t("selfcheck.pageHint")} />
            <Line state={sent === "error" ? "fail" : lines.file} label={t("selfcheck.file")} hint={t("selfcheck.fileHint")} />
            <Line state={sent === "error" ? "fail" : lines.journal} label={t("selfcheck.journal")} hint={t("selfcheck.journalHint")} />
          </ol>
        )}
        {report && report.journal.length > 0 && (
          <ul className="selfcheck-journal" aria-label={t("selfcheck.journal")}>
            {report.journal.slice(0, 12).map((j) => (
              <li key={j.id}><code>{j.tool}</code> <span className="truncate">{j.label}</span> <span className={`chip is-${j.status}`}>{["done", "failed", "uncertain", "denied"].includes(j.status) ? t(`selfcheck.st.${j.status}` as Key) : j.status}</span></li>
            ))}
          </ul>
        )}
        {lines.done && <p className="selfcheck-verdict" role="status">{t(lines.page === "ok" && lines.file === "ok" && lines.journal === "ok" ? "selfcheck.allGood" : "selfcheck.someFailed", { name: bot.name })}</p>}
        <div className="remark-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t("common.close")}</button>
          <button type="button" className="btn btn-accent" disabled={sent === "sending" || (sent === "sent" && !lines.done)} onClick={() => void begin()}>
            {t(sent === "idle" ? "selfcheck.start" : "selfcheck.again")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Which bot's check is open (outside the chat menu, which closes on the first click elsewhere). */
const useSelfCheck = create<{ botId: string | null }>(() => ({ botId: null }));

/** « Vérifier ce bot » in the chat's menu (owner's own agent bots only). */
export function SelfCheckMenuItem({ bot, onDone }: { bot: Bot; onDone: () => void }) {
  const t = useT();
  if (bot.access || bot.kind !== "agent") return null;
  return <MenuItem icon="wrench" onClick={() => { onDone(); useSelfCheck.setState({ botId: bot.id }); }}>{t("selfcheck.menu")}</MenuItem>;
}

/** The open check, if any (ChatView.tsx). */
export function SelfCheckHost() {
  const id = useSelfCheck((s) => s.botId);
  const bot = useStore((s) => (id ? s.bots[id] : undefined));
  return bot ? <BotSelfCheck key={bot.id} bot={bot} onClose={() => useSelfCheck.setState({ botId: null })} /> : null;
}
