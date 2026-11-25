// @ts-check
'use strict';
/**
 * Android phones by USB (protocol 1.9, docs/RELAIS-PROTOCOLE.md §20, A-FAIRE L177): the rules the Relais imposes,
 * whatever Sklubot asks. The phone itself must first have accepted this computer (its « Autoriser le débogage USB »
 * dialog): a phone that did not is listed as `unauthorized`, without model, and nothing can be sent to it.
 *
 *  - Asked HERE, on the computer, the first time each bot uses each phone (askGuard kind "phone"); the yes lasts
 *    until Stop or until the Relais closes. Listing the phones asks nothing (no screen, no touch).
 *  - One bot at a time per phone: another bot gets `busy` (with `holder`) until the first one has been idle 20 s.
 *    « {phone} utilisé par {bot} » is shown on the computer (banner + window) and sent to Sklubot (events
 *    `phone.started` / `phone.ended`).
 *  - Stop (banner, tray, hotkey) wins: it ends every phone use, aborts the adb commands under way, forgets every yes
 *    and locks the Relais (`locked` for everything, as for the computer).
 *  - Never in Sklubot's own app, the system installer (nothing gets installed from here: there is no install
 *    operation at all) or the system settings, nor in an app of the owner's keep-out list (`guard.set keepApps`):
 *    `blocked_app` / `keep_out` for screenshots, the UI tree, touches, typing and keys. The app in front is re-read
 *    right before each action; unreadable → `foreground_unknown` (fail closed).
 *  - Typing: the focused field is re-read first; a password field is refused (`password_field`) unless Sklubot sends
 *    `force` (the owner approved that exact action on a card) AND the owner allows it again here (kind "phone_password").
 *    The text is never written to the local log (its length only).
 */
const { ERR } = require('./protocol');
const G = require('./guard');

const HANDOVER_IDLE_MS = 20_000;
const USE_IDLE_MS = 120_000;
/** Apps the Relais never reads or touches on a phone (package prefixes). */
const DENIED_PACKAGES = [
  { group: 'Sklubot', test: (/** @type {string} */ p) => /sklubot/i.test(p) },
  { group: 'system installer', test: (/** @type {string} */ p) => /^com\.(google\.)?android\.packageinstaller$/.test(p) || p === 'com.android.permissioncontroller' || p === 'com.google.android.permissioncontroller' },
  { group: 'system settings', test: (/** @type {string} */ p) => p === 'com.android.settings' },
];
const ACTION_OPS = new Set(['android.tap', 'android.swipe', 'android.type', 'android.key', 'android.open']);

/** The denied group of a package, or null. @param {string} pkg */
function deniedPackage(pkg) {
  const p = String(pkg || '');
  const hit = DENIED_PACKAGES.find((d) => d.test(p));
  return hit ? hit.group : null;
}

/** A package in the owner's keep-out list (same matching as an app name on the computer). @param {string} pkg @param {string[]} keepApps */
function keptOut(pkg, keepApps) {
  const p = G.normApp(pkg);
  return (keepApps || []).some((k) => { const n = G.normApp(k); return !!n && (p === n || p.includes(n)); });
}

/**
 * @typedef {{ id: string, name: string }} Bot
 * @typedef {{ botId: string, botName: string, serial: string, model: string, since: number, lastActivity: number }} PhoneUse
 */
class PhoneUsb {
  /** @param {import('./relay-core').RelayCore} core */
  constructor(core) {
    this.core = core;
    /** "botId\u0000serial" the owner allowed here: cleared by Stop. */
    this.allowed = new Set();
    /** @type {Map<string, PhoneUse>} who uses which phone now */
    this.uses = new Map();
    /** @type {Map<string, any>} phones seen by the last listing, by serial */
    this.seen = new Map();
    /** @type {Set<AbortController>} adb commands under way */
    this.running = new Set();
    this.timer = null;
    /** @type {boolean|null} whether the last listing found adb */
    this.adbFound = null;
  }

  get caps() { return this.core.d.caps; }

  /** For the window and the banner. */
  state() { return [...this.uses.values()].map((u) => ({ serial: u.serial, model: u.model, botName: u.botName, since: u.since })); }

  changed() { if (typeof this.core.d.ui.onPhones === 'function') this.core.d.ui.onPhones(this.state()); }

