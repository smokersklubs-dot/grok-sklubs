import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { unseal } from "./auth.js";
import { computerKind, workspaceOf } from "./computer.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { tr } from "./i18n.js";
import { addJournal } from "./journal.js";
import { botBaseUrl, writeComputerFile } from "./linux.js";
import { fetchProblem, guardedFetch } from "./net.js";
import { scrubSecret } from "./apiconnectors.js";
import { audit, bots, clip, now, policies, users, vault, type BotRecord } from "./store.js";

/**
 * Wave 7 (spec 08 A1) — credential relay for the bots' own computers.
 *
 * A script or a program on a bot's Linux computer can call an API with one of the user's vault secrets without the key
 * ever entering that computer: it sends its request to Sklubot's relay instead of the real host, naming the secret and
 * the host; Sklubot adds the secret's header outside the container and forwards the request.
 *
 *   ${SKLUBOT_RELAY_URL}/<secret name>/<host>/<path>?<query>   with the header  X-Sklubot-Relay-Token: ${SKLUBOT_RELAY_TOKEN}
 *
 * (the helper `sklubot-api <secret> <METHOD> <https-url> [curl options…]` in the desktop image does exactly that.)
 *
 * Rules, as in secret_use: only hosts bound to the secret (or their subdomains), https only (http only with
 * ALLOW_PRIVATE_FETCH, for local tests), through guardedFetch (never a private or local address), redirects never
 * followed, method, path, repeated query parameters, headers and body passed on as they are (only our own control header,
 * transport headers and the secret's own header are removed), the secret removed from what comes back under every form
 * (raw, URL-encoded, JSON-escaped, base64). The relay token is per computer, stored hashed, revocable, and never
 * forwarded. A card asks before the first use of each secret ("Always" remembered); after the bot has read outside
 * content, every request that changes something (anything but GET, HEAD, OPTIONS) asks again, and "Always" is not
 * offered. A request that arrives while no command of the bot is running counts as after outside content. Rate limit:
 * 60 requests a minute per bot and secret. Every request is in the journal (bot, method, host, path, status, the
 * secret's name — never its value).
 *
 * Different on purpose: a request for a secret that no longer exists is not sent at all (410) rather than sent without
 * a key, so the relay is never an open proxy; bodies are read whole (20 MB at most) rather than streamed.
 */

export const RELAY_HEADER = "x-sklubot-relay-token";
const MAX_BODY = 20_000_000;
const MAX_RESPONSE = 50_000_000;
const RATE = 60;
const allowHttp = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** The relay's address as the bots' computers reach this server (the same internal route as the tool endpoint). */
export const relayBase = (botId: string) => `${botBaseUrl()}/egress/${encodeURIComponent(botId)}`;

