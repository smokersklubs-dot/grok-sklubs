import { useEffect, useRef, useState } from "react";
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
  const fr = useStore((s) => s.locale === "fr"),
    t = (f: string, e: string) => (fr ? f : e);
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
    read: t("Lire les messages et les réponses", "Read messages and replies"),
    write: t("Envoyer des messages", "Send messages"),
    tasks: t("Créer des tâches", "Create tasks"),
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
      setMessage(t("Copié.", "Copied."));
    } catch {
      setMessage(t("Sélectionne le texte et copie-le.", "Select and copy the text."));
    }
  }
  return (
    <section className="team-models">
      <h3 className="pane-heading">
        {t("Piloter mes bots depuis Claude Code", "Control my bots from Claude Code")}
      </h3>
      <p>
        {t(
          "Dans ton Claude Code connecté, tu peux choisir un bot de ton équipe et lui confier un travail. Chaque bot utilise son modèle et son bureau habituels dans Sklubot. Les décisions sensibles t’attendent ici.",
          "From your signed-in Claude Code, choose one of your bots and give it work. Each bot uses its configured Sklubot model and desktop. Sensitive decisions come back here for approval.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {!loaded ? (
        <button className="btn btn-small" onClick={() => setRefresh((v) => v + 1)}>
          {t("Actualiser", "Refresh")}
        </button>
      ) : !grant ? (
        <>
          <p className="muted small">
            {t(
              "L’accès inclut la liste de tes bots actuels et futurs. Choisis les actions autorisées.",
              "Access includes a list of your current and future bots. Choose the permitted actions.",
            )}
          </p>
          <fieldset>
            <legend>{t("Autorisations", "Permissions")}</legend>
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
            {t("Créer mon accès Claude Code", "Create Claude Code access")}
          </button>
          {!command && (
            <p>
              {t(
                "Ouvre Sklubot en HTTPS pour connecter ton client.",
                "Open Sklubot over HTTPS to connect your client.",
              )}
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            {t("Autorisations accordées", "Granted permissions")} ·{" "}
            {grant.scopes.map((s) => names[s]).join(" · ")}
          </p>
          <p className="muted small">
            {grant.lastUsedAt
              ? t("Dernier accès", "Last used") +
                " · " +
                new Date(grant.lastUsedAt).toLocaleString(fr ? "fr-FR" : "en")
              : t("Le client ne s’est pas encore présenté.", "The client has not connected yet.")}{" "}
            <button className="link" onClick={() => setRefresh((v) => v + 1)}>
              {t("Actualiser", "Refresh")}
            </button>
          </p>
          {secret && (
            <>
              <h4>{t("Connexion sur ton ordinateur", "Connect on your computer")}</h4>
              <p>
                {t(
                  "Copie la commande dans ton terminal, puis colle le jeton Sklubot à l’invite masquée. Claude Code garde cet accès dans ta configuration utilisateur. Le jeton est disponible ici une seule fois.",
                  "Copy the command into your terminal, then paste the Sklubot token at the hidden prompt. Claude Code saves the access in your user configuration. The token is available here once.",
                )}
              </p>
              <select
                className="input"
                aria-label={t("Terminal", "Shell")}
                value={platform}
                onChange={(e) => setPlatform(e.target.value as typeof platform)}
              >
                <option value="windows">Windows PowerShell</option>
                <option value="bash">macOS / Linux (Bash)</option>
              </select>
              <details>
                <summary>{t("Voir la commande", "View command")}</summary>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{command}</pre>
              </details>
              <div className="studio-actions">
                <button className="btn btn-small" onClick={() => void copy(command)}>
                  {t("Copier la commande", "Copy command")}
                </button>
                <button className="btn btn-small" onClick={() => void copy(secret)}>
                  {t("Copier le jeton Sklubot", "Copy Sklubot token")}
                </button>
              </div>
              <details>
                <summary>{t("Afficher le jeton", "Show token")}</summary>
                <code style={{ overflowWrap: "anywhere" }}>{secret}</code>
              </details>
              <p>
                {t(
                  "Dans une nouvelle session Claude Code, ouvre /mcp puis demande « Liste mes bots Sklubot ».",
                  "Open /mcp in a new Claude Code session, then ask “List my Sklubot bots”.",
                )}
              </p>
            </>
          )}
          <button
            className="btn btn-small"
            disabled={working}
            onClick={() => (confirm ? void change("DELETE") : setConfirm(true))}
          >
            {confirm
              ? t("Confirmer la révocation", "Confirm revocation")
              : t("Révoquer cet accès", "Revoke access")}
          </button>
          {confirm && (
            <button className="link" onClick={() => setConfirm(false)}>
              {t("Annuler", "Cancel")}
            </button>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
