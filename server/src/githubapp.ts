import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { config } from "./config.js";
import type { connectors as connectorStore } from "./connectors.js";

export const GITHUB_READ_URL = "https://api.githubcopilot.com/mcp/readonly";
const prefix = "/github-app";
type Setup = { userId: string; connectorId: string; expires: number };
const pending = new Map<string, Setup>();

/** GitHub does not do dynamic OAuth registration. Its manifest flow creates a private GitHub App. */
export function beginGithubSetup(userId: string, connectorId: string): string {
  for (const [key, item] of pending) if (item.expires <= Date.now() || item.connectorId === connectorId) pending.delete(key);
  const key = randomBytes(32).toString("hex");
  pending.set(key, { userId, connectorId, expires: Date.now() + 30 * 60_000 });
  return `${config.publicUrl}/api${prefix}/register?state=${key}`;
}

const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function registerGithubApp(api: Hono<any>, connectors: typeof connectorStore, callbackUrl: string) {
  const find = (key: string, userId: string) => {
    const item = pending.get(key);
    return item && item.userId === userId && item.expires > Date.now() ? item : null;
  };
  api.get(prefix + "/register", c => {
    const key = c.req.query("state") ?? "";
    const item = find(key, c.get("user").id);
    if (!item) return c.text("Connexion expirée. Rouvre GitHub dans les applis de Sklubot.", 400);
    const manifest = {
      name: "Sklubot-" + item.connectorId.slice(-12), url: config.publicUrl, public: false,
      redirect_url: config.publicUrl + "/api" + prefix + "/created",
      callback_urls: [callbackUrl], setup_url: config.publicUrl + "/api" + prefix + "/installed/" + item.connectorId,
      hook_attributes: { active: false }, default_permissions: { contents: "read", issues: "read", pull_requests: "read" },
    };
    const nonce = randomBytes(16).toString("hex");
    c.header("cache-control", "no-store");
    c.header("referrer-policy", "no-referrer");
    c.header("content-security-policy", `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action https://github.com; script-src 'nonce-${nonce}'`);
    return c.html(`<!doctype html><meta charset="utf-8"><title>GitHub · Sklubot</title><form method="post" action="https://github.com/settings/apps/new?state=${key}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button>Continuer sur GitHub</button></form><script nonce="${nonce}">document.forms[0].submit()</script>`);
  });
  api.get(prefix + "/created", async c => {
    const key = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";
    const item = find(key, c.get("user").id);
    if (!item || !/^[a-zA-Z0-9_-]{8,256}$/.test(code)) return c.text("Connexion GitHub expirée ou annulée. Recommence depuis Sklubot.", 400);
    pending.delete(key);
    try {
      const result = await fetch("https://api.github.com/app-manifests/" + code + "/conversions", { method: "POST", redirect: "error", headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15_000) });
      if (!result.ok) return c.text("GitHub a refusé l’enregistrement. Recommence depuis Sklubot.", 400);
      const data = await result.json() as { slug?: string; client_id?: string; client_secret?: string };
      if (!data.slug || !/^[a-z0-9-]+$/.test(data.slug) || !data.client_id || !data.client_secret) return c.text("Réponse GitHub incomplète.", 502);
      connectors.configureGithub(item.userId, item.connectorId, data.client_id, data.client_secret);
      c.header("referrer-policy", "no-referrer"); c.header("cache-control", "no-store");
      return c.redirect(`https://github.com/apps/${data.slug}/installations/new`);
    } catch { return c.text("Connexion GitHub interrompue. Rouvre les applis de Sklubot.", 502); }
  });
  api.get(prefix + "/installed/:id", async c => {
    const owner = c.get("user").id;
    const id = c.req.param("id");
    if (!id || !connectors.list(owner).some(con => con.id === id && con.url === GITHUB_READ_URL)) return c.text("Connexion inconnue.", 404);
    try {
      const next = await connectors.startSignIn(owner, id);
      c.header("cache-control", "no-store"); c.header("referrer-policy", "no-referrer");
      return "authorizeUrl" in next ? c.redirect(next.authorizeUrl) : c.text("GitHub est connecté. Tu peux revenir dans Sklubot.");
    } catch { return c.text("Installation enregistrée. Dans Sklubot, ouvre Applis puis Se connecter à GitHub.", 502); }
  });
}