export const egressTokens = {
  /** A new token for this bot's computer (the old one stops working). Only its hash is kept. */
  issue(botId: string): string {
    const token = randomBytes(32).toString("base64url");
    q.run("INSERT INTO egress_tokens (bot_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at", botId, hashToken(token), now());
    return token;
  },
  check(botId: string, token: string): boolean {
    const r = q.get<{ token_hash: string }>("SELECT token_hash FROM egress_tokens WHERE bot_id = ?", botId);
    if (!r || !token) return false;
    const a = Buffer.from(r.token_hash, "hex"), b = Buffer.from(hashToken(token), "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  },
  revoke: (botId: string) => { q.run("DELETE FROM egress_tokens WHERE bot_id = ?", botId); provisioned.delete(botId); },
};

/** What puts the relay's address and token on the bot's computer (replaceable in tests). Never the secrets themselves. */
export type RelayWriter = (bot: BotRecord, files: Record<string, string>) => Promise<void>;
let writer: RelayWriter = async (bot, files) => { for (const [file, content] of Object.entries(files)) await writeComputerFile(bot.id, bot.userId, workspaceOf(bot.id), file, content); };
let writerOverridden = false;
export const setRelayWriter = (fn: RelayWriter | null) => { writerOverridden = !!fn; writer = fn ?? (async (bot, files) => { for (const [file, content] of Object.entries(files)) await writeComputerFile(bot.id, bot.userId, workspaceOf(bot.id), file, content); }); };
const provisioned = new Set<string>();

/** The files the computer gets: the relay's address and this computer's token (and nothing else). */
export function relayFiles(botId: string, token: string): Record<string, string> {
  const base = relayBase(botId);
  return {
    "/root/.sklubot/relay.env": `# Sklubot credential relay: call APIs with the user's saved secrets. The keys never come here.\n# Usage: sklubot-api "<secret name>" GET https://api.example.com/v1/things\nSKLUBOT_RELAY_URL=${base}\nSKLUBOT_RELAY_TOKEN=${token}\n`,
  };
}

/** Makes sure the bot's computer has the relay's address and a valid token (once per server run, or after a revoke). */
export async function provisionRelay(bot: BotRecord): Promise<boolean> {
  if (!bot.relayEnabled || (computerKind() !== "linux" && !writerOverridden)) return false;
  if (provisioned.has(bot.id)) return true;
  const token = egressTokens.issue(bot.id);
  await writer(bot, relayFiles(bot.id, token));
  provisioned.add(bot.id);
  return true;
}
export async function disableRelay(bot: BotRecord) {
  egressTokens.revoke(bot.id);
  await writer(bot, { "/root/.sklubot/relay.env": "# The credential relay is switched off for this bot.\n" }).catch(() => {});
}

/** Whether a command of the bot is running right now, and whether its turn had read outside content. */
const running = new Map<string, { tainted: boolean; n: number }>();
export function commandStarted(botId: string, tainted: boolean) {
  const cur = running.get(botId);
  running.set(botId, { tainted: (cur?.tainted ?? false) || tainted, n: (cur?.n ?? 0) + 1 });
}
export function commandEnded(botId: string) {
  const cur = running.get(botId);
  if (!cur || cur.n <= 1) running.delete(botId); else running.set(botId, { ...cur, n: cur.n - 1 });
}
const taintedNow = (botId: string) => running.get(botId)?.tainted ?? true;
const inBackground = (botId: string) => !running.has(botId);

const hits = new Map<string, number[]>();
function overRate(key: string): boolean {
  const t = Date.now();
  const list = (hits.get(key) ?? []).filter((x) => x > t - 60_000);
  list.push(t);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => x > t - 60_000)) hits.delete(k);
  return list.length > RATE;
}

const sameSite = (here: string, wanted: string) => here === wanted || here.endsWith("." + wanted);
const HOP = new Set(["connection", "keep-alive", "proxy-authorization", "proxy-authenticate", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "forwarded", "accept-encoding"]);
const READS = new Set(["GET", "HEAD", "OPTIONS"]);
const json = (status: number, error: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ error, relay: "sklubot", ...extra }), { status, headers: { "content-type": "application/json", "x-sklubot-relay": "1" } });

/** Approval and journal hooks (loop.ts registers them: egress.ts cannot import loop.ts, which imports the tools). */
export type Asker = (bot: BotRecord, f: { title: string; detail: string; policyKey: string; source: string; once?: boolean }) => Promise<"allowed" | "always" | "denied" | "expired">;
let asker: Asker = async () => "denied";
export const setRelayAsker = (fn: Asker) => { asker = fn; };

