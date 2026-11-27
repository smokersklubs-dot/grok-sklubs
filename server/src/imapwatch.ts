/**
 * L162 + OpenClaw E11 — "relève IMAP": a bot reads the new messages of an existing mailbox of its owner's (any provider
 * with IMAP over TLS, usually with an app password), every few minutes. Idea and rules from OpenClaw's
 * extensions/imap (MIT; its code is built on imapflow/mailparser, so the watcher here is Sklubot's own): start from
 * the newest message (never the whole history), keep a cursor (UIDVALIDITY + last UID), skip messages over 1 MB, and
 * read only for senders the owner allowed.
 *
 * Each new message goes through the same path as a mail received at the bot's own address (botmail.ts
 * receiveMailForBot): SPF/DKIM/DMARC checked as far as possible, spam score, access codes masked, a mail card in the
 * chat. A sender not on the mailbox's allow-list is HELD (nothing reaches the bot): the owner sees it and approves the
 * sender (added to the list, their held mails released) or ignores it — no automatic reply is ever sent to a stranger.
 * What the bot reads of a mail is outside content: a careful turn that can never act with the owner's rights, even when
 * the mail claims to be from the owner. The mailbox is opened read-only (EXAMINE, BODY.PEEK[]): nothing in it changes.
 *
 * The password is sealed (channelstore.ts) and never logged. TLS from the first byte only (port 993); the server name
 * must resolve to a public address (as every outgoing connection, net.ts), except for local tests.
 */
import dns from "node:dns";
import net from "node:net";
import { channelStore } from "./channelstore.js";
import type { ImapChannelStatus } from "./channeltypes.js";
import { ImapClient, ImapError } from "./imapclient.js";
import { isPrivateAddress } from "./net.js";
import { mailFor, receiveMailForBot, releaseMail, setImapAutoReply } from "./botmail.js";
import { q } from "./db.js";
import { audit, bots, type BotRecord } from "./store.js";

interface Secret { password: string }
interface Info { host: string; port: number; username: string; mailbox: string; allowed: string[]; autoReply: boolean; everyMinutes: number; uidValidity: number; lastUid: number; lastCheckAt: number | null; error: string | null }

const MAX_MESSAGE = 1024 * 1024;
const PER_CHECK = 20;
export class ImapSetupError extends Error {}

const allowPrivate = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";
/** Plain IMAP without TLS: only for local tests (both switches on, a loopback address). */
const plainForTests = (address: string) => process.env.IMAP_PLAINTEXT_FOR_TESTS === "1" && allowPrivate() && (address === "127.0.0.1" || address === "::1");

async function addressOf(host: string): Promise<string> {
  const list = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true }).catch(() => []);
  if (!list.length) throw new ImapSetupError(`The server ${host} cannot be found.`);
  if (!allowPrivate() && list.some((a) => isPrivateAddress(a.address))) throw new ImapSetupError(`The server ${host} points to a private address: refused.`);
  return list[0].address;
}

/** Addresses (bob@x.fr) and whole domains (@x.fr), lower case, at most 100 — as the bot's own address (botmail.ts). */
export function cleanSenders(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/) : [];
  return [...new Set(list.map((s) => String(s).trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) || /^@[^@\s]+\.[^@\s]+$/.test(s)))].slice(0, 100);
}

async function session<T>(i: Pick<Info, "host" | "port" | "username" | "mailbox">, password: string, fn: (c: ImapClient, box: { uidValidity: number; uidNext: number }) => Promise<T>): Promise<T> {
  const address = await addressOf(i.host);
  const c = new ImapClient();
  try {
    await c.open({ host: i.host, port: i.port, address, tls: !plainForTests(address), timeoutMs: Number(process.env.IMAP_TIMEOUT_MS ?? 30_000) });
    await c.login(i.username, password);
    const box = await c.examine(i.mailbox);
    return await fn(c, box);
  } finally { await c.close(); }
}

