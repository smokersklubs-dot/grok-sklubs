import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { seal, unseal } from "./auth.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { emit } from "./bus.js";
import { audit, clip, now, vault, type VaultRecord } from "./store.js";

/**
 * L179 — the owner's 1Password or Bitwarden vault, live, through each vendor's OFFICIAL command-line tool, READ ONLY.
 *
 *  - 1Password CLI `op` with a service account token (env OP_SERVICE_ACCOUNT_TOKEN,
 *    https://www.1password.dev/service-accounts/use-with-1password-cli/): `op item list --vault <v> --format json`,
 *    `op item get <id> --vault <v> --reveal --format json` (flags: https://www.1password.dev/cli/reference/management-commands/item/;
 *    `--format` is a global flag). A service account only sees the vaults it was given: give it read access only.
 *  - Bitwarden CLI `bw` with a personal API key and the master password (https://bitwarden.com/help/cli/):
 *    `bw config server <url>`, `bw login --apikey` (BW_CLIENTID / BW_CLIENTSECRET), `bw unlock --passwordenv BW_PASSWORD
 *    --raw`, `bw sync`, `bw list items --search`, `bw get item <id>`, all with `--nointeraction`; the session key in
 *    BW_SESSION; its data folder per account (BITWARDENCLI_APPDATA_DIR) so two Sklubot accounts never share it.
 *
 * Only reading commands are ever run (list, get, sync, status, login, unlock): Sklubot never creates, changes or
 * deletes anything in those vaults. The programs run on the Sklubot server, without a shell, with only their own
 * variables (never the server's environment), and never in a bot's computer.
 *
 * Each item the owner links becomes a vault item of Sklubot marked « en direct » (vault_live_links): the existing vault
 * rules apply as for any item (allowed bots, « demander à chaque fois », cards, host check before filling, usage
 * history — vaultaccess.ts / relayguard.ts), and right before each use its value is read again from 1Password /
 * Bitwarden (refreshLinked, called by guardVault). The latest value is kept sealed, as every vault value, so that
 * Sklubot can hide it from anything a model sees. If the vault cannot be reached, the use is refused (never a stale value).
 * Credentials (token, API key, master password) are sealed in vault_live; never returned to the browser.
 */
q.run(`CREATE TABLE IF NOT EXISTS vault_live (user_id TEXT NOT NULL, provider TEXT NOT NULL, cfg_enc TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, provider))`);
q.run(`CREATE TABLE IF NOT EXISTS vault_live_links (item_id TEXT PRIMARY KEY REFERENCES vault(id) ON DELETE CASCADE, user_id TEXT NOT NULL, provider TEXT NOT NULL, ref TEXT NOT NULL, vault_ref TEXT NOT NULL DEFAULT '', synced_at INTEGER NOT NULL)`);

export type LiveProvider = "1password" | "bitwarden";
export const LIVE_PROVIDERS: LiveProvider[] = ["1password", "bitwarden"];
export interface LiveItem { ref: string; name: string; site: string; username: string; vault: string; vaultRef: string }
interface Secret extends LiveItem { password: string; totp: string }
interface OpCfg { token: string; vault?: string }
interface BwCfg { server?: string; clientId: string; clientSecret: string; password: string }

/** How a CLI is run (replaceable in tests). Resolves with stdout; rejects with an Error whose message is stderr. */
export type CliRunner = (file: string, args: string[], env: Record<string, string>) => Promise<string>;
const realRunner: CliRunner = (file, args, env) => new Promise((resolve, reject) => {
  execFile(file, args, { env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: env.HOME ?? "", ...env }, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    if (err) reject(new Error(clip(String(stderr || err.message), 300))); else resolve(String(stdout));
  });
});
let runner: CliRunner = realRunner;
export const setVaultCli = (fn: CliRunner | null) => { runner = fn ?? realRunner; sessions.clear(); };

const homeOf = (userId: string, provider: LiveProvider) => {
  const dir = path.join(config.dataDir, "vault-cli", provider, userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* the CLI says so */ }
  return dir;
};

