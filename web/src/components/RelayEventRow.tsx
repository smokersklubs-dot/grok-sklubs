import { useT } from "../i18n";
import { Icon } from "./Icon";
import "./RelayEventRow.css";

/**
 * A line about the user's own computer (Sklubot Relais) in a bot's chat. A command's line ("$ command — folder ·
 * computer · status") carries its output below the first line (server agent/mycomputer.ts chatOutput, secrets masked,
 * last 8 KiB): shown folded, opened on demand.
 */
export function RelayEventRow({ text, warn, seq }: { text: string; warn: boolean; seq: number }) {
  const t = useT();
  const cut = text.indexOf("\n");
  const head = cut < 0 ? text : text.slice(0, cut);
  const output = cut < 0 ? "" : text.slice(cut + 1);
  const command = head.startsWith("$ ");
  return (
    <div className={`event is-relay ${warn ? "is-warn" : ""}`} data-seq={seq}>
      <span className="event-line"><Icon name={warn ? "alert" : command ? "terminal" : "monitor"} size={13} /> <span className={command ? "relay-cmd" : undefined}>{head}</span></span>
      {output && (
        <details className="relay-output">
          <summary>{t("relay.output")}</summary>
          <pre>{output}</pre>
        </details>
      )}
    </div>
  );
}
