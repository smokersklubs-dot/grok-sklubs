import { useState } from "react";
import { api, enc } from "../api";
import { useT } from "../i18n";
import { Icon } from "./Icon";
import "./RelayEventRow.css";

/**
 * A line about the user's own computer (Sklubot Relais) in a bot's chat. A command's line ("$ command — folder ·
 * computer · status") carries its output below the first line (server agent/mycomputer.ts chatOutput, secrets masked,
 * last 8 KiB): shown folded, opened on demand. While a command runs, its own « Arrêter » button stops that command only
 * (server commandstop.ts): the control session and the bot's turn go on.
 */
export function RelayEventRow({ text, warn, seq, botId, cmd }: { text: string; warn: boolean; seq: number; botId?: string; cmd?: { ref: string; running: boolean } }) {
  const t = useT();
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    if (!botId || !cmd) return;
    setStopping(true);
    try { await api("POST", `/bots/${enc(botId)}/commands/${enc(cmd.ref)}/stop`); } catch { setStopping(false); }
  };
  const cut = text.indexOf("\n");
  const head = cut < 0 ? text : text.slice(0, cut);
  const output = cut < 0 ? "" : text.slice(cut + 1);
  const command = head.startsWith("$ ");
  return (
    <div className={`event is-relay ${warn ? "is-warn" : ""}`} data-seq={seq}>
      <span className="event-line"><Icon name={warn ? "alert" : command ? "terminal" : "monitor"} size={13} /> <span className={command ? "relay-cmd" : undefined}>{head}</span></span>
      {cmd?.running && botId && (
        <button type="button" className="btn btn-small btn-ghost-danger relay-cmd-stop" disabled={stopping} onClick={() => void stop()} aria-label={t("relay.cmdStopLabel")}>
          <Icon name="stop" size={13} /> {t(stopping ? "relay.cmdStopping" : "relay.cmdStop")}
        </button>
      )}
      {output && (
        <details className="relay-output">
          <summary>{t("relay.output")}</summary>
          <pre>{output}</pre>
        </details>
      )}
    </div>
  );
}