  /** @param {string} id @param {Bot} bot @param {string} op @param {Record<string, any>} args */
  async handle(id, bot, op, args) {
    const core = this.core;
    if (typeof this.caps.androidDevices !== 'function') return core.fail(id, ERR.UNSUPPORTED, 'Android phones by USB are not offered by this computer');
    if (op === 'android.devices') return core.ok(id, await this.list());
    if (op === 'android.release') return core.ok(id, { released: this.release(bot, args.serial) });
    const phone = await this.phone(args.serial);
    if (!phone && this.adbFound === false) return core.fail(id, ERR.ADB_MISSING, 'adb (Android SDK Platform-Tools) is not installed on this computer: the owner installs it from developer.android.com/tools/releases/platform-tools');
    if (!phone) return core.fail(id, ERR.NOT_FOUND, 'no such phone plugged into this computer');
    if (phone.state === 'unauthorized') return core.fail(id, ERR.PHONE_UNAUTHORIZED, 'the phone has not allowed USB debugging from this computer yet: unlock it and tap Allow');
    if (phone.state !== 'device') return core.fail(id, ERR.PHONE_OFFLINE, `the phone is ${phone.state}: unplug it and plug it in again`);
    const holder = this.uses.get(phone.serial);
    if (holder && holder.botId !== bot.id) {
      const wait = HANDOVER_IDLE_MS - (core.now() - holder.lastActivity);
      if (wait > 0) return core.fail(id, ERR.BUSY, 'another bot is using this phone', { holder: { id: holder.botId, name: holder.botName }, retryAfterMs: Math.max(1000, Math.ceil(wait)) });
    }
    const key = `${bot.id}\u0000${phone.serial}`;
    const model = phone.model || phone.serial;
    if (!this.allowed.has(key) && !core.d.autoConfirm) {
      const answer = await core.askGuard(bot, /** @type {any} */ ('phone'), `${model}${phone.android ? ` · Android ${phone.android}` : ''} (${phone.serial})`);
      if (answer !== 'allow') return core.fail(id, ERR.CONSENT_REFUSED, 'the user did not allow this phone on the computer');
      if (core.locked) return core.fail(id, ERR.LOCKED, 'the user stopped remote control on this computer');
      this.allowed.add(key);
    }
    this.use(bot, phone.serial, model);
    const ac = new AbortController();
    this.running.add(ac);
    try {
      /** @type {Record<string, any>} */
      const a = { ...args, signal: ac.signal };
      if (op !== 'android.open' && op !== 'android.key') {
        const no = await this.front(phone.serial, ac.signal);
        if (no) { core.d.log({ kind: 'refused', bot, op, why: no.code }); return core.fail(id, no.code, no.message); }
      } else if (op === 'android.key' && args.key === 'enter') {
        const no = await this.front(phone.serial, ac.signal);
        if (no) return core.fail(id, no.code, no.message);
      }
      if (op === 'android.open') {
        const group = deniedPackage(args.package);
        if (group) return core.fail(id, ERR.BLOCKED_APP, `${group}: refused on this phone`);
        if (keptOut(args.package, core.owner.keepApps)) return core.fail(id, ERR.KEEP_OUT, 'the owner keeps this app out of reach');
      }
      let result;
      switch (op) {
        case 'android.screenshot': {
          const r = await this.caps.androidScreenshot(a);
          result = { ...r, screenWidth: r.screenWidth || r.width, screenHeight: r.screenHeight || r.height, data: Buffer.isBuffer(r.data) ? r.data.toString('base64') : r.data };
          break;
        }
        case 'android.ui': {
          const r = await this.caps.androidUi(a);
          result = { app: { package: r.package }, nodes: r.nodes, truncated: r.truncated };
          break;
        }
        case 'android.type': {
          const refused = await this.typingCheck(bot, phone.serial, args, ac.signal);
          if (refused) return core.fail(id, refused.code, refused.message);
          try { result = await this.caps.androidType(a); } finally { args.text = ''; a.text = ''; }
          break;
        }
        case 'android.tap': await this.caps.androidTap(a); result = {}; break;
        case 'android.swipe': await this.caps.androidSwipe(a); result = {}; break;
        case 'android.key': await this.caps.androidKey(a); result = {}; break;
        case 'android.open': result = await this.caps.androidOpen(a); break;
        default: return core.fail(id, ERR.UNKNOWN_OP, 'unknown operation');
      }
      if (core.locked || ac.signal.aborted) return core.fail(id, ERR.LOCKED, 'the user stopped remote control on this computer');
      this.touch(phone.serial);
      if (ACTION_OPS.has(op)) core.d.log({ kind: 'android', bot, op, serial: phone.serial });
      return core.ok(id, result || {});
    } finally {
      this.running.delete(ac);
    }
  }

  /** `adb devices -l` (+ model and Android version for authorised phones). Remembered for the next requests. */
  async list() {
    const r = await this.caps.androidDevices();
    this.seen = new Map((r.devices || []).map((/** @type {any} */ d) => [d.serial, d]));
    this.adbFound = !!(r.adb && r.adb.found);
    for (const serial of [...this.uses.keys()]) if (!this.seen.has(serial)) this.end(serial, 'unplugged');
    return { adb: r.adb, devices: (r.devices || []).map((/** @type {any} */ d) => ({ ...d, inUse: this.uses.get(d.serial)?.botName || null })) };
  }

  /** The phone with this serial, listing again when it is not known or not ready. @param {string} serial */
  async phone(serial) {
    let p = this.seen.get(serial);
    if (!p || p.state !== 'device') { await this.list(); p = this.seen.get(serial); }
    return p || null;
  }