/** One request from a program on a bot's computer: `/egress/:botId/:secret/:host/<path>`. */
export async function handleEgress(c: Context): Promise<Response> {
  // Only the bots' computers call this, on the internal network. Anything that went through a reverse proxy came from
  // the internet and is refused (Caddy also answers 404 for /egress/).
  if (c.req.header("x-forwarded-for") || c.req.header("forwarded")) return json(404, "not found");
  const parts = new URL(c.req.url).pathname.split("/");
  // ["", "egress", botId, secret, host, ...path]
  const [botId, secretRaw, hostRaw] = [parts[2], parts[3], parts[4]].map((p) => { try { return decodeURIComponent(p ?? ""); } catch { return ""; } });
  const rest = "/" + parts.slice(5).join("/");
  const bot = botId ? bots.byId(botId) : null;
  if (!bot || !egressTokens.check(bot.id, c.req.header(RELAY_HEADER) ?? "")) return json(401, "This computer is not allowed to use the credential relay (missing or old token).");
  const loc = users.localeOf(bot.userId);
  const method = c.req.method.toUpperCase();
  const label = `${method} ${hostRaw}${clip(rest, 80)} — ${secretRaw}`;
  const journal = (status: "done" | "failed" | "denied", decision: "free" | "policy" | "approval" | "denied", reason = "") =>
    addJournal({ userId: bot.userId, botId: bot.id, tool: "api_relay", label, decision, reason, status, origin: "computer" });
  if (!bot.relayEnabled) { journal("denied", "denied", "relay off"); return json(403, "The credential relay is switched off for this bot (its settings → Programs and my keys)."); }
  const item = vault.byName(bot.userId, secretRaw);
  const value = item?.kind === "secret" && item.passwordEnc ? unseal(item.passwordEnc) : null;
  if (!item || item.kind !== "secret" || !value) { journal("failed", "denied", "secret missing"); return json(410, `No saved secret is called "${secretRaw}" any more. The request was not sent.`); }
  const [hostname, port] = hostRaw.toLowerCase().split(":");
  if (!hostname || !/^[a-z0-9.-]+$/.test(hostname) || (port !== undefined && !/^\d{1,5}$/.test(port))) return json(400, "Give the API's host name after the secret's name.");
  const host = hostname.replace(/^www\./, "");
  if (!item.hosts.some((h) => sameSite(host, h))) { journal("denied", "denied", "host not bound"); return json(403, `The secret "${item.name}" may only be sent to ${item.hosts.join(", ") || "(no host)"}, not ${host}. Nothing was sent.`); }
  if (overRate(`${bot.id}|${item.id}`)) { journal("denied", "denied", "rate limit"); return json(429, `More than ${RATE} requests a minute with this secret: slow down.`); }

  // Permission: before the first use of each secret; after outside content, every change asks (never "Always").
  const key = `relay: ${item.name}`;
  const policy = policies.get(bot.userId, key);
  if (policy === "blocked") { journal("denied", "denied", "blocked"); return json(403, "The user blocked this secret for programs."); }
  const write = !READS.has(method);
  const strict = write && taintedNow(bot.id);
  let decision: "policy" | "approval" = "policy";
  const proto = allowHttp() && c.req.header(`x-sklubot-relay-scheme`) === "http" ? "http" : "https";
  if (policy !== "always_allow" || strict) {
    const title = !strict ? "Allow {bot}'s program to call {host} with the secret {item}?"
      : inBackground(bot.id) ? "A program {bot} left running in the background wants to send {method} to {host} with the secret {item}. Allow it?"
      : "{bot} has read outside content. Allow its program to send {method} to {host} with the secret {item}?";
    const answer = await asker(bot, {
      title: tr(loc, title, { bot: bot.name, method, host, item: item.name }),
      detail: `${method} ${proto}://${hostRaw}${clip(rest, 300)}\n\n${tr(loc, "The program never sees the secret: Sklubot adds it outside the computer, only for the hosts it is saved for.")}`,
      policyKey: key, source: tr(loc, "Programs on its computer"), once: strict,
    });
    if (answer !== "allowed" && answer !== "always") { journal("denied", "denied", answer); return json(403, answer === "expired" ? "The user did not answer in time. Nothing was sent." : "The user did not allow this request. Nothing was sent; do not try another way."); }
    decision = "approval";
  }

  const search = new URL(c.req.url).search;
  const url = `${proto}://${hostname}${port ? `:${port}` : ""}${rest}${search}`;
  const headers = new Headers();
  c.req.raw.headers.forEach((v, k) => {
    const l = k.toLowerCase();
    if (HOP.has(l) || l.startsWith("x-sklubot-") || l.startsWith("x-forwarded-") || l === (item.header || "authorization").toLowerCase()) return;
    headers.append(k, v);
  });
  headers.set(item.header || "Authorization", `${item.prefix}${value}`);
  let body: Buffer | undefined;
  if (!["GET", "HEAD"].includes(method)) {
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_BODY) { journal("failed", "denied", "body too large"); return json(413, "That body is too large (20 MB at most)."); }
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.length > MAX_BODY) { journal("failed", "denied", "body too large"); return json(413, "That body is too large (20 MB at most)."); }
    body = buf.length ? buf : undefined;
  }
  let res: Response;
  try { res = await guardedFetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, redirect: "manual", signal: AbortSignal.timeout(120_000) }); }
  catch (err) { const why = fetchProblem(err) ?? "the request failed"; journal("failed", decision, why); return json(502, `Could not reach ${host}: ${why}`); }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_RESPONSE) { journal("failed", decision, "response too large"); return json(502, "The response is too large to pass on (50 MB at most)."); }
  const type = res.headers.get("content-type") ?? "";
  const textual = !type || /text|json|xml|javascript|html|form-urlencoded/.test(type);
  // A binary response cannot be rewritten safely; one that carries the key in any of its forms is refused whole.
  if (!textual && binaryHoldsSecret(buf, value)) { journal("failed", decision, "secret in response"); return json(502, "The API sent the secret back inside a binary response, so it was not passed on."); }
  const out = textual ? Buffer.from(scrubSecret(buf.toString("utf8"), value), "utf8") : buf;
  const back = new Headers();
  res.headers.forEach((v, k) => { if (!HOP.has(k.toLowerCase()) && k.toLowerCase() !== "content-encoding") back.append(k, scrubSecret(v, value)); });
  back.set("x-sklubot-relay", "1");
  journal(res.status >= 400 ? "failed" : "done", decision, `${res.status}`);
  audit(bot.userId, "computer", `${bot.name}: relay ${method} ${host}${clip(rest, 60)} with ${item.name} → ${res.status}`, bot.id);
  return new Response(method === "HEAD" ? null : new Uint8Array(out), { status: res.status, headers: back });
}

