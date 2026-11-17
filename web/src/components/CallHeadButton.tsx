import { useEffect, useState } from "react";
import { api } from "../api";
import { callPossible, endCall, startCall } from "../lib/call";
import { useStore } from "../store";
import type { Bot, VoiceStatus } from "../types";
import { IconButton } from "./ui";
import { useVT } from "./VoicePicker";

/**
 * The call button of the chat header (also on phones, where the details panel is hidden): starts a voice call with the
 * bot, or hangs up. Its tooltip names the voice the bot answers with (its own, or the free one it was given).
 */
export function CallHeadButton({ bot }: { bot: Bot }) {
  const vt = useVT();
  const inCall = useStore((s) => s.call?.botId === bot.id);
  const [voice, setVoice] = useState("");
  useEffect(() => {
    if (bot.kind !== "agent") return;
    let live = true;
    setVoice("");
    void api<{ status: VoiceStatus }>("GET", `/bots/${bot.id}/voice`).then((r) => { if (live) setVoice(r.status.mode === "server" ? r.status.voice ?? "" : ""); }, () => undefined);
    return () => { live = false; };
  }, [bot.id, bot.kind]);
  if (bot.kind !== "agent" || !callPossible()) return null;
  const label = inCall ? vt("hangUp") : voice ? vt("callVoice", { name: bot.name, voice }) : vt("callWith", { name: bot.name });
  return <IconButton icon={inCall ? "phoneOff" : "phone"} label={label} title={label} active={inCall} className={inCall ? "is-hangup" : undefined} onClick={() => (inCall ? endCall() : startCall(bot.id))} />;
}