const load = (botId: string) => channelStore.get<Secret, Info>(botId, "imap");
const patch = (botId: string, change: (i: Info) => Info) => channelStore.patch<Info>(botId, "imap", change);
const running = new Set<string>();

/** One check: new messages since the cursor go to the bot (or are held). Returns how many were taken in. */
export async function checkMailbox(botId: string): Promise<number> {
  if (running.has(botId)) return 0;
  running.add(botId);
  try {
    const s = load(botId);
    const bot = bots.byId(botId);
    if (!s || !bot) return 0;
    let taken = 0;
    await session(s.info, s.secret.password, async (c, box) => {
      // A new UIDVALIDITY means the old numbers mean nothing (RFC 3501 2.3.1.1): start again from the newest message.
      if (box.uidValidity !== s.info.uidValidity) { patch(botId, (i) => ({ ...i, uidValidity: box.uidValidity, lastUid: Math.max(0, box.uidNext - 1) })); return; }
      const uids = (await c.uidsAfter(s.info.lastUid)).slice(0, PER_CHECK);
      const sizes = await c.sizes(uids);
      for (const uid of uids) {
        if ((sizes.get(uid) ?? 0) <= MAX_MESSAGE) {
          const raw = await c.message(uid);
          if (raw && raw.length <= MAX_MESSAGE) { await receiveMailForBot(bot, raw, s.info.username.includes("@") ? s.info.username : `${s.info.username}@${s.info.host}`, s.info.allowed); taken++; }
        }
        patch(botId, (i) => ({ ...i, lastUid: Math.max(i.lastUid, uid) }));
      }
    });
    patch(botId, (i) => ({ ...i, lastCheckAt: Date.now(), error: null }));
    return taken;
  } catch (err) {
    patch(botId, (i) => ({ ...i, lastCheckAt: Date.now(), error: (err as Error).message.slice(0, 200) }));
    return 0;
  } finally { running.delete(botId); }
}

// A held mail released later follows this mailbox's auto-reply setting (botmail.ts startOnMail).
setImapAutoReply((botId) => !!channelStore.info<Info>(botId, "imap")?.autoReply);

const timers = new Map<string, NodeJS.Timeout>();
function schedule(botId: string) {
  clearInterval(timers.get(botId));
  const i = channelStore.info<Info>(botId, "imap");
  if (!i) return;
  const every = Number(process.env.IMAP_POLL_MS) || Math.max(1, i.everyMinutes) * 60_000;
  const t = setInterval(() => { if (!bots.byId(botId)) { clearInterval(t); timers.delete(botId); return; } void checkMailbox(botId); }, every);
  t.unref?.();
  timers.set(botId, t);
}

