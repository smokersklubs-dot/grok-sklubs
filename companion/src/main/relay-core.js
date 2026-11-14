// @ts-check
'use strict';
/**
 * Relay core: everything that happens once the device is authenticated.
 * Enforces, on the client, the rules the server cannot override:
 *  - a control session must be accepted locally (once / always for this bot / refuse);
 *  - every shell command is confirmed locally unless the user enabled commands for this bot;
 *  - Stop (button or hotkey) ends the session and locks the relay until the user re-allows;
 *  - consent prompts are rate limited; mouse/keyboard input is refused while a prompt is open.
 * Transport, UI, storage and OS capabilities are injected so this is testable in plain Node.
 */
const { OPS, ERR, LIMITS, ProtocolError, validateArgs, parseBot } = require('./protocol');
const { ConsentGate } = require('./consent');

const IDLE_SESSION_MS = 15 * 60_000;
const VIEW_ACK_TIMEOUT_MS = 15_000;
const VIEW_MAX_INFLIGHT = 2;
const VIEW_KEEPALIVE_MS = 5_000;

/**
 * @typedef {{ id: string, name: string }} Bot
 * @typedef {{ botId: string, botName: string, grant: 'once'|'always'|'test', startedAt: number, lastActivity: number }} Session
 * @typedef {{
 *   askSession(p: { promptId: string, bot: Bot, reason: string, timeoutMs: number }): Promise<'once'|'always'|'refuse'|'expired'>,
 *   askCommand(p: { promptId: string, bot: Bot, command: string, cwd: string|null, timeoutMs: number }): Promise<{ decision: 'run'|'refuse'|'expired', alwaysForBot?: boolean }>,
 *   cancelPrompt(promptId: string): void,
 *   onSession(session: Session|null): void,
 *   onLocked(locked: boolean): void,
 * }} ConsentUI
 * @typedef {{
 *   getBot(id: string): { name: string, control?: 'always', commands?: boolean } | undefined,
 *   setBotPerm(bot: Bot, key: 'control'|'commands', value: any): void,
 *   isLocked(): boolean,
 *   setLocked(v: boolean): void,
 * }} PermStore
 */

