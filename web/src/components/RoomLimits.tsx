/**
 * L155 — in a group chat's settings: each member's time limit in this group (none by default; 1 to 240 minutes) and which
 * members are on hold (« stop @Léa » in the group; « reprends @Léa » brings them back). Server: agent/roomholds.ts,
 * GET/PUT /bots/:id/limits.
 */
import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot, RoomMemberLimits } from "../types";

const CHOICES = [0, 5, 15, 30, 60, 120];

export function RoomLimits({ room, initial }: { room: Bot; initial?: RoomMemberLimits }) {
  const t = useT();
  const all = useStore((s) => s.bots);
  const [state, setState] = useState<RoomMemberLimits | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (initial) return;
    let live = true;
    api<RoomMemberLimits>("GET", `/bots/${room.id}/limits`).then((r) => { if (live) setState(r); }).catch((e) => { if (live) setFailed(errText(e)); });
    return () => { live = false; };
  }, [room.id, initial]);
  const members = room.memberIds.map((id) => all[id]).filter((b): b is Bot => !!b && b.kind === "agent");
  if (!members.length) return null;
  const put = async (botId: string, minutes: number) => {
    setFailed(null);
    try { setState(await api<RoomMemberLimits>("PUT", `/bots/${room.id}/limits`, { botId, minutes: minutes || null })); } catch (e) { setFailed(errText(e)); }
  };
  return (
    <div className="field room-limits">
      <span className="field-label" id={`limits-${room.id}`}>{t("roomLimits.heading")}</span>
      <p className="field-hint">{t("roomLimits.text")}</p>
      <ul className="room-limits-list" aria-labelledby={`limits-${room.id}`}>
        {members.map((b) => {
          const value = state?.limits[b.id] ?? 0;
          const held = state?.held.includes(b.id);
          return (
            <li key={b.id} className="room-limits-row">
              <div className="room-limits-who">
                <span className="action-title">{b.name}</span>
                {held && <span className="muted small room-limits-held">{t("roomLimits.held", { name: b.name })}</span>}
              </div>
              <label className="sr-only" htmlFor={`limit-${room.id}-${b.id}`}>{t("roomLimits.label", { name: b.name })}</label>
              <select id={`limit-${room.id}-${b.id}`} className="input input-small room-limits-select" value={value} disabled={!state} onChange={(e) => void put(b.id, Number(e.target.value))}>
                {[...new Set([...CHOICES, value])].sort((x, y) => x - y).map((m) => <option key={m} value={m}>{m ? t("roomLimits.minutes", { n: m }) : t("roomLimits.none")}</option>)}
              </select>
            </li>
          );
        })}
      </ul>
      {failed && <p className="notice-error" role="alert">{failed}</p>}
    </div>
  );
}
