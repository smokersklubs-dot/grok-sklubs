import { tr } from "./i18n.js";
import { announce, devices, labelOf, liveDevice, relayRequest, whenRelayEvent, type RelayResult } from "./relay.js";
import { audit, bots, clip, rows, users } from "./store.js";

/**
 * L177 « Android par USB » — the server's side of Sklubot Relais protocol 1.9 (docs/RELAIS-PROTOCOLE.md §20). An
 * Android phone plugged by USB into one of the owner's computers is driven by the Relais with Google's own `adb`
 * (companion/src/main/capabilities/adb.js, rules in companion/src/main/phone-usb.js). Here:
 *  - which phones each computer sees (`android.devices`, asked by Sklubot itself: bot "sklubot", never a bot's id);
 *  - who uses which phone, from the Relais' own events (`phone.started` / `phone.ended`), for « utilisé par … »;
 *  - « Arrêter » in Settings → Computers: `android.release` by Sklubot (the Relais forgets every yes for that phone)
 *    and the bot is held back 10 minutes (it may not take the phone again on its own).
 * Only devices of the caller's own account: every entry point checks `devices.owned` / `liveDevice(userId, …)`.
 */

export const ANDROID_CAP = "android.devices";
const SKLUBOT = { id: "sklubot", name: "Sklubot" };
const HOLD_MS = 10 * 60_000;
const LIST_TTL_MS = 15_000;

export interface AndroidPhone { serial: string; state: string; usb?: boolean; model?: string; android?: string; sdk?: number | null; inUse?: string | null }
export interface PhoneListing { adb: { found: boolean; version?: string }; devices: AndroidPhone[]; at: number }
export interface PhoneUse { botId: string; botName: string; model: string; since: number }

const listings = new Map<string, PhoneListing>();
const uses = new Map<string, Map<string, PhoneUse>>();
const holds = new Map<string, number>();

/** Whether this computer's Relais offers Android by USB (1.9). */
export const offersAndroid = (userId: string, deviceId: string) => !!liveDevice(userId, deviceId)?.capabilities.includes(ANDROID_CAP);
export const lastListing = (deviceId: string) => listings.get(deviceId) ?? null;
export const usesOn = (deviceId: string) => [...(uses.get(deviceId) ?? new Map()).entries()].map(([serial, u]) => ({ serial, ...u }));
export const phoneUse = (deviceId: string, serial: string) => uses.get(deviceId)?.get(serial) ?? null;
const holdKey = (botId: string, deviceId: string, serial: string) => `${botId}\u0000${deviceId}\u0000${serial}`;
export const phoneHeld = (botId: string, deviceId: string, serial: string) => (holds.get(holdKey(botId, deviceId, serial)) ?? 0) > Date.now();
/** The owner wrote to the bot: it may ask for the phone again. */
export function phoneUserSpoke(botId: string) { for (const k of holds.keys()) if (k.startsWith(`${botId}\u0000`)) holds.delete(k); }

const cleanPhone = (v: unknown): AndroidPhone | null => {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  if (typeof d.serial !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(d.serial)) return null;
  const state = typeof d.state === "string" ? clip(d.state, 20) : "unknown";
  return {
    serial: d.serial, state, usb: d.usb === true,
    ...(state === "device" && typeof d.model === "string" ? { model: clip(d.model, 60) } : {}),
    ...(state === "device" && typeof d.android === "string" ? { android: clip(d.android, 12) } : {}),
    ...(typeof d.sdk === "number" ? { sdk: d.sdk } : {}),
  };
};

/** Asks the computer which phones it sees (cached 15 s unless `fresh`). Null when the device is not the caller's or is offline. */
export async function listPhones(userId: string, deviceId: string, opts: { fresh?: boolean; signal?: AbortSignal } = {}): Promise<PhoneListing | RelayResult | null> {
  if (!devices.owned(userId, deviceId) || !liveDevice(userId, deviceId)) return null;
  const cached = listings.get(deviceId);
  if (cached && !opts.fresh && Date.now() - cached.at < LIST_TTL_MS) return cached;
  const r = await relayRequest(deviceId, SKLUBOT, "android.devices", {}, { timeoutMs: 30_000, signal: opts.signal });
  if (!r.ok) return r;
  const res = r.result as { adb?: { found?: unknown; version?: unknown }; devices?: unknown[] };
  const listing: PhoneListing = {
    adb: { found: res.adb?.found === true, ...(typeof res.adb?.version === "string" ? { version: clip(res.adb.version, 20) } : {}) },
    devices: (Array.isArray(res.devices) ? res.devices : []).map(cleanPhone).filter((d): d is AndroidPhone => !!d).slice(0, 16),
    at: Date.now(),
  };
  listings.set(deviceId, listing);
  return listing;
}

