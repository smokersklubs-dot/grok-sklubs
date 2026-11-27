/**
 * « Qui répond » in a group chat (server agent/roomrouting.ts): the room's settings (who answers, « Discret »,
 * « Proposer avant de commencer », and which quick model chooses in automatic mode), and the light line under a routed
 * message (« → Léa (Compta) a pris la question ») with « Plutôt demander à… ».
 */
import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Bot, RoomRouting, RoomRule, RouteNoticeAction } from "../types";
import { Icon } from "./Icon";
import { Menu, MenuItem, Toggle } from "./ui";
import "./RoomRouting.css";

/** The automatic mode first: it is the recommended one. */
export const ROOM_RULE_IDS: RoomRule[] = ["auto", "lead", "mentions", "everyone"];

/** « Qui répond » (the rule, saved with the form) and the two switches (saved at once). */
export function RoomWhoAnswers({ room, value, onChange }: { room: Bot; value: RoomRule; onChange: (v: RoomRule) => void }) {
  const t = useT();
  const [state, setState] = useState<{ routing: RoomRouting; model: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<{ routing?: RoomRouting; model?: string | null }>("GET", `/bots/${room.id}/routing`)
      .then((r) => { if (live) setState({ routing: r.routing ?? { discreet: false, askFirst: false }, model: r.model ?? null }); })
      .catch((e) => { if (live) setFailed(errText(e)); });
    return () => { live = false; };
  }, [room.id]);
  const put = async (patch: Partial<RoomRouting>) => {
    if (!state) return;
    const before = state;
    setState({ ...state, routing: { ...state.routing, ...patch } });
    setFailed(null);
    try {
      const r = await api<{ routing?: RoomRouting; model?: string | null }>("PUT", `/bots/${room.id}/routing`, patch);
      if (r.routing) setState({ routing: r.routing, model: r.model ?? null });
    } catch (e) { setState(before); setFailed(errText(e)); }
  };
  return (
    <div className="field room-who">
      <span className="field-label" id={`who-${room.id}`}>{t("roomRule.heading")}</span>
      <div className="choice-list" role="radiogroup" aria-labelledby={`who-${room.id}`}>
        {ROOM_RULE_IDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={`choice ${value === id ? "is-selected" : ""}`} onClick={() => onChange(id)}>
            <span className="choice-title">{t(`roomRule.${id}.title`)}{id === "auto" && <span className="room-who-badge">{t("roomRule.recommended")}</span>}</span>
            <span className="choice-text">{t(`roomRule.${id}.text`)}</span>
          </button>
        ))}
      </div>
      {value === "auto" && state && (
        <p className="field-hint room-who-model">
          <Icon name="bolt" size={13} /> {state.model ? t("roomRouting.model", { model: state.model }) : t("roomRouting.noModel")}
        </p>
      )}
      {state && (
        <div className="room-who-switches">
          <div className="action-row">
            <div>
              <p className="action-title">{t("roomRouting.discreet")}</p>
              <p className="muted small">{t(state.routing.discreet ? "roomRouting.discreetOn" : "roomRouting.discreetOff")}</p>
            </div>
            <Toggle checked={state.routing.discreet} label={t("roomRouting.discreet")} onChange={(v) => void put({ discreet: v })} />
          </div>
          <div className="action-row">
            <div>
              <p className="action-title">{t("roomRouting.askFirst")}</p>
              <p className="muted small">{t("roomRouting.askFirstText")}</p>
            </div>
            <Toggle checked={state.routing.askFirst} label={t("roomRouting.askFirst")} onChange={(v) => void put({ askFirst: v })} />
          </div>
        </div>
      )}
      {failed && <p className="notice-error" role="alert">{failed}</p>}
    </div>
  );
}

/**
 * Under a routed message's line (L155): the task's owner (« Responsable : Léa »), « Réassigner » to another available member
 * (as often as needed), « Archiver » to close the task, and « Restaurer » on an archived one.
 */
export function RouteNoticeActions({ action, botId, seq, readOnly }: { action: RouteNoticeAction; botId: string; seq: number; readOnly: boolean }) {
  const t = useT();
  const room = useStore((s) => s.bots[botId]);
  const all = useStore((s) => s.bots);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // A mark only (the line keeps its quiet look) when nobody took it, or in a read-only view.
  if (readOnly || !action.botId) return <i className="route-mark" hidden />;
  const others = (room?.memberIds ?? []).map((id) => all[id]).filter((b): b is Bot => !!b && b.kind === "agent" && b.id !== action.botId && !b.pause);
  const run = async (path: string, body: unknown) => {
    setOpen(false);
    setBusy(true);
    setFailed(null);
    try { await api("POST", `/bots/${botId}/rows/${seq}/${path}`, body); } catch (e) { setFailed(errText(e)); }
    setBusy(false);
  };
  const archived = action.status === "archived";
  return (
    <div className={`notice-actions route-actions ${archived ? "is-archived" : ""}`}>
      <span className="route-owner">{t(archived ? "roomTask.archivedOwner" : "roomTask.owner", { name: action.botName })}</span>
      {archived ? (
        <button type="button" className="btn btn-ghost btn-small route-ask" disabled={busy} onClick={() => void run("archive", { archived: false })}>
          <Icon name="refresh" size={12} /> {t("roomTask.restore")}
        </button>
      ) : (
        <>
          {others.length > 0 && (
            <button type="button" className="btn btn-ghost btn-small route-ask" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((v) => !v)}>
              {t("roomTask.reassign")} <Icon name="chevronDown" size={12} />
            </button>
          )}
          <Menu open={open} onClose={() => setOpen(false)} label={t("roomTask.reassign")} align="center">
            {others.map((b) => <MenuItem key={b.id} onClick={() => void run("reroute", { botId: b.id })}>{b.label ? `${b.name} (${b.label})` : b.name}</MenuItem>)}
          </Menu>
          <button type="button" className="btn btn-ghost btn-small route-ask" disabled={busy} onClick={() => void run("archive", { archived: true })}>
            <Icon name="folder" size={12} /> {t("roomTask.archive")}
          </button>
        </>
      )}
      {failed && <span className="notice-error" role="alert">{failed}</span>}
    </div>
  );
}