// ── Owner's settings ────────────────────────────────────────────────────────────
function cfgOf<T>(userId: string, provider: LiveProvider): T | null {
  const r = q.get<{ cfg_enc: string }>("SELECT cfg_enc FROM vault_live WHERE user_id = ? AND provider = ?", userId, provider);
  const plain = r ? unseal(r.cfg_enc) : null;
  try { return plain ? (JSON.parse(plain) as T) : null; } catch { return null; }
}
/** Checks and seals the owner's settings. Returns the problem (an English template) or null. */
export function saveLiveConfig(userId: string, provider: LiveProvider, raw: Record<string, unknown>): string | null {
  const s = (k: string, n = 500) => (typeof raw[k] === "string" ? String(raw[k]).trim().slice(0, n) : "");
  let cfg: OpCfg | BwCfg;
  if (provider === "1password") {
    if (!/^ops_[A-Za-z0-9_\-.=]{20,}$/.test(s("token", 4000))) return "Paste the service account token (it starts with ops_).";
    cfg = { token: s("token", 4000), vault: s("vault", 200) || undefined };
  } else {
    const server = s("server", 300);
    if (server && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(server)) return "The server address must start with https://.";
    if (!/^user\.[0-9a-f-]{36}$/i.test(s("clientId"))) return "The client_id of a Bitwarden personal API key looks like user.xxxxxxxx-….";
    if (s("clientSecret").length < 10 || !s("password", 1000)) return "Give the client_secret and the master password.";
    cfg = { server: server || undefined, clientId: s("clientId"), clientSecret: s("clientSecret"), password: String(raw.password).slice(0, 1000) };
  }
  q.run("INSERT INTO vault_live (user_id, provider, cfg_enc, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET cfg_enc = excluded.cfg_enc", userId, provider, seal(JSON.stringify(cfg)), now());
  sessions.delete(`${userId}:${provider}`);
  audit(userId, "vault", `Live vault connected: ${provider === "1password" ? "1Password" : "Bitwarden"} (read only)`);
  return null;
}
export function removeLiveConfig(userId: string, provider: LiveProvider) {
  q.run("DELETE FROM vault_live WHERE user_id = ? AND provider = ?", userId, provider);
  sessions.delete(`${userId}:${provider}`);
  audit(userId, "vault", `Live vault disconnected: ${provider}`);
}
export const liveStatus = (userId: string) => LIVE_PROVIDERS.map((p) => ({
  provider: p, connected: !!cfgOf(userId, p),
  links: q.get<{ n: number }>("SELECT COUNT(*) AS n FROM vault_live_links WHERE user_id = ? AND provider = ?", userId, p)!.n,
}));

