/**
 * « Écouter les réponses »: the 🔊 action under a reply, its small player (play/pause, stop, progress), the
 * « Lire les réponses à voix haute » switch of a bot, the chat header's mute button, and the hook that reads new
 * replies as they complete. The playing itself is web/src/lib/listen.ts.
 */
import { useEffect, useRef } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore, type Thread } from "../store";
import type { Bot, Row, RowBody } from "../types";

type MessageBody = Extract<RowBody, { kind: "message" }>;
import { enqueueReply, listen, listenKey, pauseListening, resumeListening, setMuted, stopAuto, stopListening, useListen } from "../lib/listen";
import { Icon } from "./Icon";
import { IconButton, MenuItem, Toggle } from "./ui";

/** The voice settings of whoever wrote the message: in a group chat, the member bot. */
function voiceOf(row: Row): Bot["voice"] {
  const s = useStore.getState();
  const b = row.body as MessageBody;
  const author = b.origin?.kind === "bot" ? s.bots[b.origin.id] : undefined;
  return author?.voice ?? s.bots[row.botId]?.voice ?? { name: "", rate: 1, lang: "auto" };
}

export function ListenButton({ row }: { row: Row }) {
  const t = useT();
  const active = useListen((s) => s.key === listenKey(row.botId, row.seq) && s.status !== "idle");
  const b = row.body as MessageBody;
  return (
    <button
      type="button"
      className={`msg-action msg-listen ${active ? "is-active" : ""}`}
      aria-label={active ? t("listen.stop") : t("listen.playLabel")}
      title={active ? t("listen.stop") : t("listen.play")}
      aria-pressed={active}
      onClick={() => (active ? stopListening() : listen({ botId: row.botId, seq: row.seq, text: b.text, voice: voiceOf(row) }))}
    >
      <Icon name={active ? "stop" : "volume"} size={15} />
    </button>
  );
}

/** Under the message being read: what plays, with its controls. */
export function ListenPlayer({ row }: { row: Row }) {
  const t = useT();
  const st = useListen((s) => (s.key === listenKey(row.botId, row.seq) ? s : null));
  if (!st || st.status === "idle") return null;
  const pct = Math.round(st.progress * 100);
  const label = st.status === "loading" ? t("listen.loading") : st.status === "paused" ? t("listen.paused") : st.status === "error" ? st.error ?? t("listen.failed") : t("listen.playing");
  const note = st.engine === "browser" ? t("listen.browserVoice") : st.voice ? t("listen.voiceOf", { name: st.voice }) : "";
  return (
    <div className={`listen-player is-${st.status}`} role="group" aria-label={t("listen.player")}>
      {st.status !== "error" && (
        <button
          type="button"
          className="msg-action listen-btn"
          disabled={st.status === "loading"}
          aria-label={st.status === "paused" ? t("listen.resume") : t("listen.pause")}
          title={st.status === "paused" ? t("listen.resume") : t("listen.pause")}
          onClick={() => (st.status === "paused" ? resumeListening() : pauseListening())}
        >
          <Icon name={st.status === "paused" ? "play" : "pause"} size={14} />
        </button>
      )}
      <button type="button" className="msg-action listen-btn" aria-label={t("listen.stop")} title={t("listen.stop")} onClick={stopListening}>
        <Icon name={st.status === "error" ? "close" : "stop"} size={14} />
      </button>
      <div className="listen-track" role="progressbar" aria-label={t("listen.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className="listen-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="listen-status" aria-live="polite">
        {label}
        {note && st.status !== "error" && <span className="listen-note"> · {note}</span>}
      </span>
    </div>
  );
}

async function saveReadAloud(bot: Bot, on: boolean): Promise<void> {
  const { upsertBot, showToast } = useStore.getState();
  const next = { ...bot.voice, readAloud: on };
  upsertBot({ ...bot, voice: next });
  if (!on) stopAuto();
  try {
    upsertBot((await api<{ bot: Bot }>("PATCH", `/bots/${bot.id}`, { voice: next })).bot);
  } catch (e) {
    const cur = useStore.getState().bots[bot.id];
    if (cur) upsertBot({ ...cur, voice: bot.voice });
    showToast(errText(e));
  }
}

/** Bot settings → Voix: the switch, with what it does. Only who may change the bot's settings sees it on. */
export function ReadAloudToggle({ bot }: { bot: Bot }) {
  const t = useT();
  const can = !bot.access || bot.access.canManage;
  return (
    <div className="read-aloud-row">
      <div className="read-aloud-text">
        <span className="field-label">{t("listen.readAloud")}</span>
        <span className="muted small">{t("listen.readAloudHint")}</span>
      </div>
      <Toggle checked={!!bot.voice.readAloud} disabled={!can} label={t("listen.readAloud")} onChange={(on) => void saveReadAloud(bot, on)} />
    </div>
  );
}

/** The chat header's menu: the same switch. */
export function ReadAloudMenuItem({ bot, onDone }: { bot: Bot; onDone: () => void }) {
  const t = useT();
  if (bot.kind !== "agent" || (bot.access && !bot.access.canManage)) return null;
  const on = !!bot.voice.readAloud;
  return (
    <MenuItem icon="volume" hint={on ? "✓" : undefined} onClick={() => { onDone(); void saveReadAloud(bot, !on); }}>
      {t("listen.readAloud")}
    </MenuItem>
  );
}

/** In the chat header while replies are read aloud: one tap mutes every voice (and again to unmute). */
export function ReadAloudChip({ bot }: { bot: Bot }) {
  const t = useT();
  const muted = useListen((s) => s.muted);
  if (!bot.voice.readAloud) return null;
  return (
    <IconButton
      icon={muted ? "volumeOff" : "volume"}
      className={`read-aloud-chip ${muted ? "is-muted" : ""}`}
      active={!muted}
      label={muted ? t("listen.unmute") : t("listen.mute")}
      title={muted ? t("listen.muted") : t("listen.readAloudOn")}
      onClick={() => setMuted(!muted)}
    />
  );
}

/**
 * Reads each NEW reply of the open chat as it completes, when the bot's « Lire les réponses à voix haute » is on: the
 * replies already there when the chat opened (or when it was turned on) are never read. Typing or sending stops it.
 */
export function useReadAloud(bot: Bot | undefined, thread: Thread | undefined): void {
  const base = useRef<{ key: string; seq: number } | null>(null);
  const done = useRef(new Set<number>());
  const on = !!bot?.voice.readAloud;
  useEffect(() => {
    if (!bot || !on || !thread?.loaded) { base.current = null; return; }
    const key = `${bot.id}:${thread.generation}`;
    const top = thread.rows.reduce((m, r) => Math.max(m, r.seq), 0);
    if (!base.current || base.current.key !== key) { base.current = { key, seq: top }; done.current = new Set(); return; }
    for (const r of thread.rows) {
      if (r.seq <= base.current.seq || r.thread || done.current.has(r.seq)) continue;
      const b = r.body;
      if (b.kind !== "message" || b.role !== "assistant" || b.streaming || !b.text.trim()) continue;
      done.current.add(r.seq);
      enqueueReply({ botId: r.botId, seq: r.seq, text: b.text, voice: voiceOf(r) });
    }
  }, [bot, on, thread]);
  useEffect(() => {
    if (!on) return;
    const stop = (e: Event) => { if ((e.target as Element | null)?.closest?.(".composer")) stopAuto(); };
    document.addEventListener("keydown", stop, true);
    document.addEventListener("pointerdown", stop, true);
    return () => { document.removeEventListener("keydown", stop, true); document.removeEventListener("pointerdown", stop, true); };
  }, [on]);
}
