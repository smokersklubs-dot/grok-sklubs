import { useEffect, useRef, useState } from "react";
import { IDLE_LIVE, useStore } from "../store";
import { bargeIn, endCall, setMuted } from "../lib/call";
import { callClock } from "../lib/format";
import { BotAvatar } from "./Avatar";
import { activityPhrase } from "./Transcript";
import { IconButton, useTick } from "./ui";

/** Shown above the composer while a voice call with this bot is connecting, live, or has just failed. */
export function CallBar({ botId }: { botId: string }) {
  const call = useStore((s) => s.call);
  const bot = useStore((s) => s.bots[botId]);
  const live = useStore((s) => s.live[botId] ?? IDLE_LIVE);
  const rows = useStore((s) => s.threads[botId]?.rows);
  const [expanded, setExpanded] = useState(false);
  const now = useTick(1000, !!call && call.status === "live");
  const log = useRef<HTMLDivElement>(null);
  const lineCount = call?.lines.length ?? 0;

  useEffect(() => {
    if (expanded && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [expanded, lineCount]);

  if (!call || call.botId !== botId || !bot) return null;

  const isLive = call.status === "live";
  let status: string;
  let shimmer = false;
  if (call.status === "connecting") status = "Connecting…";
  else if (call.status === "error") status = call.error ?? "The call ended unexpectedly.";
  else if (call.speaking) status = "Speaking";
  else if (live.running) {
    status = `${activityPhrase(live, rows ?? [], now)}…`;
    shimmer = true;
  } else if (call.muted) status = "You're muted";
  else status = "Listening";

  const halo = call.status === "error" ? "is-error" : call.speaking ? "is-speaking" : live.running ? "is-working" : call.muted ? "" : isLive ? "is-listening" : "";
  const finals = call.lines;
  const tail = finals.slice(-2);

  return (
    <section className={`callbar ${call.status === "error" ? "is-error" : ""}`} aria-label="Voice chat">
      <div className="callbar-main">
        <span className={`halo ${halo}`}>
          <BotAvatar bot={bot} size={34} />
        </span>
        <div className="callbar-text">
          <span className="callbar-name">
            {bot.name}
            {isLive && call.startedAt && <span className="callbar-clock">{callClock(now - call.startedAt)}</span>}
          </span>
          <span className={`callbar-status ${shimmer ? "shimmer" : ""}`} role="status">{status}</span>
        </div>
        {call.status === "error" ? (
          <button type="button" className="btn btn-small" onClick={endCall}>Dismiss</button>
        ) : (
          <div className="callbar-actions">
            {call.speaking && (
              <button type="button" className="btn btn-small" onClick={bargeIn} title="Stop the bot talking and speak now">
                Interrupt
              </button>
            )}
            <IconButton icon={call.muted ? "micOff" : "mic"} label={call.muted ? "Unmute" : "Mute"} active={call.muted} onClick={() => setMuted(!call.muted)} />
            <IconButton icon="phoneOff" label="Hang up" className="is-hangup" onClick={endCall} />
          </div>
        )}
      </div>
      {isLive &&
        (expanded ? (
          <div className="captions is-open">
            <div className="captions-log" ref={log}>
              {finals.length === 0 && <p className="caption is-placeholder">Nothing said yet.</p>}
              {finals.map((l) => (
                <p key={l.id} className={`caption ${l.final ? "" : "is-partial"}`}>
                  <b>{l.role === "user" ? "You" : bot.name}</b> {l.text}
                </p>
              ))}
            </div>
            <button type="button" className="link" onClick={() => setExpanded(false)}>Hide transcript</button>
          </div>
        ) : (
          <button type="button" className="captions" onClick={() => setExpanded(true)} title="Show the full transcript">
            {tail.length === 0 ? (
              <span className="caption is-placeholder">{call.muted ? "You're muted — unmute to talk." : `Say hi to ${bot.name}…`}</span>
            ) : (
              tail.map((l) => (
                <span key={l.id} className={`caption ${l.final ? "" : "is-partial"}`}>
                  <b>{l.role === "user" ? "You" : bot.name}</b> {l.text}
                </span>
              ))
            )}
          </button>
        ))}
    </section>
  );
}