// ── Reading through the CLIs ───────────────────────────────────────────────────
const hostOf = (u: unknown) => { try { return new URL(/^[a-z]+:\/\//i.test(String(u)) ? String(u) : `https://${u}`).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** `op item list` / `op item get` JSON → items (no value). Exported for tests. */
export function parseOpItem(x: any): Secret | null {
  if (!x || typeof x.id !== "string") return null;
  const fields: any[] = Array.isArray(x.fields) ? x.fields : [];
  const purpose = (p: string) => fields.find((f) => f?.purpose === p)?.value;
  const totp = fields.find((f) => String(f?.type ?? "").toUpperCase() === "OTP");
  const url = (Array.isArray(x.urls) ? x.urls.find((u: any) => u?.primary) ?? x.urls[0] : null)?.href ?? "";
  return { ref: x.id, name: clip(String(x.title ?? ""), 120), site: clip(hostOf(url) || "", 200), username: clip(String(purpose("USERNAME") ?? ""), 200), vault: clip(String(x.vault?.name ?? ""), 80), vaultRef: String(x.vault?.id ?? ""), password: String(purpose("PASSWORD") ?? ""), totp: String(totp?.value ?? "") };
}
/** `bw list items` / `bw get item` JSON → items. Exported for tests. Only logins (type 1). */
export function parseBwItem(x: any): Secret | null {
  if (!x || typeof x.id !== "string" || x.type !== 1 || !x.login) return null;
  const uri = Array.isArray(x.login.uris) ? x.login.uris[0]?.uri : "";
  return { ref: x.id, name: clip(String(x.name ?? ""), 120), site: clip(hostOf(uri) || "", 200), username: clip(String(x.login.username ?? ""), 200), vault: "", vaultRef: String(x.organizationId ?? ""), password: String(x.login.password ?? ""), totp: String(x.login.totp ?? "") };
}
const strip = (s: Secret): LiveItem => ({ ref: s.ref, name: s.name, site: s.site, username: s.username, vault: s.vault, vaultRef: s.vaultRef });
const parseJson = (out: string) => { try { return JSON.parse(out); } catch { throw new Error("unreadable answer from the vault program"); } };

const sessions = new Map<string, { key: string; until: number }>();
async function bwEnv(userId: string, cfg: BwCfg): Promise<Record<string, string>> {
  const dir = homeOf(userId, "bitwarden");
  const base = { HOME: dir, BITWARDENCLI_APPDATA_DIR: dir };
  const cached = sessions.get(`${userId}:bitwarden`);
  if (cached && cached.until > Date.now()) return { ...base, BW_SESSION: cached.key };
  const status = parseJson(await runner("bw", ["status", "--nointeraction"], base).catch(() => "{}"));
  if (status?.status === "unauthenticated" || !status?.status) {
    if (cfg.server) await runner("bw", ["config", "server", cfg.server, "--nointeraction"], base);
    await runner("bw", ["login", "--apikey", "--nointeraction"], { ...base, BW_CLIENTID: cfg.clientId, BW_CLIENTSECRET: cfg.clientSecret });
  }
  const key = (await runner("bw", ["unlock", "--passwordenv", "BW_PASSWORD", "--raw", "--nointeraction"], { ...base, BW_PASSWORD: cfg.password })).trim();
  if (!key) throw new Error("Bitwarden did not unlock");
  await runner("bw", ["sync", "--nointeraction"], { ...base, BW_SESSION: key }).catch(() => "");
  sessions.set(`${userId}:bitwarden`, { key, until: Date.now() + 10 * 60_000 });
  return { ...base, BW_SESSION: key };
}
const opEnv = (userId: string, cfg: OpCfg) => { const dir = homeOf(userId, "1password"); return { HOME: dir, OP_CONFIG_DIR: dir, OP_SERVICE_ACCOUNT_TOKEN: cfg.token }; };

/** The items of a connected vault matching `search` (names, sites and usernames only: never a value). */
export async function listLive(userId: string, provider: LiveProvider, search = ""): Promise<LiveItem[]> {
  const term = clip(search.trim(), 100).toLowerCase();
  if (provider === "1password") {
    const cfg = cfgOf<OpCfg>(userId, provider);
    if (!cfg) throw new Error("not connected");
    const args = ["item", "list", "--categories", "Login", "--format", "json", ...(cfg.vault ? ["--vault", cfg.vault] : [])];
    const list = parseJson(await runner("op", args, opEnv(userId, cfg)));
    return (Array.isArray(list) ? list : []).map(parseOpItem).filter((x): x is Secret => !!x).map(strip).filter((x) => !term || `${x.name} ${x.site}`.toLowerCase().includes(term)).slice(0, 200);
  }
  const cfg = cfgOf<BwCfg>(userId, provider);
  if (!cfg) throw new Error("not connected");
  const env = await bwEnv(userId, cfg);
  const list = parseJson(await runner("bw", ["list", "items", ...(term ? ["--search", term] : []), "--nointeraction"], env));
  // `bw list items` carries the passwords: they are dropped right here.
  return (Array.isArray(list) ? list : []).map(parseBwItem).filter((x): x is Secret => !!x).map(strip).slice(0, 200);
}

async function fetchSecret(userId: string, provider: LiveProvider, ref: string, vaultRef: string): Promise<Secret> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(ref)) throw new Error("bad item reference");
  if (provider === "1password") {
    const cfg = cfgOf<OpCfg>(userId, provider);
    if (!cfg) throw new Error("not connected");
    const args = ["item", "get", ref, "--reveal", "--format", "json", ...(vaultRef && /^[A-Za-z0-9-]{1,64}$/.test(vaultRef) ? ["--vault", vaultRef] : cfg.vault ? ["--vault", cfg.vault] : [])];
    const s = parseOpItem(parseJson(await runner("op", args, opEnv(userId, cfg))));
    if (!s) throw new Error("item not found");
    return s;
  }
  const cfg = cfgOf<BwCfg>(userId, provider);
  if (!cfg) throw new Error("not connected");
  const s = parseBwItem(parseJson(await runner("bw", ["get", "item", ref, "--nointeraction"], await bwEnv(userId, cfg))));
  if (!s) throw new Error("item not found");
  return s;
}

/** Links an item of the connected vault: a Sklubot vault item « en direct », value read now and before each use. */
export async function linkLive(userId: string, provider: LiveProvider, ref: string, name?: string): Promise<VaultRecord> {
  const s = await fetchSecret(userId, provider, ref, "");
  const wanted = clip(String(name ?? "").trim(), 80) || s.name || "Identifiant";
  let finalName = wanted;
  for (let i = 2; vault.byName(userId, finalName); i++) finalName = `${wanted} (${i})`;
  const label = provider === "1password" ? "1Password" : "Bitwarden";
  const item = vault.create(userId, { kind: "login", name: finalName, site: s.site, username: s.username, passwordEnc: s.password ? seal(s.password) : null, note: `En direct depuis ${label} (lecture seule).` });
  q.run("INSERT INTO vault_live_links (item_id, user_id, provider, ref, vault_ref, synced_at) VALUES (?, ?, ?, ?, ?, ?)", item.id, userId, provider, s.ref, s.vaultRef, now());
  audit(userId, "vault", `Vault item linked live from ${label}: ${finalName}`);
  emit(userId, { type: "vault" });
  return item;
}

export const liveLinkOf = (itemId: string) => q.get<{ provider: LiveProvider; ref: string; vault_ref: string; synced_at: number; user_id: string }>("SELECT provider, ref, vault_ref, synced_at, user_id FROM vault_live_links WHERE item_id = ?", itemId) ?? null;
export const liveLinks = (userId: string) => q.all<{ item_id: string; provider: LiveProvider; synced_at: number }>("SELECT item_id, provider, synced_at FROM vault_live_links WHERE user_id = ?", userId).map((r) => ({ itemId: r.item_id, provider: r.provider, syncedAt: r.synced_at }));

/**
 * Right before a vault tool uses a linked item: its username and password read again from 1Password / Bitwarden.
 * Returns null when it is not linked or was refreshed; else why it cannot be used now (an English sentence for the bot).
 */
export async function refreshLinked(item: Pick<VaultRecord, "id" | "userId" | "name">): Promise<string | null> {
  const link = liveLinkOf(item.id);
  if (!link) return null;
  try {
    const s = await fetchSecret(item.userId, link.provider, link.ref, link.vault_ref);
    const cur = vault.owned(item.userId, item.id);
    if (!cur) return null;
    vault.update(item.id, { kind: "login", name: cur.name, site: cur.site || s.site, username: s.username, passwordEnc: s.password ? seal(s.password) : null, note: cur.note });
    q.run("UPDATE vault_live_links SET synced_at = ? WHERE item_id = ?", now(), item.id);
    return null;
  } catch (e) {
    return `The vault item "${item.name}" is linked live to ${link.provider === "1password" ? "1Password" : "Bitwarden"}, which could not be read right now (${clip((e as Error).message, 120)}). Nothing was used. Tell the owner; do not retry in a loop.`;
  }
}
