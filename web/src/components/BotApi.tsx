import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { relTime, shortDate } from "../lib/format";
import { BOT_API_SCOPES, type Bot, type BotApiKeysView, type BotApiKeyView, type BotApiScope } from "../types";
import { Icon } from "./Icon";
import { ConfirmButton, CopyButton, Empty, ErrorNote, Loading } from "./ui";
import { BotWebhooksBlock } from "./OpenAccess";
import "./BotApi.css";

/**
 * Bot settings → "Accès API" (server/src/botapi.ts, docs/API-BOT.md): the owner's API keys of this bot — create one with
 * a name and permissions (the key is shown once), see when each was last used, revoke it — and how to plug the MCP
 * control server into Claude Code, Claude Desktop or Cursor.
 */

type Client = "code" | "desktop" | "cursor" | "curl";
const CLIENTS: Client[] = ["code", "desktop", "cursor", "curl"];
const PLACEHOLDER = "sk_bot_…";

/** Copyable setup for each client. `key`: the key just created, else a placeholder the user replaces. */
export function clientSnippet(client: Client, o: { mcpUrl: string; baseUrl: string; key: string; name: string }): string {
  const server = o.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sklubot";
  switch (client) {
    // https://code.claude.com/docs/en/mcp — "claude mcp add --transport http <name> <url> --header "Authorization: Bearer …"".
    case "code": return `claude mcp add --transport http sklubot-${server} ${o.mcpUrl} \\\n  --header "Authorization: Bearer ${o.key}"`;
    // Claude Desktop has no JSON entry for a remote server with a key: Customize → Connectors → Add custom connector
    // (https://claude.com/docs/connectors/custom/remote-mcp). What to enter there:
    case "desktop": return `URL : ${o.mcpUrl}\nAuthentification : No sign-in\nRequest headers : authorization = Bearer ${o.key}`;
    // https://cursor.com/docs/context/mcp — ~/.cursor/mcp.json, a "url" with "headers".
    case "cursor": return JSON.stringify({ mcpServers: { [`sklubot-${server}`]: { url: o.mcpUrl, headers: { Authorization: `Bearer ${o.key}` } } } }, null, 2);
    case "curl": return `curl -X POST ${o.baseUrl}/bot/messages \\\n  -H "Authorization: Bearer ${o.key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"text": "Bonjour !"}'`;
  }
}

