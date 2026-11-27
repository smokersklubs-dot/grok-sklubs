import { seal, unseal } from "../auth.js"; import type { Locale } from "../shared.js"; import { intlOf } from "../lang/index.js"; import { tr } from "../i18n.js";
import { q } from "../db.js";
import type { ToolSpec } from "../llm/types.js";
import { fetchProblem, guardedFetch } from "../net.js";
import { audit, clip, newId, now, users } from "../store.js";
import type { BuiltinTool } from "../agent/tools.js";

/**
 * L154 « rappel sortant » (backlog A-FAIRE): a bot rings the OWNER's own phone to remind them of something (a routine at
 * 9:00, a deadline), and a voice reads the reminder. Never anyone else: the bot gives no number — the only number ever
 * called is the one the owner typed in Settings → Voice, behind their session (no tool and no bot can change it). At most
 * one call every 10 minutes and 5 a day per account; refused in a turn that read outside content (a page or a mail cannot
 * make the phone ring). The calls go through the owner's own Twilio account (they pay Twilio directly).
 *
 * Twilio, as documented (read 25 Nov 2026):
 * - create a call: POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Calls.json, form fields `To` ("The phone
 *   number … to call"), `From` ("The phone number … to use as the caller id"), `Twiml` ("TwiML instructions for the call
 *   Twilio will use without fetching Twiml from url parameter", max 4000 characters); answer `sid`, `status`
 *   (https://www.twilio.com/docs/voice/api/call-resource);
 * - authentication: HTTP Basic with the Account SID (or an API key SID) and its Auth Token (or the key's secret)
 *   (https://www.twilio.com/docs/usage/requests-to-twilio);
 * - <Say language="fr-FR"> reads the text (https://www.twilio.com/docs/voice/twiml/say).
 * Needs a real Twilio account to be tried for real (tests use a fake Twilio: TWILIO_API_BASE).
 */