/** Whether a binary body contains the secret, raw or in one of the forms scrubSecret hides (searched byte for byte). */
export function binaryHoldsSecret(buf: Buffer, secret: string): boolean {
  if (!secret || secret.length < 4) return false;
  const forms = new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1), Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("base64url")]);
  return [...forms].some((f) => f.length >= 4 && buf.includes(Buffer.from(f, "utf8")));
}

/**
 * The bot's command failed with "401 / unauthorized" while it named a host bound to one of the user's secrets without
 * going through the relay: it is told why, instead of a silent failure.
 */
export function relayHint(bot: BotRecord, command: string, output: string): string {
  if (!/\b401\b|unauthori[sz]ed|invalid api key|missing api key/i.test(output) || /sklubot-api|SKLUBOT_RELAY/.test(command)) return "";
  const hosts = vault.list(bot.userId).filter((i) => i.kind === "secret").flatMap((i) => i.hosts.map((h) => ({ h, name: i.name })));
  const hit = hosts.find(({ h }) => command.includes(h));
  if (!hit) return "";
  return bot.relayEnabled
    ? `\n[This program did not use Sklubot's credential relay, so it went out without the key for ${hit.h}. Call it through the relay instead: sklubot-api "${hit.name}" GET https://${hit.h}/… (or the base URL $SKLUBOT_RELAY_URL/${encodeURIComponent(hit.name)}/${hit.h}/… with the header X-Sklubot-Relay-Token: $SKLUBOT_RELAY_TOKEN; source ~/.sklubot/relay.env first).]`
    : `\n[The user saved a secret for ${hit.h} ("${hit.name}"), but programs on your computer cannot use it: the credential relay is off for you. Use secret_use instead, or ask the user to switch on "Programs can use my keys" in your settings.]`;
}