export function BotApiTab({ bot }: { bot: Bot }) {
  const t = useT();
  const uid = useId();
  const [view, setView] = useState<BotApiKeysView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<BotApiScope[]>(["read", "write"]);
  const [busy, setBusy] = useState(false);
  /** The key just created: shown once, here, until the user closes it. */
  const [fresh, setFresh] = useState<{ secret: string; key: BotApiKeyView } | null>(null);
  const [client, setClient] = useState<Client>("code");
  const alive = useRef(true);
  const freshBox = useRef<HTMLDivElement>(null);
  // The new key appears above the form: brought into view, so it is not missed.
  useEffect(() => {
    if (fresh) freshBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [fresh]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    api<BotApiKeysView>("GET", `/bots/${enc(bot.id)}/api-keys`).then(
      (v) => alive.current && (setView(v), setLoadError(null)),
      (e: unknown) => alive.current && setLoadError(errText(e)),
    );
  }, [bot.id]);

  const toggle = (s: BotApiScope) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : BOT_API_SCOPES.filter((x) => x === s || cur.includes(x))));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim() || !scopes.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<BotApiKeysView & { secret: string; key: BotApiKeyView }>("POST", `/bots/${enc(bot.id)}/api-keys`, { name: name.trim(), scopes });
      if (!alive.current) return;
      setView({ keys: r.keys, max: r.max, baseUrl: r.baseUrl, mcpUrl: r.mcpUrl });
      setFresh({ secret: r.secret, key: r.key });
      setName("");
    } catch (err) {
      if (alive.current) setError(errText(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const revoke = async (k: BotApiKeyView) => {
    setError(null);
    try {
      const v = await api<BotApiKeysView>("DELETE", `/bots/${enc(bot.id)}/api-keys/${enc(k.id)}`);
      if (!alive.current) return;
      setView(v);
      if (fresh?.key.id === k.id) setFresh(null);
    } catch (err) {
      if (alive.current) setError(errText(err));
    }
  };

  const live = view?.keys.filter((k) => !k.revokedAt) ?? [];
  const revoked = view?.keys.filter((k) => k.revokedAt) ?? [];
  const full = !!view && live.length >= view.max;
  const snippet = view ? clientSnippet(client, { mcpUrl: view.mcpUrl, baseUrl: view.baseUrl, key: fresh?.secret ?? PLACEHOLDER, name: bot.name }) : "";

  return (
    <div className="settings-pane bot-api">
      <p className="muted">{t("botApi.intro", { name: bot.name })}</p>
      <div className="callout bot-api-safety">
        <Icon name="shield" size={16} />
        <span>{t("botApi.safety")}</span>
      </div>
      {loadError && !view && <ErrorNote>{loadError}</ErrorNote>}
      {!view && !loadError && <Loading />}

      {fresh && (
        <div className="bot-api-fresh" role="status" ref={freshBox}>
          <p className="bot-api-fresh-title">
            <Icon name="key" size={16} /> {t("botApi.freshTitle", { name: fresh.key.name })}
          </p>
          <p className="small">{t("botApi.freshHint")}</p>
          <code className="bot-api-secret">{fresh.secret}</code>
          <div className="row-start">
            <CopyButton text={fresh.secret} label={t("botApi.copyKey")} className="btn btn-small btn-primary" onFail={() => setError(t("routine.copyFailed"))} />
            <button type="button" className="btn btn-small" onClick={() => setFresh(null)}>{t("botApi.freshDone")}</button>
          </div>
        </div>
      )}

      {view && (
        <>
          <h3 className="pane-heading">{t("botApi.keysHeading")}</h3>
          {view.keys.length === 0 ? (
            <Empty icon="key" title={t("botApi.emptyTitle")}>{t("botApi.emptyText")}</Empty>
          ) : (
            <ul className="bot-api-keys">
              {[...live, ...revoked].map((k) => (
                <li key={k.id} className={`bot-api-key ${k.revokedAt ? "is-revoked" : ""}`}>
                  <div className="bot-api-key-main">
                    <span className="bot-api-key-name truncate">{k.name}</span>
                    <code className="bot-api-key-prefix">{k.prefix}…</code>
                    <span className="bot-api-scopes">
                      {k.scopes.map((s) => (
                        <span key={s} className="chip">{t(`botApi.scope.${s}` as Key)}</span>
                      ))}
                    </span>
                    <span className="muted small">
                      {k.revokedAt
                        ? t("botApi.revokedOn", { date: shortDate(k.revokedAt) })
                        : `${t("botApi.createdOn", { date: shortDate(k.createdAt) })} · ${k.lastUsedAt ? t("botApi.usedAgo", { when: relTime(k.lastUsedAt) }) : t("botApi.neverUsed")}`}
                    </span>
                  </div>
                  {!k.revokedAt && (
                    <ConfirmButton className="btn btn-small btn-ghost-danger" label={t("botApi.revoke")} confirmLabel={t("botApi.revokeConfirm")} busyLabel={t("botApi.revoking")} onConfirm={() => revoke(k)} ariaLabel={t("botApi.revokeAria", { name: k.name })} />
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 className="pane-heading">{t("botApi.newHeading")}</h3>
          <form className="editor bot-api-new" onSubmit={create} autoComplete="off">
            <div className="field">
              <label className="field-label" htmlFor={`${uid}n`}>{t("botApi.name")}</label>
              <input id={`${uid}n`} className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("botApi.namePlaceholder")} disabled={full} />
            </div>
            <fieldset className="field bot-api-scope-set" disabled={full}>
              <legend className="field-label">{t("botApi.scopes")}</legend>
              {BOT_API_SCOPES.map((s) => (
                <label key={s} className="check-row bot-api-scope">
                  <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} />
                  <span>
                    <span className="bot-api-scope-title">{t(`botApi.scope.${s}` as Key)}</span>
                    <span className="muted small">{t(`botApi.scopeHint.${s}` as Key)}</span>
                  </span>
                </label>
              ))}
              <p className="field-hint">{t("botApi.never")}</p>
            </fieldset>
            <ErrorNote>{error}</ErrorNote>
            <div className="row-end">
              {full && <span className="muted small">{t("botApi.full", { max: view.max })}</span>}
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || full || !name.trim() || !scopes.length}>{t(busy ? "botApi.creating" : "botApi.create")}</button>
            </div>
          </form>

          <h3 className="pane-heading">{t("botApi.connectHeading")}</h3>
          <p className="muted small">{t("botApi.connectIntro")}</p>
          <div className="filter-chips" role="tablist" aria-label={t("botApi.connectHeading")}>
            {CLIENTS.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={client === c} className={`filter-chip ${client === c ? "is-selected" : ""}`} onClick={() => setClient(c)}>
                {t(`botApi.client.${c}` as Key)}
              </button>
            ))}
          </div>
          <p className="small bot-api-client-hint">{t(`botApi.clientHint.${client}` as Key)}</p>
          <pre className="bot-api-snippet"><code>{snippet}</code></pre>
          <div className="row-start">
            <CopyButton text={snippet} label={t("botApi.copySnippet")} onFail={() => setError(t("routine.copyFailed"))} />
            {!fresh && <span className="muted small">{t("botApi.placeholderNote")}</span>}
          </div>
          <p className="muted small">{t("botApi.docs")}</p>
          <BotWebhooksBlock bot={bot} />{/* L170 (OpenAccess.tsx) */}
        </>
      )}
    </div>
  );
}