/** The view for Settings → Computers (also the phones in use, by whom). */
export function phonesView(deviceId: string, listing: PhoneListing) {
  const using = uses.get(deviceId) ?? new Map<string, PhoneUse>();
  return { adb: listing.adb, devices: listing.devices.map((d) => ({ ...d, inUse: using.get(d.serial) ? { botId: using.get(d.serial)!.botId, botName: using.get(d.serial)!.botName, since: using.get(d.serial)!.since } : null })), checkedAt: listing.at };
}

/** « Arrêter » from Sklubot: the Relais releases the phone and forgets its yes; the bot is held back for 10 minutes. */
export async function stopPhone(userId: string, deviceId: string, serial: string | null): Promise<boolean> {
  if (!devices.owned(userId, deviceId) || !liveDevice(userId, deviceId)) return false;
  for (const [s, u] of uses.get(deviceId) ?? []) if (!serial || s === serial) holds.set(holdKey(u.botId, deviceId, s), Date.now() + HOLD_MS);
  const r = await relayRequest(deviceId, SKLUBOT, "android.release", serial ? { serial } : {}, { timeoutMs: 10_000 });
  return r.ok;
}

/** Remembers a use the server saw succeed (in case the Relais' event comes later). */
export function noteUse(deviceId: string, serial: string, bot: { id: string; name: string }, model: string) {
  const m = uses.get(deviceId) ?? new Map<string, PhoneUse>();
  if (m.get(serial)?.botId === bot.id) return;
  m.set(serial, { botId: bot.id, botName: bot.name, model, since: Date.now() });
  uses.set(deviceId, m);
}

/** For tests. */
export function forgetAndroid() { listings.clear(); uses.clear(); holds.clear(); }

const botOf = (v: unknown): { id: string; name: string } | null => {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  return typeof b.id === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(b.id) ? { id: b.id, name: clip(typeof b.name === "string" ? b.name : b.id, 60) } : null;
};

const REASONS: Record<string, string> = {
  bot: "the bot released it", user_stop: "you pressed Stop on the computer", hotkey: "you pressed the Stop shortcut on the computer",
  idle: "nothing happened for 2 minutes", stopped: "you stopped it from Sklubot", unplugged: "the phone was unplugged", handover: "another bot took over",
  disconnected: "the connection was lost", paused: "the relay was paused on the computer",
};

/** The Relais' own events: « {phone} utilisé par {bot} » in Settings, a line in the bot's chat, the journal. */
whenRelayEvent((userId, deviceId, name, msg) => {
  if (name !== "phone.started" && name !== "phone.ended") return;
  const serial = typeof msg.serial === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(msg.serial) ? msg.serial : null;
  const bot = botOf(msg.bot);
  if (!serial || !bot) return;
  const row = devices.owned(userId, deviceId);
  if (!row) return;
  const model = clip(typeof msg.model === "string" ? msg.model : serial, 60);
  const m = uses.get(deviceId) ?? new Map<string, PhoneUse>();
  const own = bots.owned(userId, bot.id);
  const userLoc = users.localeOf(userId);
  const device = labelOf(row);
  if (name === "phone.started") {
    m.set(serial, { botId: bot.id, botName: bot.name, model, since: Date.now() });
    uses.set(deviceId, m);
    const text = tr(userLoc, "{bot} is using your phone {phone} (plugged into {device}).", { bot: bot.name, phone: model, device });
    audit(userId, "computer", text, own ? bot.id : null);
    if (own && own.kind === "agent") rows.append(own, { kind: "event", event: "relay", text, tone: "info" }, 0);
  } else {
    m.delete(serial);
    const reason = typeof msg.reason === "string" ? msg.reason : "";
    const text = tr(userLoc, "{bot} no longer uses your phone {phone}: {reason}.", { bot: bot.name, phone: model, reason: tr(userLoc, REASONS[reason] ?? "it ended") });
    audit(userId, "computer", text, own ? bot.id : null);
    if (own && own.kind === "agent" && reason !== "handover" && reason !== "idle") rows.append(own, { kind: "event", event: "relay", text, tone: reason === "user_stop" || reason === "hotkey" ? "warn" : "info" }, 0);
  }
  announce(userId);
});
