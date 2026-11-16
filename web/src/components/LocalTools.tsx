import { useEffect, useId, useState, type FormEvent } from "react";
import { api, errText } from "../api";
import { tn, useT } from "../i18n";
import { useStore } from "../store";
import type { Bot, LocalToolServer, LocalToolsState } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, Empty, ErrorNote, Loading } from "./ui";

/** One argument per line in the form; a blank line is dropped. */
const argsOf = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
/** The command line as the owner reads it (arguments with spaces or quotes are quoted). */
export const commandLine = (s: Pick<LocalToolServer, "command" | "args">) => [s.command, ...s.args.map((a) => (/[\s"'\\]/.test(a) ? JSON.stringify(a) : a))].join(" ");

function AddForm({ bot, onDone, onState }: { bot: Bot; onDone: () => void; onState: (s: LocalToolsState) => void }) {
  const t = useT();
  const id = useId();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("npx");
  const [args, setArgs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !command.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onState(await api<LocalToolsState>("POST", `/bots/${bot.id}/local-tools`, { name: name.trim(), command: command.trim(), args: argsOf(args) }));
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="editor" onSubmit={submit}>
      <div className="field">
        <label className="field-label" htmlFor={`${id}n`}>{t("common.name")}</label>
        <input id={`${id}n`} className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t("localTools.namePlaceholder")} autoFocus />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}c`}>{t("localTools.command")}</label>
        <input id={`${id}c`} className="input mono" value={command} maxLength={200} onChange={(e) => setCommand(e.target.value)} placeholder="npx" spellCheck={false} autoCapitalize="off" />
        <p className="field-hint">{t("localTools.commandHint")}</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}a`}>{t("localTools.args")}</label>
        <textarea id={`${id}a`} className="input mono" rows={3} value={args} onChange={(e) => setArgs(e.target.value)} placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/root/files"} spellCheck={false} autoCapitalize="off" />
        <p className="field-hint">{t("localTools.argsHint")}</p>
      </div>
      {command.trim() && <p className="local-tools-preview"><span className="muted small">{t("localTools.willRun")}</span> <code>{commandLine({ command: command.trim(), args: argsOf(args) })}</code></p>}
      <p className="field-hint local-tools-note"><Icon name="key" size={13} /><span>{t("localTools.noSecrets")}</span></p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <div className="row-end">
        <button type="button" className="btn btn-ghost btn-small" onClick={onDone}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || !command.trim()}>{t(busy ? "common.working" : "localTools.add")}</button>
      </div>
    </form>
  );
}

function ServerRow({ s, onState, onError }: { s: LocalToolServer; onState: (st: LocalToolsState) => void; onError: (e: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const act = async (path: string, method: "POST" | "DELETE" = "POST") => {
    setBusy(true);
    try { onState(await api<LocalToolsState>(method, path)); } catch (e) { onError(errText(e)); } finally { setBusy(false); }
  };
  const state = s.status === "ready" ? "state-ready" : s.status === "error" || s.status === "unavailable" ? "state-error" : s.status === "starting" ? "state-working" : "";
  return (
    <li className="list-row is-card local-tool">
      <span className="logo-tile" aria-hidden="true"><Icon name="wrench" size={16} /></span>
      <div className="list-row-text">
        <span className="list-row-title">{s.name} <span className={`chip ${state}`}>{t(`localTools.status.${s.status}`)}</span></span>
        <code className="local-tool-line">{commandLine(s)}</code>
        {s.tools.length > 0 && <span className="list-row-sub">{tn("localTools.tools", s.tools.length)} · {s.tools.slice(0, 12).map((x) => x.name).join(", ")}{s.tools.length > 12 ? "…" : ""}</span>}
        {s.error && <span className="list-row-sub is-error">{s.error}{s.retryInSec ? ` ${t("localTools.retryIn", { n: s.retryInSec })}` : ""}</span>}
        {s.detail && <span className="list-row-sub local-tool-detail">{t("localTools.lastOutput")} <code>{s.detail}</code></span>}
      </div>
      <div className="local-tool-actions">
        {s.status !== "unavailable" && (s.status === "ready" ? (
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act(`/local-tools/${s.id}/stop`)}>{t("localTools.stop")}</button>
        ) : (
          <button type="button" className="btn btn-small" disabled={busy || s.status === "starting"} onClick={() => void act(`/local-tools/${s.id}/restart`)}>
            <Icon name="refresh" size={13} /> {t(s.status === "error" ? "localTools.retry" : "localTools.start")}
          </button>
        ))}
        <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("common.delete")} confirmLabel={t("common.confirm")} busyLabel="…" onConfirm={() => act(`/local-tools/${s.id}`, "DELETE")} />
      </div>
    </li>
  );
}

/** Bot settings → Local tools: MCP servers started by a command on this bot's own Linux computer (owner only). */
export function LocalToolsTab({ bot }: { bot: Bot }) {
  const t = useT();
  const tick = useStore((s) => s.localToolsTick[bot.id] ?? 0);
  const [state, setState] = useState<LocalToolsState | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<LocalToolsState>("GET", `/bots/${bot.id}/local-tools`).then((s) => !dead && setState(s), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [bot.id, tick]);
  if (!state) return <div className="settings-pane">{error ? <ErrorNote>{error}</ErrorNote> : <Loading />}</div>;
  return (
    <div className="settings-pane">
      <div className="pane-intro">
        <p className="muted">{t("localTools.intro", { name: bot.name })}</p>
        {state.available && !adding && (
          <div className="pane-intro-actions">
            <button type="button" className="btn btn-small" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> {t("localTools.new")}</button>
          </div>
        )}
      </div>
      {!state.available && <p className="error-note" role="alert"><Icon name="alert" size={14} /> <span>{state.reason}</span></p>}
      {adding && <AddForm bot={bot} onDone={() => setAdding(false)} onState={setState} />}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {state.servers.length === 0 && !adding && state.available && <Empty icon="wrench" title={t("localTools.emptyTitle")}>{t("localTools.emptyText", { name: bot.name })}</Empty>}
      {state.servers.length > 0 && (
        <ul className="list">
          {state.servers.map((s) => <ServerRow key={s.id} s={s} onState={setState} onError={setError} />)}
        </ul>
      )}
      <p className="field-hint">{t("localTools.safety", { name: bot.name })}</p>
    </div>
  );
}