class TokenBucket {
  /** @param {number} capacity @param {number} perSecond @param {() => number} now */
  constructor(capacity, perSecond, now) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.now = now;
    this.tokens = capacity;
    this.last = now();
  }
  take() {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

class RelayCore {
  /**
   * @param {{
   *   send: (msg: object) => boolean,
   *   caps: Record<string, Function>,
   *   ui: ConsentUI,
   *   store: PermStore,
   *   log: (entry: Record<string, any>) => void,
   *   autoConfirm?: boolean,
   *   now?: () => number,
   *   gateOptions?: object,
   *   setTimer?: typeof setTimeout,
   *   clearTimer?: typeof clearTimeout,
   * }} deps
   */
  constructor(deps) {
    this.d = deps;
    this.now = deps.now || Date.now;
    this.setTimer = deps.setTimer || setTimeout;
    this.clearTimer = deps.clearTimer || clearTimeout;
    this.gate = new ConsentGate({ now: this.now, options: deps.gateOptions });
    this.bucket = new TokenBucket(60, 30, this.now);
    /** @type {Session|null} */
    this.session = null;
    /** @type {Map<string, AbortController>} running shell commands by request id */
    this.running = new Map();
    /** @type {null | { id: string, opts: any, seq: number, acked: number, lastAckAt: number, timer: any, lastHash: string, lastSentAt: number, busy: boolean }} */
    this.view = null;
    this.idleTimer = null;
    this.viewSeq = 0;
    this.sessionSeq = 0;
    /** @type {string|null} */
    this.pendingPromptId = null;
  }

  get locked() {
    return this.d.store.isLocked();
  }

  /** Public snapshot for the UI. */
  state() {
    return { session: this.session, locked: this.locked, prompt: this.gate.pending ? { ...this.gate.pending } : null, viewing: !!this.view };
  }

  // ───────────────────────── outbound helpers ─────────────────────────

  /** @param {string} id @param {any} result */
  ok(id, result = {}) {
    this.d.send({ type: 'res', id, ok: true, result });
  }

  /** @param {string} id @param {string} code @param {string} [message] @param {object} [extra] */
  fail(id, code, message = code, extra = {}) {
    this.d.send({ type: 'res', id, ok: false, error: { code, message, ...extra } });
  }

  /** @param {string} name @param {object} [data] */
  event(name, data = {}) {
    this.d.send({ type: 'event', name, ts: new Date(this.now()).toISOString(), ...data });
  }

  // ───────────────────────── inbound ─────────────────────────

  /**
   * Handle a `req` message from the server.
   * @param {any} msg
   */
  async handleRequest(msg) {
    const id = typeof msg.id === 'string' && msg.id.length > 0 && msg.id.length <= LIMITS.MAX_ID ? msg.id : null;
    if (!id) return; // cannot answer without a valid id
    if (!this.bucket.take()) return this.fail(id, ERR.RATE_LIMITED, 'too many requests');
    /** @type {Bot} */
    let bot;
    try {
      bot = parseBot(msg.bot);
    } catch (e) {
      return this.fail(id, ERR.INVALID_ARGS, /** @type {Error} */ (e).message);
    }
    const op = typeof msg.op === 'string' ? msg.op : '';
    const spec = Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[/** @type {keyof typeof OPS} */ (op)] : null;
    if (!spec) {
      this.d.log({ kind: 'refused', bot, op: op.slice(0, 40), why: ERR.UNKNOWN_OP });
      return this.fail(id, ERR.UNKNOWN_OP, 'unknown operation');
    }
    /** @type {Record<string, any>} */
    let args;
    try {
      args = validateArgs(op, msg.args);
    } catch (e) {
      const pe = /** @type {ProtocolError} */ (e);
      return this.fail(id, pe.code || ERR.INVALID_ARGS, pe.message);
    }

    if (this.locked && op !== 'session.end' && op !== 'view.stop') {
      this.d.log({ kind: 'refused', bot, op, why: ERR.LOCKED });
      return this.fail(id, ERR.LOCKED, 'the user stopped remote control on this computer');
    }
    if (spec.input && this.gate.pending) {
      this.d.log({ kind: 'refused', bot, op, why: ERR.CONSENT_PENDING });
      return this.fail(id, ERR.CONSENT_PENDING, 'input is paused while a consent dialog is open');
    }
    if (spec.session) {
      if (!this.session) return this.fail(id, ERR.NO_SESSION, 'start a control session first');
      if (this.session.botId !== bot.id) return this.fail(id, ERR.BUSY, 'another bot has the control session');
      this.touch();
    }

    this.d.log({ kind: 'request', bot, op, args: summarize(op, args) });
    try {
      switch (op) {
        case 'session.start': return await this.startSession(id, bot, args.reason);
        case 'session.end':
          if (this.session && this.session.botId === bot.id) this.endSession('bot');
          return this.ok(id, {});
        case 'shell.run': return await this.runShell(id, bot, args);
        case 'view.start': return this.ok(id, this.startView(/** @type {any} */ (args)));
        case 'view.stop':
          if (this.view && (!args.viewId || args.viewId === this.view.id)) this.stopView('requested');
          return this.ok(id, {});
        case 'screen.capture': {
          const r = await this.d.caps.capture(args);
          return this.ok(id, { ...r, data: r.data.toString('base64') });
        }
        default: {
          const fn = CAP_FOR_OP[op];
          const result = await this.d.caps[fn](args);
          return this.ok(id, result || {});
        }
      }
    } catch (e) {
      const err = /** @type {any} */ (e);
      this.d.log({ kind: 'error', bot, op, error: String(err && err.message || err) });
      return this.fail(id, err && err.code && typeof err.code === 'string' && Object.values(ERR).includes(err.code) ? err.code : ERR.INTERNAL, String(err && err.message || err).slice(0, 500));
    }
  }

  /** Server cancelled a running request (only shell commands are cancellable). @param {any} msg */
  handleCancel(msg) {
    const ac = typeof msg.id === 'string' ? this.running.get(msg.id) : undefined;
    if (ac) ac.abort();
  }

  /** @param {any} msg */
  handleViewAck(msg) {
    if (!this.view || msg.viewId !== this.view.id || typeof msg.seq !== 'number') return;
    this.view.acked = Math.max(this.view.acked, msg.seq);
    this.view.lastAckAt = this.now();
  }

  // ───────────────────────── sessions ─────────────────────────

  /** @param {string} id @param {Bot} bot @param {string} reason */
  async startSession(id, bot, reason) {
    if (this.session) {
      if (this.session.botId === bot.id) return this.ok(id, { sessionId: this.sessionIdValue, grant: this.session.grant, already: true });
      return this.fail(id, ERR.BUSY, 'another bot has the control session');
    }
    const perm = this.d.store.getBot(bot.id);
    /** @type {'once'|'always'|'test'} */
    let grant;
    if (perm && perm.control === 'always') {
      grant = 'always';
    } else if (this.d.autoConfirm) {
      grant = 'test';
    } else {
      const decision = await this.prompt(bot, 'session', (promptId, timeoutMs) => this.d.ui.askSession({ promptId, bot, reason, timeoutMs }));
      if (typeof decision === 'object') return this.fail(id, decision.code, decision.message, decision.extra);
      if (decision === 'refuse') return this.fail(id, ERR.CONSENT_REFUSED, 'the user refused the control session');
      if (decision === 'expired') return this.fail(id, ERR.CONSENT_EXPIRED, 'nobody answered on the computer');
      if (decision === 'always') this.d.store.setBotPerm(bot, 'control', 'always');
      grant = decision === 'always' ? 'always' : 'once';
    }
    // The user may have pressed Stop, or another bot may have won, while the dialog was open.
    if (this.locked) return this.fail(id, ERR.LOCKED, 'the user stopped remote control on this computer');
    if (this.session) return this.fail(id, ERR.BUSY, 'another bot has the control session');
    const t = this.now();
    this.session = { botId: bot.id, botName: bot.name, grant, startedAt: t, lastActivity: t };
    this.sessionIdValue = `s${t.toString(36)}${++this.sessionSeq}`;
    this.touch();
    this.d.ui.onSession(this.session);
    this.d.log({ kind: 'session.started', bot, grant });
    this.event('session.started', { bot, grant, sessionId: this.sessionIdValue });
    return this.ok(id, { sessionId: this.sessionIdValue, grant });
  }

  /**
   * Show a consent prompt through the gate. Returns the decision, or an error object if no prompt may be shown.
   * @template T
   * @param {Bot} bot @param {string} kind
   * @param {(promptId: string, timeoutMs: number) => Promise<T>} ask
   * @returns {Promise<T | { code: string, message: string, extra?: object }>}
   */
  async prompt(bot, kind, ask) {
    const blocked = this.gate.check(bot.id);
    if (blocked) {
      this.d.log({ kind: 'prompt.blocked', bot, prompt: kind, why: blocked });
      const extra = blocked === ERR.CONSENT_COOLDOWN ? { retryAfterMs: this.gate.cooldownLeft(bot.id) } : {};
      return { code: blocked, message: 'a consent dialog cannot be shown right now', extra };
    }
    const p = this.gate.open(bot.id, kind);
    this.pendingPromptId = p.id;
    this.event('consent.requested', { bot, kind });
    const timeoutMs = this.gate.promptTimeoutMs;
    /** @type {any} */
    let decision;
    let timer;
    try {
      decision = await Promise.race([
        ask(p.id, timeoutMs),
        new Promise((resolve) => { timer = this.setTimer(() => resolve('expired'), timeoutMs); }),
      ]);
    } finally {
      this.clearTimer(timer);
    }
    const value = typeof decision === 'object' && decision ? decision.decision : decision;
    if (value === 'expired') this.d.ui.cancelPrompt(p.id);
    const refused = value === 'refuse' || value === 'expired';
    this.gate.close(refused);
    this.pendingPromptId = null;
    this.d.log({ kind: 'consent', bot, prompt: kind, decision: value });
    this.event('consent.decided', { bot, kind, decision: value });
    return decision;
  }

  touch() {
    if (!this.session) return;
    this.session.lastActivity = this.now();
    if (this.idleTimer) this.clearTimer(this.idleTimer);
    this.idleTimer = unref(this.setTimer(() => this.endSession('idle'), IDLE_SESSION_MS));
  }

  /** @param {string} reason */
  endSession(reason) {
    this.stopView('session_ended');
    for (const ac of this.running.values()) ac.abort();
    this.running.clear();
    if (this.idleTimer) this.clearTimer(this.idleTimer);
    this.idleTimer = null;
    if (!this.session) return;
    const s = this.session;
    this.session = null;
    this.d.ui.onSession(null);
    this.d.log({ kind: 'session.ended', bot: { id: s.botId, name: s.botName }, reason });
    this.event('session.ended', { bot: { id: s.botId, name: s.botName }, reason, sessionId: this.sessionIdValue });
  }

  /**
   * User pressed Stop (banner, tray or global hotkey). Ends everything and locks.
   * @param {'user'|'hotkey'|'tray'} source
   */
  stop(source) {
    if (this.pendingPromptId) this.d.ui.cancelPrompt(this.pendingPromptId);
    this.endSession(source === 'hotkey' ? 'hotkey' : 'user_stop');
    if (!this.locked) {
      this.d.store.setLocked(true);
      this.d.ui.onLocked(true);
      this.d.log({ kind: 'locked', source });
      this.event('relay.locked', { source });
    }
  }

  /** Only callable from the local UI. */
  unlock() {
    if (!this.locked) return;
    this.d.store.setLocked(false);
    this.d.ui.onLocked(false);
    this.d.log({ kind: 'unlocked' });
    this.event('relay.unlocked', {});
  }

  /** Connection lost or paused: nothing may continue running unattended. */
  /** @param {string} [reason] */
  onDisconnected(reason = 'disconnected') {
    if (this.pendingPromptId) this.d.ui.cancelPrompt(this.pendingPromptId);
    this.endSession(reason);
  }

  // ───────────────────────── shell ─────────────────────────

  /** @param {string} id @param {Bot} bot @param {Record<string, any>} args */
  async runShell(id, bot, args) {
    const perm = this.d.store.getBot(bot.id);
    if (!(perm && perm.commands === true) && !this.d.autoConfirm) {
      const answer = await this.prompt(bot, 'command', (promptId, timeoutMs) => this.d.ui.askCommand({ promptId, bot, command: args.command, cwd: args.cwd, timeoutMs }));
      if (answer && typeof answer === 'object' && 'code' in answer) return this.fail(id, answer.code, answer.message, answer.extra);
      const a = /** @type {{ decision: string, alwaysForBot?: boolean }} */ (answer);
      if (a.decision !== 'run') return this.fail(id, a.decision === 'expired' ? ERR.CONSENT_EXPIRED : ERR.COMMAND_REFUSED, 'the user did not allow this command');
      if (a.alwaysForBot === true) this.d.store.setBotPerm(bot, 'commands', true);
      if (this.locked) return this.fail(id, ERR.LOCKED, 'the user stopped remote control on this computer');
      if (!this.session || this.session.botId !== bot.id) return this.fail(id, ERR.NO_SESSION, 'the control session ended');
    }
    const ac = new AbortController();
    this.running.set(id, ac);
    try {
      const r = await this.d.caps.runShell({ ...args, signal: ac.signal });
      this.d.log({ kind: 'shell.done', bot, command: args.command.slice(0, 500), exitCode: r.exitCode, timedOut: r.timedOut, cancelled: r.cancelled });
      return this.ok(id, r);
    } finally {
      this.running.delete(id);
    }
  }

  // ───────────────────────── live view ─────────────────────────

  /** @param {{ maxFps: number, maxWidth: number, quality: number }} opts */
  startView(opts) {
    this.stopView('replaced');
    const id = `v${++this.viewSeq}`;
    const t = this.now();
    this.view = { id, opts, seq: 0, acked: 0, lastAckAt: t, timer: null, lastHash: '', lastSentAt: 0, busy: false };
    this.scheduleFrame(0);
    this.d.log({ kind: 'view.started', viewId: id, maxFps: opts.maxFps });
    return { viewId: id, maxFps: opts.maxFps };
  }

  /** @param {string} reason */
  stopView(reason) {
    if (!this.view) return;
    const v = this.view;
    this.view = null;
    if (v.timer) this.clearTimer(v.timer);
    this.d.log({ kind: 'view.stopped', viewId: v.id, reason });
    this.event('view.stopped', { viewId: v.id, reason });
  }

  /** @param {number} delay */
  scheduleFrame(delay) {
    if (!this.view) return;
    const v = this.view;
    v.timer = this.setTimer(() => { this.frameTick(v).catch(() => this.stopView('capture_error')); }, delay);
  }

  /** @param {NonNullable<RelayCore['view']>} v */
  async frameTick(v) {
    if (this.view !== v || !this.session || this.locked) return;
    const minInterval = 1000 / v.opts.maxFps;
    if (this.now() - v.lastAckAt > VIEW_ACK_TIMEOUT_MS) return this.stopView('no_ack');
    // Credit-based flow control: at most VIEW_MAX_INFLIGHT unacknowledged frames.
    if (v.seq - v.acked >= VIEW_MAX_INFLIGHT) return this.scheduleFrame(minInterval / 2);
    const started = this.now();
    const frame = await this.d.caps.captureFrame({ maxWidth: v.opts.maxWidth, quality: v.opts.quality });
    if (this.view !== v || !this.session) return;
    const elapsed = this.now() - started;
    const unchanged = frame.hash === v.lastHash && this.now() - v.lastSentAt < VIEW_KEEPALIVE_MS;
    if (!unchanged) {
      v.seq += 1;
      v.lastHash = frame.hash;
      v.lastSentAt = this.now();
      this.d.send({ type: 'frame', viewId: v.id, seq: v.seq, format: 'jpeg', width: frame.width, height: frame.height, data: frame.data.toString('base64') });
    }
    // Adaptive rate: never faster than maxFps, and slow down if capturing is slow.
    this.scheduleFrame(Math.max(minInterval - elapsed, elapsed * 0.5, 50));
  }
}

/** Do not keep the process alive just for a timer. @param {any} t */
function unref(t) { if (t && typeof t.unref === 'function') t.unref(); return t; }

const CAP_FOR_OP = /** @type {Record<string, string>} */ ({
  'screen.info': 'screenInfo',
  'mouse.move': 'mouseMove',
  'mouse.click': 'mouseClick',
  'mouse.drag': 'mouseDrag',
  'mouse.scroll': 'mouseScroll',
  'keyboard.type': 'keyType',
  'keyboard.press': 'keyPress',
  'url.open': 'openUrl',
  'app.open': 'openApp',
  'window.list': 'listWindows',
  'window.focus': 'focusWindow',
  'fs.roots': 'fsRoots',
  'fs.list': 'fsList',
  'fs.read': 'fsRead',
  'fs.write': 'fsWrite',
  'fs.trash': 'fsTrash',
});

/** What goes into the local action log (never image data). @param {string} op @param {Record<string, any>} args */
function summarize(op, args) {
  if (op === 'keyboard.type') return { text: args.text.length > 200 ? args.text.slice(0, 200) + '…' : args.text, length: args.text.length };
  if (op === 'shell.run') return { command: args.command.slice(0, 1000), timeoutMs: args.timeoutMs, cwd: args.cwd };
  // A file written by a bot: where and how much, never its content.
  if (op === 'fs.write') return { root: args.root, path: args.path, mode: args.mode, bytes: Buffer.byteLength(args.text, 'utf8') };
  return args;
}

module.exports = { RelayCore, TokenBucket, IDLE_SESSION_MS };