q.run(`CREATE TABLE IF NOT EXISTS reminder_call_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, account_sid TEXT NOT NULL, username TEXT NOT NULL, secret_enc TEXT NOT NULL,
  from_number TEXT NOT NULL, to_number TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS reminder_calls (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT, message TEXT NOT NULL,
  status TEXT NOT NULL, sid TEXT, error TEXT, created_at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS reminder_calls_user ON reminder_calls (user_id, created_at)");

export const MIN_GAP_MS = 10 * 60_000;
export const PER_DAY = 5;
export const MAX_MESSAGE = 300;
const PHONE = /^\+[1-9]\d{6,14}$/;
const ACCOUNT = /^AC[0-9a-fA-F]{32}$/;
const USERNAME = /^(AC|SK)[0-9a-fA-F]{32}$/;
const twilioBase = () => (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/+$/, "");

export class ReminderError extends Error { constructor(public status: 400 | 404 | 409 | 429 | 502, message: string) { super(message); } }
export interface ReminderSettingsView { configured: boolean; enabled: boolean; accountSid: string; username: string; from: string; to: string; hasSecret: boolean; callsToday: number; lastCallAt: number | null }

interface Row { user_id: string; account_sid: string; username: string; secret_enc: string; from_number: string; to_number: string; enabled: number }
const rowOf = (userId: string) => q.get<Row>("SELECT * FROM reminder_call_settings WHERE user_id = ?", userId);
const DAY = 86_400_000;

export function reminderView(userId: string, t = now()): ReminderSettingsView {
  const r = rowOf(userId);
  const today = q.get<{ n: number; last: number | null }>("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM reminder_calls WHERE user_id = ? AND status = 'placed' AND created_at > ?", userId, t - DAY)!;
  return { configured: !!r, enabled: !!r?.enabled, accountSid: r?.account_sid ?? "", username: r?.username ?? "", from: r?.from_number ?? "", to: r?.to_number ?? "", hasSecret: !!r?.secret_enc, callsToday: today.n, lastCallAt: today.last };
}

/** Saves the owner's settings (the secret is sealed and never sent back; omitted: the saved one is kept). */
export function saveReminderSettings(userId: string, b: Record<string, unknown>): ReminderSettingsView {
  const cur = rowOf(userId);
  const s = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, "") : "");
  const accountSid = s(b.accountSid) || cur?.account_sid || "";
  const username = s(b.username) || (b.username === undefined ? cur?.username : "") || accountSid;
  const from = s(b.from) || cur?.from_number || "", to = s(b.to) || cur?.to_number || "";
  const secret = typeof b.secret === "string" && b.secret.trim() ? b.secret.trim() : null;
  if (!ACCOUNT.test(accountSid)) throw new ReminderError(400, "The Account SID starts with AC followed by 32 letters and digits (Twilio console).");
  if (!USERNAME.test(username)) throw new ReminderError(400, "The key SID starts with AC or SK followed by 32 letters and digits.");
  if (!PHONE.test(from) || !PHONE.test(to)) throw new ReminderError(400, "Write the phone numbers in international form, for example +33612345678.");
  if (from === to) throw new ReminderError(400, "The Twilio number and your own number must be different.");
  if (!secret && !cur?.secret_enc) throw new ReminderError(400, "Paste the Auth Token (or the API key's secret).");
  if (secret && (secret.length > 200 || /\s/.test(secret))) throw new ReminderError(400, "Paste the Auth Token (or the API key's secret).");
  const enabled = b.enabled === undefined ? (cur ? cur.enabled : 1) : b.enabled === true ? 1 : 0;
  q.run(`INSERT INTO reminder_call_settings (user_id, account_sid, username, secret_enc, from_number, to_number, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET account_sid = excluded.account_sid, username = excluded.username, secret_enc = excluded.secret_enc, from_number = excluded.from_number,
    to_number = excluded.to_number, enabled = excluded.enabled, updated_at = excluded.updated_at`,
    userId, accountSid, username, secret ? seal(secret) : cur!.secret_enc, from, to, enabled, now());
  audit(userId, "apps", `Reminder calls set up (your number ending ${to.slice(-2)})`);
  return reminderView(userId);
}

export function removeReminderSettings(userId: string): boolean {
  return q.run("DELETE FROM reminder_call_settings WHERE user_id = ?", userId).changes > 0;
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[ch]!));
/** The TwiML read to the owner: the bot's name, the reminder, said twice. */
export function reminderTwiml(botName: string, message: string, locale: Locale): string {
  const lang = intlOf(locale, "en-US");
  // <Say language> takes these tags (es-ES, de-DE, it-IT, pt-BR, zh-CN…): https://www.twilio.com/docs/voice/twiml/say#attributes-language
  const intro = tr(locale, "Hello, this is {bot} from Sklubot. A reminder:", { bot: botName });
  const again = tr(locale, "Once more:");
  return `<Response><Say language="${lang}">${xml(intro)} ${xml(message)}</Say><Pause length="1"/><Say language="${lang}">${xml(again)} ${xml(message)}</Say></Response>`;
}

/**
 * Rings the owner's own number with the reminder. `botId`/`botName`: who reminds. Throws ReminderError with a message for
 * the owner or the bot (English; French in modelvoicei18n.ts).
 */
export async function placeReminderCall(userId: string, who: { botId: string | null; botName: string }, rawMessage: string, t = now()): Promise<{ sid: string; to: string }> {
  const r = rowOf(userId);
  if (!r) throw new ReminderError(404, "Reminder calls are not set up: the owner can set them up in Settings → Voice.");
  if (!r.enabled) throw new ReminderError(409, "Reminder calls are turned off in Settings → Voice.");
  const message = clip(rawMessage.replace(/\s+/g, " ").trim(), MAX_MESSAGE);
  if (!message) throw new ReminderError(400, "Write the reminder first.");
  const view = reminderView(userId, t);
  if (view.lastCallAt && t - view.lastCallAt < MIN_GAP_MS) throw new ReminderError(429, "A reminder call was placed less than 10 minutes ago: wait before calling again.");
  if (view.callsToday >= PER_DAY) throw new ReminderError(429, "5 reminder calls were already placed in the last 24 hours: no more today.");
  const secret = unseal(r.secret_enc);
  if (!secret) throw new ReminderError(409, "The saved Twilio secret can no longer be read: paste it again in Settings → Voice.");
  const id = newId("rc");
  const form = new URLSearchParams({ To: r.to_number, From: r.from_number, Twiml: reminderTwiml(who.botName, message, users.localeOf(userId)) });
  try {
    const res = await guardedFetch(`${twilioBase()}/2010-04-01/Accounts/${r.account_sid}/Calls.json`, {
      method: "POST", body: form.toString(), signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Basic ${Buffer.from(`${r.username}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    });
    const j = (await res.json().catch(() => null)) as { sid?: unknown; message?: unknown } | null;
    if (!res.ok || typeof j?.sid !== "string") {
      const why = res.status === 401 || res.status === 403 ? "Twilio refused the account or the key." : `Twilio answered ${res.status}${typeof j?.message === "string" ? `: ${clip(j.message, 160)}` : ""}.`;
      q.run("INSERT INTO reminder_calls (id, user_id, bot_id, message, status, error, created_at) VALUES (?, ?, ?, ?, 'failed', ?, ?)", id, userId, who.botId, message, why, t);
      throw new ReminderError(502, why);
    }
    q.run("INSERT INTO reminder_calls (id, user_id, bot_id, message, status, sid, created_at) VALUES (?, ?, ?, ?, 'placed', ?, ?)", id, userId, who.botId, message, j.sid, t);
    audit(userId, "channel", `${who.botName}: reminder call to your phone (${message.slice(0, 60)})`, who.botId ?? undefined);
    return { sid: j.sid, to: r.to_number };
  } catch (err) {
    if (err instanceof ReminderError) throw err;
    throw new ReminderError(502, fetchProblem(err) ?? "Twilio could not be reached. Try again in a moment.");
  }
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });

export const reminderCallTools: BuiltinTool[] = [{
  spec: {
    name: "reminder_call_owner",
    description: `Ring your owner's own phone and read them a short reminder (only them: the number is the one they set in Settings → Voice; you cannot call anyone else). For a reminder they asked for, at the time they asked (for example from a routine). At most one call every 10 minutes and 5 a day. Message: at most ${MAX_MESSAGE} characters, as spoken words.`,
    inputSchema: obj({ message: { type: "string", description: "The reminder, as it should be said" } }, ["message"]),
  },
  group: "reach", activity: "messaging", label: "Calling you with a reminder", audited: true,
  run: async (a, c) => {
    if (c.tainted) return { isError: true, content: "Refused: this turn read outside content (a page, a mail…), which cannot make your owner's phone ring. Tell them in the chat instead." };
    if (c.bot.userId !== c.user.id) return { isError: true, content: "Only the bot's owner can be called." };
    try {
      const r = await placeReminderCall(c.user.id, { botId: c.bot.id, botName: c.bot.name }, String(a.message ?? ""));
      return { content: `Your owner's phone (number ending ${r.to.slice(-2)}) is ringing with the reminder.`, summary: "reminder call placed" };
    } catch (err) {
      return { isError: true, content: (err as Error).message };
    }
  },
}];
