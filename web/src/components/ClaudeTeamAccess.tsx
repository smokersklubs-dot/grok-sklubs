import { useEffect, useRef, useState } from "react";
import { intlLocale, t as tr } from "../i18n";
import { api, errText } from "../api";
import { useStore } from "../store";
import { teamClaudeSetup } from "../lib/teamClaudeSetup";

type Scope = "read" | "write" | "tasks";
interface Grant {
  id: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
}
export function ClaudeTeamAccess() {
  const [grant, setGrant] = useState<Grant | null>(null),
    [loaded, setLoaded] = useState(false);
  const [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [working, setWorking] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [platform, setPlatform] = useState<"windows" | "bash">(
    /Windows/i.test(navigator.userAgent) ? "windows" : "bash",
  );
  const [scopes, setScopes] = useState<Scope[]>(["read"]),
    [refresh, setRefresh] = useState(0);
  const pending = useRef(false),
    alive = useRef(true);
  const names: Record<Scope, string> = {
    read: tr("claudeAccess.readMessagesReplies"),
    write: tr("claudeAccess.sendMessages"),
    tasks: tr("claudeAccess.createTasks"),
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    api<{ grant: Grant | null }>("GET", "/team-mcp", undefined, ctrl.signal).then(
      (r) => {
        if (!ctrl.signal.aborted) {
          setGrant(r.grant);
          setLoaded(true);
          setError("");
        }
      },
      (e) => {
        if (!ctrl.signal.aborted) setError(errText(e));
      },
    );
    return () => ctrl.abort();
  }, [refresh]);
  let command = "";
  try {
    command = teamClaudeSetup(location.origin, platform);
  } catch {
    /* shown when creating from an insecure origin */
  }
  async function change(method: "POST" | "DELETE") {
    if (pending.current) return;
    pending.current = true;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ grant: Grant | null; secret?: string }>(
        method,
        "/team-mcp",
        method === "POST" ? { scopes } : { id: grant?.id },
      );
      if (alive.current) {
        setGrant(result.grant);
        setSecret(result.secret ?? "");
        setConfirm(false);
      }
    } catch (e) {
      if (alive.current) {
        setError(errText(e));
        setRefresh((v) => v + 1);
      }
    } finally {
      pending.current = false;
      if (alive.current) setWorking(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(tr("claudeAccess.copied"));
    } catch {
      setMessage(tr("claudeAccess.selectCopyText"));
    }
  }
  return (
    <section className="team-models">
      <h3 className="pane-heading">
        {tr("claudeAccess.controlMyBotsFrom")}
      </h3>
      <p>
        {tr("claudeAccess.fromSignedClaudeCode")}
      </p>
      {error && <p role="alert">{error}</p>}
      {!loaded ? (
        <button className="btn btn-small" onClick={() => setRefresh((v) => v + 1)}>
          {tr("library.refresh")}
        </button>
      ) : !grant ? (
        <>
          <p className="muted small">
            {tr("claudeAccess.accessIncludesListCurrent")}
          </p>
          <fieldset>
            <legend>{tr("settings.section.permissions")}</legend>
            {(["read", "write", "tasks"] as Scope[]).map((s) => (
              <label key={s} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) =>
                    setScopes((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))
                  }
                />{" "}
                {names[s]}
              </label>
            ))}
          </fieldset>
          <button
            className="btn"
            disabled={working || !scopes.length || !command}
            onClick={() => void change("POST")}
          >
            {tr("claudeAccess.createClaudeCodeAccess")}
          </button>
          {!command && (
            <p>
              {tr("claudeAccess.openSklubotOverHttps")}
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            {tr("claudeAccess.grantedPermissions")} ·{" "}
            {grant.scopes.map((s) => names[s]).join(" · ")}
          </p>
          <p className="muted small">
            {grant.lastUsedAt
              ? tr("claudeAccess.lastUsed") +
                " · " +
                new Date(grant.lastUsedAt).toLocaleString(intlLocale())
              : tr("claudeAccess.clientHasNotConnected")}{" "}
            <button className="link" onClick={() => setRefresh((v) => v + 1)}>
              {tr("library.refresh")}
            </button>
          </p>
          {secret && (
            <>
              <h4>{tr("claudeAccess.connectComputer")}</h4>
              <p>
                {tr("claudeAccess.copyCommandIntoTerminal")}
              </p>
              <select
                className="input"
                aria-label={tr("claudeAccess.shell")}
                value={platform}
                onChange={(e) => setPlatform(e.target.value as typeof platform)}
              >
                <option value="windows">Windows PowerShell</option>
                <option value="bash">macOS / Linux (Bash)</option>
              </select>
              <details>
                <summary>{tr("claudeAccess.viewCommand")}</summary>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{command}</pre>
              </details>
              <div className="studio-actions">
                <button className="btn btn-small" onClick={() => void copy(command)}>
                  {tr("claudeAccess.copyCommand")}
                </button>
                <button className="btn btn-small" onClick={() => void copy(secret)}>
                  {tr("claudeAccess.copySklubotToken")}
                </button>
              </div>
              <details>
                <summary>{tr("telegram.showToken")}</summary>
                <code style={{ overflowWrap: "anywhere" }}>{secret}</code>
              </details>
              <p>
                {tr("claudeAccess.openMcpNewClaude")}
              </p>
            </>
          )}
          <button
            className="btn btn-small"
            disabled={working}
            onClick={() => (confirm ? void change("DELETE") : setConfirm(true))}
          >
            {confirm
              ? tr("claudeAccess.confirmRevocation")
              : tr("claudeAccess.revokeAccess")}
          </button>
          {confirm && (
            <button className="link" onClick={() => setConfirm(false)}>
              {tr("common.cancel")}
            </button>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