  /**
   * The app in front must be readable and allowed. dumpsys first (fast), the UI tree's package otherwise.
   * @param {string} serial @param {AbortSignal} signal
   * @returns {Promise<{ code: string, message: string } | null>}
   */
  async front(serial, signal) {
    let pkg = typeof this.caps.androidFocus === 'function' ? await this.caps.androidFocus({ serial, signal }) : null;
    if (!pkg) { try { pkg = (await this.caps.androidUi({ serial, maxNodes: 1, signal })).package || null; } catch { pkg = null; } }
    if (!pkg) return { code: ERR.FOREGROUND_UNKNOWN, message: 'cannot tell which app is in front on the phone (is it unlocked?): nothing was done' };
    const group = deniedPackage(pkg);
    if (group) return { code: ERR.BLOCKED_APP, message: `${group}: refused on this phone` };
    if (keptOut(pkg, this.core.owner.keepApps)) return { code: ERR.KEEP_OUT, message: 'the owner keeps this app out of reach' };
    return null;
  }

  /**
   * Re-reads the focused field before typing. Password field: only with `force` and a yes here.
   * @param {Bot} bot @param {string} serial @param {Record<string, any>} args @param {AbortSignal} signal
   */
  async typingCheck(bot, serial, args, signal) {
    let ui;
    try { ui = await this.caps.androidUi({ serial, maxNodes: 400, signal }); } catch { ui = null; }
    if (!ui) return { code: ERR.FOREGROUND_UNKNOWN, message: 'cannot read the field that has the focus: nothing was typed' };
    if (!ui.focusedPassword) return null;
    if (!args.force) return { code: ERR.PASSWORD_FIELD, message: 'a password field has the focus: the owner types passwords, or approves this exact action in Sklubot' };
    if (this.core.d.autoConfirm) return null;
    const field = ui.focusedEdit && ui.focusedEdit.id ? ui.focusedEdit.id : 'password';
    const answer = await this.core.askGuard(bot, /** @type {any} */ ('phone_password'), `${ui.package} · ${field} · ${args.text.length} ${args.text.length === 1 ? 'character' : 'characters'}`);
    if (answer !== 'allow') return { code: ERR.PASSWORD_FIELD, message: 'the owner did not allow typing in this password field' };
    if (this.core.locked) return { code: ERR.LOCKED, message: 'the user stopped remote control on this computer' };
    return null;
  }

  /** @param {Bot} bot @param {string} serial @param {string} model */
  use(bot, serial, model) {
    const t = this.core.now();
    const cur = this.uses.get(serial);
    if (cur && cur.botId === bot.id) { cur.lastActivity = t; return; }
    if (cur) this.end(serial, 'handover', { to: bot });
    this.uses.set(serial, { botId: bot.id, botName: bot.name, serial, model, since: t, lastActivity: t });
    this.core.event('phone.started', { bot, serial, model });
    this.core.d.log({ kind: 'phone.started', bot, serial, model });
    this.schedule();
    this.changed();
  }

  /** @param {string} serial */
  touch(serial) { const u = this.uses.get(serial); if (u) u.lastActivity = this.core.now(); }

  /** @param {string} serial @param {string} reason @param {object} [extra] */
  end(serial, reason, extra = {}) {
    const u = this.uses.get(serial);
    if (!u) return;
    this.uses.delete(serial);
    const bot = { id: u.botId, name: u.botName };
    this.core.event('phone.ended', { bot, serial, model: u.model, reason, ...extra });
    this.core.d.log({ kind: 'phone.ended', bot, serial, reason });
    this.changed();
  }

  /** A bot (or Sklubot's Stop, bot "sklubot") releases a phone. Sklubot's own release also forgets every yes for it. @param {Bot} bot @param {string|undefined} serial */
  release(bot, serial) {
    let n = 0;
    for (const u of [...this.uses.values()]) {
      if (serial && u.serial !== serial) continue;
      if (bot.id !== 'sklubot' && u.botId !== bot.id) continue;
      this.end(u.serial, bot.id === 'sklubot' ? 'stopped' : 'bot');
      n++;
    }
    if (bot.id === 'sklubot') for (const k of [...this.allowed]) if (!serial || k.endsWith(`\u0000${serial}`)) this.allowed.delete(k);
    return n;
  }

  /** Stop, pause or lost connection: every use ends, every adb command is aborted; Stop also forgets every yes. @param {string} reason @param {boolean} forget */
  stopAll(reason, forget) {
    for (const ac of this.running) ac.abort();
    this.running.clear();
    for (const serial of [...this.uses.keys()]) this.end(serial, reason);
    if (forget) this.allowed.clear();
  }

  schedule() {
    if (this.timer) return;
    this.timer = this.core.setTimer(() => {
      this.timer = null;
      const t = this.core.now();
      for (const u of [...this.uses.values()]) if (t - u.lastActivity >= USE_IDLE_MS) this.end(u.serial, 'idle');
      if (this.uses.size) this.schedule();
    }, 10_000);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }
}

module.exports = { PhoneUsb, deniedPackage, keptOut, HANDOVER_IDLE_MS, USE_IDLE_MS };
