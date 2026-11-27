import { lastListing, listPhones, noteUse, offersAndroid, phoneHeld, phoneUse, type AndroidPhone, type PhoneListing } from "../androidusb.js";
import { tr } from "../i18n.js";
import type { ToolSpec } from "../llm/types.js";
import { devices, labelOf, liveDevice, relayRequest, type RelayResult } from "../relay.js";
import { unseal } from "../auth.js";
import { parseTotp, totpNow } from "../totp.js";
import { audit, bots, clip, hideForAWhile, vault } from "../store.js";
import { guardVault } from "../vaultaccess.js";
import { committingKind } from "./bind.js";
import { normalize } from "./grounding.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * L177 « Android par USB » — the owner's bots use an Android phone plugged by USB into one of the owner's computers,
 * through Sklubot Relais 1.9 (docs/RELAIS-PROTOCOLE.md §20; companion/src/main/capabilities/adb.js runs Google's own
 * adb, companion/src/main/phone-usb.js imposes the rules). Tool names follow the my_* computer tools:
 * phone_devices (≈ my_computers), phone_screen (≈ my_screen), phone_ui_tree (≈ my_ui_tree), phone_tap (≈ my_click),
 * phone_swipe (≈ my_drag / my_scroll), phone_type (≈ my_type), phone_key (≈ my_key), phone_open (≈ my_open).
 *
 * Locks, all required:
 *  - here, a card before a bot first uses a phone (« Utiliser le téléphone … »), strict after outside content;
 *  - a single-use card to tap a control whose words commit something (send, pay, delete, publish, confirm… and
 *    install / uninstall / update: nothing is installed without the owner's card), read from what the PHONE reported
 *    in the bot's last phone_ui_tree, never from the bot's words; the tap re-reads the screen first;
 *  - never a password as text: phone_type is refused in a password field; phone_vault_fill types a saved login from
 *    the vault after a single-use card (item, field, app, « •••• (N) »), sends `force`, and the computer asks again;
 *    the secret is never in a tool's arguments, so never in the card, the chat, the steps, the audit or a log;
 *  - on the computer, the Relais' own question the first time per bot and phone, « utilisé par … », Stop.
 * Only devices of the bot's own account (devices.list(userId)); a bot the owner stopped from Settings is held back.
 */

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const numb = (description: string) => ({ type: "number", description });
const PHONE = str("Which phone (its model or serial from phone_devices), only needed when several are plugged in");
const DEVICE = str("Which of the user's computers the phone is plugged into (its name), only needed when several offer phones");
const SOURCE = "My computer";
const useKey = (botName: string) => `phoneusb: use: ${botName}`;

/** Install-type words (on top of bind.ts committingKind): tapping them asks the owner every time. */
const INSTALL_WORDS = ["installer", "install", "desinstaller", "uninstall", "mettre a jour", "update", "telecharger l'application"];
export function committingTap(label: string): string | null {
  const kind = committingKind(label);
  if (kind) return kind;
  const n = ` ${normalize(label)} `;
  return INSTALL_WORDS.some((w) => n.includes(` ${normalize(w)} `)) ? "install" : null;
}

// ── What the phone reported to this bot last (screenshot scale, UI tree) ──────
interface UiNode { text?: string; desc?: string; id?: string; class?: string; bounds: [number, number, number, number]; click?: boolean; edit?: boolean; password?: boolean; focused?: boolean; checked?: boolean }
interface Snap { at: number; app: string; nodes: UiNode[] }
interface Shot { width: number; height: number; screenWidth: number; screenHeight: number }
const snaps = new Map<string, Snap>();
const shots = new Map<string, Shot>();
const key3 = (botId: string, deviceId: string, serial: string) => `${botId}\u0000${deviceId}\u0000${serial}`;
const SNAP_FRESH_MS = 5_000;
/** The commit or password action the owner approved on a card (single use), by bot/device/phone. */
const approved = new Map<string, { kind: "commit"; what: string; at: number }>();
export function forgetPhoneState() { snaps.clear(); shots.clear(); approved.clear(); }
export function notePhoneSnapshot(botId: string, deviceId: string, serial: string, r: { app?: { package?: unknown }; nodes?: unknown }) {
  const nodes = (Array.isArray(r.nodes) ? r.nodes : []).filter((n): n is UiNode => !!n && typeof n === "object" && Array.isArray((n as UiNode).bounds)).slice(0, 400);
  if (snaps.size > 500) snaps.delete(snaps.keys().next().value!);
  snaps.set(key3(botId, deviceId, serial), { at: Date.now(), app: clip(String(r.app?.package ?? ""), 120), nodes });
}
const labelOfNode = (n: UiNode) => clip((n.text || n.desc || "").trim(), 120);
/** The smallest clickable node at a point of the real screen. */
function nodeAt(nodes: UiNode[], x: number, y: number): UiNode | null {
  let best: UiNode | null = null;
  for (const n of nodes) {
    const [bx, by, bw, bh] = n.bounds;
    if (!n.click || x < bx || y < by || x > bx + bw || y > by + bh) continue;
    if (!best || bw * bh < best.bounds[2] * best.bounds[3]) best = n;
  }
  return best;
}
/** The label of what this tap would press, from the last tree (element index, or the point in screen pixels). */
function tapTarget(snap: Snap | undefined, a: Record<string, any>, shot: Shot | undefined): { node: UiNode | null; x: number; y: number } | null {
  if (typeof a.element === "number" && snap) {
    const n = snap.nodes[Math.round(a.element)];
    if (!n) return null;
    return { node: n, x: Math.round(n.bounds[0] + n.bounds[2] / 2), y: Math.round(n.bounds[1] + n.bounds[3] / 2) };
  }
  if (typeof a.x !== "number" || typeof a.y !== "number") return null;
  const x = shot ? Math.round((a.x * shot.screenWidth) / shot.width) : Math.round(a.x);
  const y = shot ? Math.round((a.y * shot.screenHeight) / shot.height) : Math.round(a.y);
  return { node: snap ? nodeAt(snap.nodes, x, y) : null, x, y };
}

// ── Which computer and which phone ───────────────────────────────────────────
interface Where { deviceId: string; deviceLabel: string; phone: AndroidPhone }
const phoneName = (p: AndroidPhone) => p.model ? `${p.model}${p.android ? ` (Android ${p.android})` : ""}` : p.serial;

/** The computers of this account that offer phones now (sync, for the cards). */
function phoneComputers(userId: string, wanted: unknown) {
  const all = devices.list(userId).filter((d) => liveDevice(userId, d.id) && offersAndroid(userId, d.id));
  const w = typeof wanted === "string" ? wanted.trim().toLowerCase() : "";
  return w ? all.filter((d) => d.id.toLowerCase() === w || d.name.toLowerCase() === w || d.name.toLowerCase().startsWith(w)) : all;
}
function choosePhone(list: AndroidPhone[], wanted: unknown): AndroidPhone | string {
  const w = typeof wanted === "string" ? wanted.trim().toLowerCase() : "";
  const ready = list.filter((p) => p.state === "device");
  if (w) {
    const p = list.find((x) => x.serial.toLowerCase() === w) ?? list.find((x) => (x.model ?? "").toLowerCase() === w) ?? list.find((x) => (x.model ?? "").toLowerCase().includes(w));
    return p ?? `No phone called "${clip(String(wanted), 60)}" is plugged in. Plugged in: ${list.map(phoneName).join(", ") || "none"}.`;
  }
  if (ready.length === 1) return ready[0];
  if (ready.length > 1) return `Several phones are plugged in (${ready.map(phoneName).join(", ")}). Say which one with "phone".`;
  if (list.some((p) => p.state === "unauthorized")) return list.find((p) => p.state === "unauthorized")!;
  return list[0] ?? "No Android phone is plugged into the computer. Ask the user to plug it in by USB, with USB debugging turned on (Settings → Developer options).";
}

/** Sync guess for a card: the phone the bot named or the only one listed lately. */
function cardWhere(userId: string, a: Record<string, any>): Where | null {
  const comps = phoneComputers(userId, a.device);
  if (comps.length !== 1) return null;
  const listing = lastListing(comps[0].id);
  const p = listing ? choosePhone(listing.devices, a.phone) : null;
  if (!p || typeof p === "string") return { deviceId: comps[0].id, deviceLabel: labelOf(comps[0]), phone: { serial: "", state: "device" } };
  return { deviceId: comps[0].id, deviceLabel: labelOf(comps[0]), phone: p };
}

const GUIDE = "adb (Google's Android SDK Platform-Tools) is not installed on that computer, so Sklubot cannot reach the phone. Tell the user, in simple words: 1. download « SDK Platform-Tools » from https://developer.android.com/tools/releases/platform-tools and unzip it (or install it with Android Studio); 2. on the phone, turn on Developer options and USB debugging; 3. plug the phone in by USB and tap « Allow » on the phone. Sklubot never downloads it by itself. Do not retry before they say it is done.";

async function where(c: ToolContext, a: Record<string, any>): Promise<Where | ToolOutput> {
  const loc = c.user.locale;
  const comps = phoneComputers(c.user.id, a.device);
  if (!comps.length) {
    const any = devices.list(c.user.id).filter((d) => liveDevice(c.user.id, d.id));
    return { content: any.length ? "None of the user's connected computers offers Android phones by USB: it needs Sklubot Relais 1.9 or later on the computer the phone is plugged into. Tell the user to update the Sklubot app there." : "No computer of the user is connected. An Android phone plugged by USB is used through the Sklubot app (Relais) on that computer: ask the user to open it.", isError: true, summary: tr(loc, "no computer") };
  }
  if (comps.length > 1) return { content: `Several computers offer Android phones (${comps.map((d) => d.name).join(", ")}). Say which one with "device".`, isError: true, summary: tr(loc, "which computer?") };
  const d = comps[0];
  const l = await listPhones(c.user.id, d.id, { signal: c.signal });
  if (!l) return { content: "That computer is not connected any more.", isError: true, summary: tr(loc, "offline") };
  if ("ok" in l) return failedText(c, l as Extract<RelayResult, { ok: false }>, labelOf(d), "");
  const listing = l as PhoneListing;
  if (!listing.adb.found) return { content: GUIDE, isError: true, summary: tr(loc, "adb is missing") };
  const p = choosePhone(listing.devices, a.phone);
  if (typeof p === "string") return { content: p, isError: true, summary: tr(loc, "no phone") };
  if (p.state === "unauthorized") return { content: `The phone ${p.serial} is plugged into ${labelOf(d)} but has not allowed this computer yet. Ask the user to unlock the phone and tap « Allow » in its « Allow USB debugging? » message (tick « Always allow from this computer »), then try again.`, isError: true, summary: tr(loc, "phone not allowed yet") };
  if (p.state !== "device") return { content: `The phone ${p.serial} is ${p.state}. Ask the user to unplug it and plug it in again.`, isError: true, summary: tr(loc, "phone not ready") };
  if (phoneHeld(c.bot.id, d.id, p.serial)) return { content: "The user stopped your use of this phone from Sklubot. Do not use it again unless they ask you to.", isError: true, summary: tr(loc, "stopped by you") };
  return { deviceId: d.id, deviceLabel: labelOf(d), phone: p };
}

const REFUSALS: Record<string, { model: string; summary: string }> = {
  consent_refused: { model: "The user refused on the computer: you may not use this phone. Do not ask again now; carry on without it or ask them in the chat.", summary: "refused" },
  consent_expired: { model: "Nobody answered the question on the computer. Do not retry in a loop: tell the user you need them to answer on the computer.", summary: "no answer" },
  consent_cooldown: { model: "The user refused a moment ago: do not ask again for {wait}.", summary: "refused" },
  consent_pending: { model: "A question is open on the computer: wait for the user's answer.", summary: "question open" },
  locked: { model: "The user pressed Stop on the computer: nothing can be done on it or its phones until they allow control again there. Do not retry.", summary: "stopped" },
  busy: { model: "{holder} is using this phone right now. Wait and try again in {wait}, or tell the user.", summary: "phone in use" },
  blocked_app: { model: "That app is always refused on the phone (Sklubot itself, the app installer, the settings): you cannot see or touch it. Ask the user to do that part themselves.", summary: "app refused" },
  keep_out: { model: "The user keeps that app out of reach of the bots. Ask them to do that part themselves.", summary: "kept out" },
  password_field: { model: "A password field has the focus on the phone: you never type in it without the user's approval of that exact typing. Read the screen again with phone_ui_tree, then call phone_type again: the user will be asked. Or ask them to type it themselves.", summary: "password field" },
  foreground_unknown: { model: "The phone's screen cannot be read (it may be locked or off). Ask the user to unlock it, then try again.", summary: "screen unreadable" },
  phone_unauthorized: { model: "The phone has not allowed this computer yet: ask the user to unlock it and tap « Allow » on its USB-debugging message.", summary: "phone not allowed yet" },
  phone_offline: { model: "The phone is not ready: ask the user to unplug it and plug it in again.", summary: "phone not ready" },
  adb_missing: { model: GUIDE, summary: "adb is missing" },
  not_found: { model: "Not found on the phone (no such phone, or no such app). Check with phone_devices, or the package name of the app.", summary: "not found" },
  unsupported: { model: "The phone cannot do that over USB: {message}", summary: "not possible" },
  rate_limited: { model: "Too many requests: slow down and try again in a few seconds.", summary: "too fast" },
  offline: { model: "The computer is not connected any more. Ask the user to open the Sklubot app on it.", summary: "offline" },
  timeout: { model: "The computer did not answer in time. Try once more later.", summary: "no answer" },
};
function failedText(c: ToolContext, r: Extract<RelayResult, { ok: false }>, deviceLabel: string, phone: string): ToolOutput {
  const k = REFUSALS[r.code];
  const holder = (r as { holder?: { name?: string } }).holder?.name ?? "Another bot";
  const wait = `${Math.max(1, Math.ceil((r.retryAfterMs ?? 20_000) / 1000))} s`;
  if (!k) return { content: `The phone ${phone || ""} on ${deviceLabel} answered with an error (${r.code}): ${clip(r.message, 300)}`, isError: true, summary: clip(r.code, 40) };
  return { content: k.model.replace("{wait}", wait).replace("{holder}", holder).replace("{message}", clip(r.message, 200)), isError: true, summary: tr(c.user.locale, k.summary) };
}

async function send(c: ToolContext, w: Where, op: string, args: Record<string, unknown>, timeoutMs = 90_000): Promise<RelayResult> {
  // 90 s: the first use waits for the owner's answer on the computer (up to 60 s).
  const r = await relayRequest(w.deviceId, { id: c.bot.id, name: c.bot.name }, op, { serial: w.phone.serial, ...args }, { timeoutMs, signal: c.signal });
  if (r.ok) noteUse(w.deviceId, w.phone.serial, c.bot, w.phone.model ?? w.phone.serial);
  return r;
}

/** Runs one phone operation: finds the phone, sends, explains a refusal. */
async function onPhone(c: ToolContext, a: Record<string, any>, fn: (w: Where) => Promise<ToolOutput>): Promise<ToolOutput> {
  const w = await where(c, a);
  if ("content" in w) return w;
  return fn(w);
}

// ── Cards ────────────────────────────────────────────────────────────────────
type Gate = NonNullable<BuiltinTool["gate"]>;
/** First use of a phone by this bot: asked here (strict after outside content), then on the computer. */
export const phoneGate: Gate = (a, ctx) => {
  const bot = bots.byId(ctx.botId);
  if (!bot) return null;
  const w = cardWhere(bot.userId, a);
  if (!w) return null; // the tool itself explains (no computer, several…)
  if (w.phone.serial && phoneHeld(bot.id, w.deviceId, w.phone.serial)) return null; // the tool says the owner stopped it
  if (w.phone.serial && phoneUse(w.deviceId, w.phone.serial)?.botId === bot.id && !ctx.tainted) return null;
  return {
    key: useKey(bot.name), strict: ctx.tainted, source: SOURCE,
    vars: { phone: w.phone.serial ? phoneName(w.phone) : "Android", device: w.deviceLabel },
    title: ctx.tainted ? "{bot} has read outside content. Allow it to use your Android phone {phone} plugged into {device}?" : "Allow {bot} to use your Android phone {phone} plugged into {device} (see its screen, tap, swipe and type)?",
    reason: "use your phone {phone}",
    note: "The computer will also ask on its own screen. Press Stop there (or « Arrêter » in Settings → Computers) at any time. Never in Sklubot, the app installer or the settings.",
  };
};

/** Tapping a control that commits something (or installs): a single-use card, from the phone's own words. */
const tapGate: Gate = (a, ctx) => {
  const use = phoneGate(a, ctx);
  if (use) return use;
  const bot = bots.byId(ctx.botId);
  const w = bot ? cardWhere(bot.userId, a) : null;
  if (!bot || !w || !w.phone.serial) return null;
  const k = key3(bot.id, w.deviceId, w.phone.serial);
  const t = tapTarget(snaps.get(k), a, shots.get(k));
  const label = t?.node ? labelOfNode(t.node) : "";
  if (!label || !committingTap(label)) return null;
  approved.set(k, { kind: "commit", what: label, at: Date.now() });
  return {
    key: `phoneusb: commit: ${bot.name}`, strict: true, once: true, source: SOURCE,
    vars: { label: clip(label, 80), app: clip(snaps.get(k)?.app ?? "", 60), phone: phoneName(w.phone) },
    title: "Allow {bot} to tap “{label}” in {app} on your phone {phone}?", reason: "tap “{label}” on your phone",
    note: "These words commit something (send, pay, delete, publish, confirm, install…): you are asked every time.",
  };
};

/**
 * A password on the phone: only from the vault (phone_vault_fill), never as text the bot writes. A single-use card
 * names the item, the field and the app; it shows the secret as « •••• (N caractères) », never its value. The secret
 * is read from the vault only in run(), sent to the computer in that one request, and never put in the tool's
 * arguments, its result, the chat, the card, the audit or a log.
 */
const vaultGate: Gate = (a, ctx) => {
  const use = phoneGate(a, ctx);
  if (use) return use;
  const bot = bots.byId(ctx.botId);
  const w = bot ? cardWhere(bot.userId, a) : null;
  const item = bot ? vault.byName(bot.userId, String(a.item ?? "")) : null;
  if (!bot || !w || !w.phone.serial || !item) return null; // the tool explains
  const field = fieldOf(a);
  const k = key3(bot.id, w.deviceId, w.phone.serial);
  const target = focusedField(snaps.get(k));
  const n = secretOf(item, field)?.length ?? 0;
  return {
    key: `phoneusb: vault: ${bot.name}`, strict: true, once: true, source: "Vault",
    vars: { item: item.name, field, site: item.site || "—", target: clip(target?.id || "?", 80), app: clip(snaps.get(k)?.app || "?", 60), phone: phoneName(w.phone), n: String(n) },
    title: "Allow {bot} to fill the saved {field} of {item} into the field {target} of {app} on your phone {phone}?", reason: "fill a saved login on your phone",
    note: "Typed: •••• ({n} characters). Saved for: {site}. The secret goes only to your computer, never to the bot or the chat; the computer will ask again.",
  };
};
type Field = "username" | "password" | "code";
const fieldOf = (a: Record<string, any>): Field => (a.field === "username" ? "username" : a.field === "code" ? "code" : "password");
const focusedField = (snap: Snap | undefined) => snap?.nodes.find((n) => n.focused && (n.edit || n.password)) ?? null;
/** The value of a vault item's field (never logged). */
function secretOf(item: NonNullable<ReturnType<typeof vault.byName>>, field: Field): string | null {
  if (field === "username") return item.username || null;
  if (field === "password") return item.passwordEnc ? unseal(item.passwordEnc) : null;
  const seed = item.passwordEnc ? unseal(item.passwordEnc) : null;
  try { return seed ? totpNow({ ...parseTotp(seed), digits: item.digits === 8 ? 8 : 6, period: item.period }).code : null; } catch { return null; }
}

// ── The tools ────────────────────────────────────────────────────────────────
const base = { group: "mycomputer" as const, activity: "computer" as const, audited: true };
const ok = (content: string, summary: string): ToolOutput => ({ content, summary });

export const phoneUsbTools: BuiltinTool[] = guardVault([ // phone_vault_fill: the vault item rules (vaultaccess.ts)
  {
    spec: { name: "phone_devices", description: "List the Android phones plugged by USB into the user's computers (model, Android version, who uses each one). Model and version show only once the phone itself allowed USB debugging from that computer. Asks nothing.", inputSchema: obj({ device: DEVICE }) },
    ...base, label: "Looking for your Android phones",
    run: async (a, c) => {
      const comps = phoneComputers(c.user.id, a.device);
      if (!comps.length) return (await where(c, a)) as ToolOutput;
      const lines: string[] = [];
      for (const d of comps) {
        const l = await listPhones(c.user.id, d.id, { fresh: true, signal: c.signal });
        if (!l || "ok" in l) { lines.push(`${labelOf(d)}: no answer`); continue; }
        const listing = l as PhoneListing;
        if (!listing.adb.found) { lines.push(`${labelOf(d)}: adb is not installed. ${GUIDE}`); continue; }
        if (!listing.devices.length) lines.push(`${labelOf(d)}: no phone plugged in (USB debugging must be on).`);
        for (const p of listing.devices) {
          const u = phoneUse(d.id, p.serial);
          lines.push(`${labelOf(d)}: ${p.state === "device" ? phoneName(p) : `${p.serial} — not allowed yet: the user must tap « Allow » on the phone`} [serial ${p.serial}]${u ? ` — used by ${u.botName}` : ""}`);
        }
      }
      return ok(lines.join("\n"), tr(c.user.locale, "phones listed"));
    },
  },
  {
    spec: { name: "phone_screen", description: "Take a screenshot of the user's Android phone plugged by USB into their computer. Give later phone_tap / phone_swipe coordinates in pixels of this picture. The first use asks the user (here, then on the computer).", inputSchema: obj({ phone: PHONE, device: DEVICE }) },
    ...base, label: "Looking at your phone", outside: true, gate: phoneGate,
    run: (a, c) => onPhone(c, a, async (w) => {
      const r = await send(c, w, "android.screenshot", { maxWidth: 720 });
      if (!r.ok) return failedText(c, r, w.deviceLabel, phoneName(w.phone));
      const res = r.result as { format?: string; width?: number; height?: number; screenWidth?: number; screenHeight?: number; data?: string };
      if (typeof res.data !== "string" || !res.data || !res.width || !res.height) return { content: "The phone sent an empty picture (is its screen on?).", isError: true, summary: "empty" };
      shots.set(key3(c.bot.id, w.deviceId, w.phone.serial), { width: res.width, height: res.height, screenWidth: res.screenWidth || res.width, screenHeight: res.screenHeight || res.height });
      return {
        content: [
          { type: "text", text: `Screenshot of the phone ${phoneName(w.phone)} (on ${w.deviceLabel}): ${res.width}×${res.height} pixels (the screen itself is ${res.screenWidth}×${res.screenHeight}). Give phone_tap / phone_swipe coordinates in pixels of this picture. phone_ui_tree lists the controls with numbers you can tap instead.` },
          { type: "image", mediaType: res.format === "png" ? "image/png" : "image/jpeg", data: res.data },
        ],
        summary: phoneName(w.phone),
      };
    }),
  },
  {
    spec: { name: "phone_ui_tree", description: "Read the controls on the phone's screen (buttons, fields, texts) with a number for each; tap one with phone_tap element. More reliable than pixels. Password fields are shown as •••• and never their value.", inputSchema: obj({ phone: PHONE, device: DEVICE }) },
    ...base, label: "Reading your phone's screen", outside: true, gate: phoneGate,
    run: (a, c) => onPhone(c, a, async (w) => {
      const r = await send(c, w, "android.ui", { maxNodes: 200 });
      if (!r.ok) return failedText(c, r, w.deviceLabel, phoneName(w.phone));
      const res = r.result as { app?: { package?: string }; nodes?: UiNode[]; truncated?: boolean };
      notePhoneSnapshot(c.bot.id, w.deviceId, w.phone.serial, res);
      const nodes = res.nodes ?? [];
      const text = nodes.map((n, i) => `[${i}] ${n.class ?? "View"}${n.password ? " (password field)" : n.edit ? " (field)" : ""} “${clip(labelOfNode(n), 80)}”${n.click ? " tappable" : ""}${n.focused ? " focused" : ""}${n.checked !== undefined ? ` checked=${n.checked}` : ""} at ${n.bounds.join(",")}`).join("\n");
      return ok(`App in front on ${phoneName(w.phone)}: ${clip(String(res.app?.package ?? "?"), 100)}\n${clip(text, 30_000) || "(nothing readable)"}${res.truncated ? "\n(more controls not listed)" : ""}\nTap one with phone_tap element <number>; read again after acting.`, clip(String(res.app?.package ?? ""), 40));
    }),
  },
  {
    spec: { name: "phone_tap", description: "Tap on the phone: element (a number from your last phone_ui_tree), or x/y in pixels of your last phone_screen picture. long: a long press. Tapping a control that sends, pays, deletes, confirms or installs asks the user first.", inputSchema: obj({ element: numb("A control's number from phone_ui_tree"), x: numb("Pixels from the left of your last phone_screen picture"), y: numb("Pixels from the top"), long: { type: "boolean", description: "Long press" }, phone: PHONE, device: DEVICE }) },
    ...base, label: "Tapping on your phone", gate: tapGate,
    run: (a, c) => onPhone(c, a, async (w) => {
      const k = key3(c.bot.id, w.deviceId, w.phone.serial);
      let snap = snaps.get(k);
      if (typeof a.element === "number") {
        if (!snap || Date.now() - snap.at > 2 * 60_000) return { content: "Read the phone's controls with phone_ui_tree first (or again: the last reading is old), then tap one by its number.", isError: true, summary: tr(c.user.locale, "read first") };
      } else if (!snap || Date.now() - snap.at > SNAP_FRESH_MS) {
        // Re-read the screen right before tapping: what is under the finger NOW decides whether the owner is asked.
        const u = await send(c, w, "android.ui", { maxNodes: 400 });
        if (!u.ok) return failedText(c, u, w.deviceLabel, phoneName(w.phone));
        notePhoneSnapshot(c.bot.id, w.deviceId, w.phone.serial, u.result as Record<string, unknown>);
        snap = snaps.get(k);
      }
      const t = tapTarget(snap, a, shots.get(k));
      if (!t) return { content: typeof a.element === "number" ? "No control has that number in your last phone_ui_tree: read it again." : "Give element, or x and y.", isError: true, summary: "where?" };
      const label = t.node ? labelOfNode(t.node) : "";
      const ap = approved.get(k);
      approved.delete(k);
      if (label && committingTap(label) && !(ap?.kind === "commit" && ap.what === label && Date.now() - ap.at < 5 * 60_000)) {
        return { content: `“${clip(label, 80)}” commits something (send, pay, delete, confirm, install…): the user must approve it. Call phone_tap again on it (element number from phone_ui_tree): they will get a card.`, isError: true, summary: tr(c.user.locale, "needs your approval") };
      }
      const r = await send(c, w, "android.tap", { x: t.x, y: t.y, long: a.long === true });
      if (!r.ok) return failedText(c, r, w.deviceLabel, phoneName(w.phone));
      snaps.delete(k);
      return ok(`Tapped${label ? ` “${clip(label, 80)}”` : ""} at ${t.x},${t.y} on ${phoneName(w.phone)}. Look again (phone_screen or phone_ui_tree) to check the result.`, label ? clip(label, 40) : `${t.x},${t.y}`);
    }),
  },
  {
    spec: { name: "phone_swipe", description: "Swipe on the phone (scroll a list, turn a page): from and to in pixels of your last phone_screen picture. To scroll down, swipe from the bottom to the top.", inputSchema: obj({ fromX: numb("Start, from the left"), fromY: numb("Start, from the top"), toX: numb("End, from the left"), toY: numb("End, from the top"), durationMs: numb("50 to 3000 (default 300)"), phone: PHONE, device: DEVICE }, ["fromX", "fromY", "toX", "toY"]) },
    ...base, label: "Swiping on your phone", gate: phoneGate,
    run: (a, c) => onPhone(c, a, async (w) => {
      const s = shots.get(key3(c.bot.id, w.deviceId, w.phone.serial));
      const sx = (v: unknown) => Math.max(0, Math.round(s ? (Number(v) * s.screenWidth) / s.width : Number(v)));
      const sy = (v: unknown) => Math.max(0, Math.round(s ? (Number(v) * s.screenHeight) / s.height : Number(v)));
      if (![a.fromX, a.fromY, a.toX, a.toY].every((v) => Number.isFinite(Number(v)))) return { content: "fromX, fromY, toX and toY are numbers.", isError: true, summary: "where?" };
      const durationMs = Number.isFinite(Number(a.durationMs)) ? Math.min(3000, Math.max(50, Math.round(Number(a.durationMs)))) : 300;
      const r = await send(c, w, "android.swipe", { fromX: sx(a.fromX), fromY: sy(a.fromY), toX: sx(a.toX), toY: sy(a.toY), durationMs });
      if (!r.ok) return failedText(c, r, w.deviceLabel, phoneName(w.phone));
      snaps.delete(key3(c.bot.id, w.deviceId, w.phone.serial));
      return ok(`Swiped on ${phoneName(w.phone)}. Look again to check.`, "swipe");
    }),
  },
  {
    spec: { name: "phone_type", description: "Type text into the field that has the focus on the phone (tap the field first). Plain letters, digits and signs only over USB (no accents or emoji), 500 characters at most. Never into a password field: use phone_vault_fill with a saved login, or ask the user to type it.", inputSchema: obj({ text: str("The text to type"), phone: PHONE, device: DEVICE }, ["text"]) },
    ...base, label: "Typing on your phone", gate: phoneGate,
    run: (a, c) => onPhone(c, a, async (w) => {
      const text = clip(String(a.text ?? ""), 500);
      if (!text) return { content: "text is empty.", isError: true, summary: "empty" };
      // Never `force`: a password only comes from the vault (phone_vault_fill), so no secret is ever in a tool's arguments.
      const r = await send(c, w, "android.type", { text });
      if (!r.ok) return r.code === "password_field" ? { content: "A password field has the focus on the phone: you never type a password yourself. Use phone_vault_fill with the saved login (vault_list shows the names), or ask the user to type it.", isError: true, summary: tr(c.user.locale, "password field") } : failedText(c, r, w.deviceLabel, phoneName(w.phone));
      return ok(`Typed ${text.length} characters on ${phoneName(w.phone)}.`, `${text.length} characters`);
    }),
  },
  {
    spec: { name: "phone_vault_fill", description: "Sign in on the user's Android phone: type a login saved in the vault (username or password), or the current code of a saved two-factor generator, into the field that has the focus. Tap the field and read it with phone_ui_tree first. The secret goes only to the user's computer: you never see it. The user is asked every time, here and on the computer.", inputSchema: obj({ item: str("Name of the vault item"), field: { type: "string", enum: ["username", "password", "code"], description: "username or password for a login; code for a two-factor generator" }, phone: PHONE, device: DEVICE }, ["item", "field"]) },
    ...base, label: "Filling a saved login on your phone", gate: vaultGate, detail: (a) => clip(String(a.item ?? ""), 40),
    run: (a, c) => onPhone(c, a, async (w) => {
      const item = vault.byName(c.user.id, String(a.item ?? ""));
      if (!item) return { content: `No vault item is called "${clip(String(a.item), 80)}". Use vault_list to see the names.`, isError: true };
      const field = fieldOf(a);
      if ((field === "code") !== (item.kind === "totp")) return { content: field === "code" ? "That item is not a two-factor code generator." : "A two-factor generator only gives a code: use field \"code\".", isError: true };
      let secret = secretOf(item, field);
      if (!secret) return { content: `That item has no ${field} saved.`, isError: true };
      if (field === "code") hideForAWhile(c.user.id, secret);
      // The secret goes ONLY to the computer, in this one request: never in the result, the chat, the audit or a log.
      // `force`: the owner approved this item in this field on the card above; the computer asks again (phone_password).
      const r = await send(c, w, "android.type", { text: secret, force: true });
      secret = null;
      if (!r.ok) return failedText(c, r, w.deviceLabel, phoneName(w.phone));
      audit(c.user.id, "computer", `${c.bot.name} → ${phoneName(w.phone)} : ${tr(c.user.locale, "saved login filled")} ${clip(item.name, 80)} (${field})`, c.bot.id);
      return ok(`Filled the saved ${field} of "${item.name}" into the focused field on ${phoneName(w.phone)} (you never see it).`, `${item.name} · ${field}`);
    }),
  },
  {
    spec: { name: "phone_key", description: "Press a phone key: back, home, recents (the app switcher), enter, delete, tab or escape.", inputSchema: obj({ key: { type: "string", enum: ["back", "home", "recents", "enter", "delete", "tab", "escape"] }, phone: PHONE, device: DEVICE }, ["key"]) },
    ...base, label: "Pressing a key on your phone", gate: phoneGate, detail: (a) => (typeof a.key === "string" ? a.key : undefined),
    run: (a, c) => onPhone(c, a, async (w) => {
      const r = await send(c, w, "android.key", { key: String(a.key ?? "") });
      if (!r.ok) return failedText(c, r, w.deviceLabel, phoneName(w.phone));
      snaps.delete(key3(c.bot.id, w.deviceId, w.phone.serial));
      return ok(`Pressed ${String(a.key)} on ${phoneName(w.phone)}.`, String(a.key));
    }),
  },
  {
    spec: { name: "phone_open", description: "Open an app on the phone by its Android package name (e.g. com.whatsapp, com.google.android.apps.maps). Installs nothing: an app that is not there must be installed by the user. Sklubot, the app installer and the settings are refused.", inputSchema: obj({ package: str("The app's package name"), phone: PHONE, device: DEVICE }, ["package"]) },
    ...base, label: "Opening an app on your phone", gate: phoneGate, detail: (a) => (typeof a.package === "string" ? clip(a.package, 60) : undefined),
    run: (a, c) => onPhone(c, a, async (w) => {
      const pkg = String(a.package ?? "").trim();
      if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(pkg) || pkg.length > 150) return { content: "package must be an Android package name such as com.example.app.", isError: true, summary: "invalid" };
      const r = await send(c, w, "android.open", { package: pkg });
      if (!r.ok) return failedText(c, r, w.deviceLabel, phoneName(w.phone));
      snaps.delete(key3(c.bot.id, w.deviceId, w.phone.serial));
      return ok(`Opened ${pkg} on ${phoneName(w.phone)}. Look at the screen to go on.`, pkg);
    }),
  },
]);