export const imap = {
  status(bot: BotRecord): ImapChannelStatus {
    const i = channelStore.info<Info>(bot.id, "imap");
    return { connected: !!i, host: i?.host ?? null, port: i?.port ?? null, username: i?.username ?? null, mailbox: i?.mailbox ?? null, allowedSenders: i?.allowed ?? [], autoReply: !!i?.autoReply, everyMinutes: i?.everyMinutes ?? 5, lastCheckAt: i?.lastCheckAt ?? null, error: i?.error ?? null,
      // Mails of this mailbox held because their sender is not approved yet: the owner's access requests for email.
      held: i ? q.all<{ from_addr: string; subject: string; received_at: number }>("SELECT from_addr, subject, received_at FROM inbound_mail WHERE bot_id = ? AND ip = 'imap' AND status = 'held' AND reason = 'sender not on the allowed list' ORDER BY received_at DESC LIMIT 20", bot.id).map((r) => ({ from: r.from_addr, subject: r.subject, at: r.received_at })) : [] };
  },
  /**
   * Saves the mailbox after a real sign-in (LOGIN + EXAMINE): the cursor starts at the newest message. An empty password
   * keeps the saved one (changing only the allow-list or the rhythm).
   */
  async connect(bot: BotRecord, raw: Record<string, unknown>): Promise<ImapChannelStatus> {
    const cur = load(bot.id);
    const host = String(raw.host ?? cur?.info.host ?? "").trim().toLowerCase();
    if (!/^[a-z0-9.-]{3,200}$/.test(host) && !net.isIP(host)) throw new ImapSetupError("Enter the IMAP server name (e.g. imap.example.com).");
    const port = Math.floor(Number(raw.port ?? cur?.info.port ?? 993));
    if (!(port > 0 && port < 65536)) throw new ImapSetupError("Enter a valid port (usually 993).");
    const username = String(raw.username ?? cur?.info.username ?? "").trim();
    if (!username || username.length > 200) throw new ImapSetupError("Enter the mailbox user name (often the email address).");
    const mailbox = String(raw.mailbox ?? cur?.info.mailbox ?? "INBOX").trim() || "INBOX";
    if (mailbox.length > 200) throw new ImapSetupError("That folder name is too long.");
    const password = typeof raw.password === "string" && raw.password ? raw.password : cur?.secret.password ?? "";
    if (!password) throw new ImapSetupError("Enter the password (an app password if the provider asks for one).");
    const allowed = raw.allowedSenders === undefined ? cur?.info.allowed ?? [] : cleanSenders(raw.allowedSenders);
    const everyMinutes = Math.min(60, Math.max(1, Math.floor(Number(raw.everyMinutes ?? cur?.info.everyMinutes ?? 5)) || 5));
    const autoReply = raw.autoReply === undefined ? !!cur?.info.autoReply : raw.autoReply === true;
    const same = cur && cur.info.host === host && cur.info.port === port && cur.info.username === username && cur.info.mailbox === mailbox && cur.secret.password === password;
    let uidValidity = cur?.info.uidValidity ?? 0, lastUid = cur?.info.lastUid ?? 0;
    if (!same) {
      const box = await session({ host, port, username, mailbox }, password, async (_c, b) => b).catch((err) => {
        if (err instanceof ImapError && err.auth) throw new ImapSetupError("The server refused this user name or password.");
        throw new ImapSetupError(`Could not open the mailbox: ${(err as Error).message}`);
      });
      uidValidity = box.uidValidity;
      lastUid = Math.max(0, box.uidNext - 1);
    }
    channelStore.set(bot.id, "imap", { password } satisfies Secret, { host, port, username, mailbox, allowed, autoReply, everyMinutes, uidValidity, lastUid, lastCheckAt: cur?.info.lastCheckAt ?? null, error: null } satisfies Info);
    audit(bot.userId, "channel", `${bot.name}: IMAP mailbox ${username} on ${host} ${cur ? "updated" : "connected"} (${allowed.length} allowed sender(s))`, bot.id);
    schedule(bot.id);
    return imap.status(bot);
  },
  /** The owner approves a sender of a held mail: added to the allow-list, their held mails from this mailbox released. */
  approveSender(bot: BotRecord, address: string): ImapChannelStatus {
    const clean = cleanSenders([address])[0];
    if (!clean) throw new ImapSetupError("That is not an email address.");
    patch(bot.id, (i) => ({ ...i, allowed: [...new Set([...i.allowed, clean])].slice(0, 100) }));
    for (const m of mailFor(bot.id, 200)) if (m.status === "held" && /sender not on the allowed list/.test(m.reason) && (m.from.toLowerCase().includes(`<${clean}>`) || m.from.toLowerCase() === clean)) releaseMail(bot, m.id);
    audit(bot.userId, "channel", `${bot.name}: IMAP sender ${clean} approved`, bot.id);
    return imap.status(bot);
  },
  disconnect(bot: BotRecord) {
    clearInterval(timers.get(bot.id));
    timers.delete(bot.id);
    channelStore.remove(bot.id, "imap");
    audit(bot.userId, "channel", `${bot.name}: IMAP mailbox disconnected`, bot.id);
  },
  start() {
    for (const id of channelStore.botsWith("imap")) if (bots.byId(id)) schedule(id);
  },
  stopAll() { for (const t of timers.values()) clearInterval(t); timers.clear(); },
};
