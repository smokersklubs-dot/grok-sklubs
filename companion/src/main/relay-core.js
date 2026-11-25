// @ts-check
'use strict';
/**
 * Relay core: everything that happens once the device is authenticated.
 * Enforces, on the client, the rules the server cannot override:
 *  - a control session must be accepted locally (once / always for this bot / all bots of this account / refuse);
 *  - one bot drives at a time; another bot of the account takes over only when the holder has been idle for
 *    HANDOVER_IDLE_MS and the newcomer is allowed (protocol 1.7, docs/RELAIS-PROTOCOLE.md §7);
 *  - every shell command is confirmed locally unless the user enabled commands for this bot;
 *  - Stop (button or hotkey) ends the session and locks the relay until the user re-allows;
 *  - consent prompts are rate limited; mouse/keyboard input is refused while a prompt is open;
 *  - the safety rules of guard.js (backlog L19 / L32): refused apps, the owner's keep-out list, password fields, the
 *    window in front re-read right before each click or key, dangerous shortcuts, scripts shown and pinned by hash,
 *    and every held key or button released when a session ends.
 * Transport, UI, storage and OS capabilities are injected so this is testable in plain Node.
 */
const { OPS, ERR, LIMITS, ProtocolError, validateArgs, parseBot } = require('./protocol');
const { ConsentGate } = require('./consent');
const G = require('./guard');
const AX = require('./capabilities/accessibility');

const IDLE_SESSION_MS = 15 * 60_000;
/**
 * Hand-over (1.7): a bot asking for control while another one holds it gets it only when the holder made no request
 * for this long and runs no command. 20 s: longer than the gap between two clicks of a working bot, short enough for
 * the owner's next bot not to wait long. Before that, the newcomer is told `busy` with `retryAfterMs`.
 */
const HANDOVER_IDLE_MS = 20_000;
const VIEW_ACK_TIMEOUT_MS = 15_000;
const VIEW_MAX_INFLIGHT = 2;
const VIEW_KEEPALIVE_MS = 5_000;

/**
 * @typedef {{ id: string, name: string }} Bot
 * @typedef {{ botId: string, botName: string, grant: 'once'|'always'|'account'|'test', startedAt: number, lastActivity: number }} Session
 * @typedef {{
 *   askSession(p: { promptId: string, bot: Bot, reason: string, timeoutMs: number, holder?: Bot }): Promise<'once'|'always'|'all'|'refuse'|'expired'>,
 *   askCommand(p: { promptId: string, bot: Bot, command: string, cwd: string|null, timeoutMs: number, floor?: string, scripts?: { path: string, sha256: string, lines: string[], more: number, binary: boolean }[] }): Promise<{ decision: 'run'|'refuse'|'expired', alwaysForBot?: boolean }>,
 *   askGuard?(p: { promptId: string, bot: Bot, kind: 'terminal'|'shortcut'|'gpu'|'net', detail: string, timeoutMs: number }): Promise<'allow'|'refuse'|'expired'>,
 *   cancelPrompt(promptId: string): void,
 *   onSession(session: Session|null): void,
 *   onLocked(locked: boolean): void,
 * }} ConsentUI
 * @typedef {{
 *   getBot(id: string): { name: string, control?: 'always', commands?: boolean } | undefined,
 *   setBotPerm(bot: Bot, key: 'control'|'commands', value: any): void,
 *   isLocked(): boolean,
 *   setLocked(v: boolean): void,
 *   getAllBots?(): boolean,
 *   setAllBots?(v: boolean): void,
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
   *   platform?: string,
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
    this.platform = deps.platform || process.platform;
    /** The owner's rules sent by Sklubot (guard.set): until then, no keep-out entries and terminals off. */
    this.owner = G.parseOwnerGuard({});
    /** Apps the bot opened itself in this session (normalized names): it may close those. */
    this.opened = new Set();
    /** The user allowed commands on this computer for this control session (asked with the first one). */
    this.commandsOk = false;
    /** Commands running in the background (dev servers…), by job id: stopped when the session ends. */
    /** @type {Map<string, { ac: AbortController, botId: string, command: string, out: string, err: string, truncated: boolean, done: boolean, exitCode: number|null, startedAt: number, endedAt: number }>} */
    this.jobs = new Map();
    this.jobSeq = 0;
    /** Accessibility snapshots of this session (L164): references stay valid for the last 3 reads. */
    this.ax = new AX.SnapshotStore();
    /** Bots the owner allowed to use Wan2GP on this computer (gpu.http), as "botId:port": cleared by Stop. */
    this.gpuOk = new Set();
    /** Bots the owner allowed to go out through this computer's connection (net.fetch, 1.8): cleared by Stop. */
    this.netOk = new Set();
    /** net.fetch has its own, slower rate: 20 at once, then 2 a second. */
    this.netBucket = new TokenBucket(20, 2, this.now);
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
      const refused = await this.guardCheck(bot, op, args);
      if (refused) {
        this.d.log({ kind: 'refused', bot, op, why: refused.code, detail: refused.message });
        return this.fail(id, refused.code, refused.message);
      }
      switch (op) {
        case 'session.start': return await this.startSession(id, bot, args.reason);
        case 'session.end':
          if (this.session && this.session.botId === bot.id) this.endSession('bot');
          return this.ok(id, {});
        case 'shell.run': return await this.runShell(id, bot, args);
        case 'shell.start': return await this.runShell(id, bot, args, true);
        case 'shell.read': {
          const j = this.jobs.get(args.jobId);
          if (!j || j.botId !== bot.id) return this.fail(id, ERR.NOT_FOUND, 'no such background command');
          return this.ok(id, { running: !j.done, exitCode: j.exitCode, stdout: j.out, stderr: j.err, truncated: j.truncated, durationMs: (j.done ? j.endedAt : this.now()) - j.startedAt, command: j.command.slice(0, 300) });
        }
        case 'shell.stop': {
          const j = this.jobs.get(args.jobId);
          if (!j || j.botId !== bot.id) return this.fail(id, ERR.NOT_FOUND, 'no such background command');
          j.ac.abort();
          return this.ok(id, { stopped: true });
        }
        case 'vault.type': return await this.vaultType(id, args);
        case 'ax.tree': return await this.axTree(id, bot, args);
        case 'ax.act': return await this.axAct(id, bot, args);
        case 'view.start': return this.ok(id, this.startView(/** @type {any} */ (args)));
        case 'view.stop':
          if (this.view && (!args.viewId || args.viewId === this.view.id)) this.stopView('requested');
          return this.ok(id, {});
        case 'screen.capture': {
          const r = await this.d.caps.capture(args);
          return this.ok(id, { ...r, data: r.data.toString('base64') });
        }
        case 'guard.set':
          this.owner = G.parseOwnerGuard(args);
          if (!this.owner.terminal) this.commandsOk = false;
          return this.ok(id, { keepApps: this.owner.keepApps.length, keepFolders: this.owner.keepFolders.length, terminal: this.owner.terminal });
        case 'window.active':
          return this.ok(id, { active: typeof this.d.caps.activeWindow === 'function' ? (await this.d.caps.activeWindow()) || null : null });
        case 'script.peek': {
          const p = G.peekScript({ path: args.path, cwd: args.cwd, keepFolders: this.owner.keepFolders });
          return this.ok(id, { sha256: p.sha256, size: p.size, lines: p.lines, more: p.more, binary: p.binary });
        }
        case 'gpu.http': return await this.gpuHttp(id, bot, args);
        case 'net.fetch': return await this.netFetch(id, bot, args);
        case 'app.open': {
          const result = await this.d.caps.openApp(args);
          this.opened.add(G.normApp(args.name));
          return this.ok(id, result || {});
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
    /** @type {Bot|undefined} the idle bot this one takes over from (1.7) */
    let holder;
    if (this.session) {
      if (this.session.botId === bot.id) return this.ok(id, { sessionId: this.sessionIdValue, grant: this.session.grant, already: true });
      const busy = this.busyFor();
      if (busy > 0) return this.failBusy(id, busy);
      holder = { id: this.session.botId, name: this.session.botName };
    }
    const perm = this.d.store.getBot(bot.id);
    /** @type {'once'|'always'|'account'|'test'} */
    let grant;
    let asked = false;
    if (perm && perm.control === 'always') {
      grant = 'always';
    } else if (this.d.store.getAllBots && this.d.store.getAllBots()) {
      grant = 'account';
    } else if (this.d.autoConfirm) {
      grant = 'test';
    } else {
      asked = true;
      const decision = await this.prompt(bot, 'session', (promptId, timeoutMs) => this.d.ui.askSession({ promptId, bot, reason, timeoutMs, ...(holder ? { holder } : {}) }));
      if (typeof decision === 'object') return this.fail(id, decision.code, decision.message, decision.extra);
      if (decision === 'refuse') return this.fail(id, ERR.CONSENT_REFUSED, 'the user refused the control session');
      if (decision === 'expired') return this.fail(id, ERR.CONSENT_EXPIRED, 'nobody answered on the computer');
      if (decision === 'always') this.d.store.setBotPerm(bot, 'control', 'always');
      if (decision === 'all' && this.d.store.setAllBots) this.d.store.setAllBots(true);
      grant = decision === 'always' ? 'always' : decision === 'all' ? 'account' : 'once';
    }
    // The user may have pressed Stop, or another bot may have won, while the dialog was open.
    if (this.locked) return this.fail(id, ERR.LOCKED, 'the user stopped remote control on this computer');
    if (this.session && this.session.botId === bot.id) return this.ok(id, { sessionId: this.sessionIdValue, grant: this.session.grant, already: true });
    if (this.session) {
      // Only the idle bot seen above can be replaced: after the owner's yes on this screen, or silently while it is
      // still idle; never a bot that won the computer while the question was open.
      const busy = this.busyFor();
      if (!holder || this.session.botId !== holder.id || (!asked && busy > 0)) return this.failBusy(id, Math.max(busy, 1));
      this.endSession('handover', { to: bot });
    }
    const t = this.now();
    this.session = { botId: bot.id, botName: bot.name, grant, startedAt: t, lastActivity: t };
    this.sessionIdValue = `s${t.toString(36)}${++this.sessionSeq}`;
    this.touch();
    this.d.ui.onSession(this.session);
    this.d.log({ kind: 'session.started', bot, grant, ...(holder ? { from: holder } : {}) });
    this.event('session.started', { bot, grant, sessionId: this.sessionIdValue, ...(holder ? { from: holder } : {}) });
    return this.ok(id, { sessionId: this.sessionIdValue, grant, ...(holder ? { from: holder } : {}) });
  }

  /**
   * How long the bot holding the session still counts as working (ms): 0 when it may be replaced. A running command
   * (in front or in the background) or an open question keeps it busy whatever the time.
   */
  busyFor() {
    if (!this.session) return 0;
    const jobs = [...this.jobs.values()].some((j) => !j.done);
    if (this.running.size || jobs || this.gate.pending) return HANDOVER_IDLE_MS;
    return Math.max(0, HANDOVER_IDLE_MS - (this.now() - this.session.lastActivity));
  }

  /** `busy`, saying who drives and when to ask again (1.7; older servers read the code only). @param {string} id @param {number} waitMs */
  failBusy(id, waitMs) {
    const s = /** @type {Session} */ (this.session);
    return this.fail(id, ERR.BUSY, 'another bot has the control session', { holder: { id: s.botId, name: s.botName }, retryAfterMs: Math.max(1000, Math.ceil(waitMs)) });
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

  /** @param {string} reason @param {{ to?: Bot }} [extra] who takes over, for a hand-over */
  endSession(reason, extra = {}) {
    this.stopView('session_ended');
    for (const ac of this.running.values()) ac.abort();
    this.running.clear();
    if (this.idleTimer) this.clearTimer(this.idleTimer);
    this.idleTimer = null;
    this.releaseInput();
    this.opened.clear();
    this.ax.clear();
    this.commandsOk = false;
    for (const j of this.jobs.values()) j.ac.abort();
    this.jobs.clear();
    if (!this.session) return;
    const s = this.session;
    this.session = null;
    this.d.ui.onSession(null);
    this.d.log({ kind: 'session.ended', bot: { id: s.botId, name: s.botName }, reason, ...extra });
    this.event('session.ended', { bot: { id: s.botId, name: s.botName }, reason, sessionId: this.sessionIdValue, ...extra });
  }

  /**
   * User pressed Stop (banner, tray or global hotkey). Ends everything and locks.
   * @param {'user'|'hotkey'|'tray'} source
   */
  stop(source) {
    if (this.pendingPromptId) this.d.ui.cancelPrompt(this.pendingPromptId);
    this.gpuOk.clear();
    this.netOk.clear();
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

  /**
   * A shell command (or one started in the background with `background`). On by default; off when the owner turned
   * commands off in Sklubot. It runs in the command's folder, else the owner's first project folder, never in a
   * keep-out folder. The first command of a control session is asked here (that yes lasts for the session); a command
   * on the floor (guard.js commandFloor: deletions, admin rights, installs, disks, downloads into a shell, listeners,
   * startup files, writing outside the folder) and a command that launches a script (L32: first 40 lines + SHA-256,
   * refused if it changes before the click or differs from Sklubot's card) are asked every time.
   * @param {string} id @param {Bot} bot @param {Record<string, any>} args @param {boolean} [background]
   */
  async runShell(id, bot, args, background = false) {
    if (!this.owner.terminal) return this.fail(id, ERR.TERMINAL_OFF, 'commands are off on this computer (the owner turned them off in Sklubot)');
    const cwd = args.cwd || this.owner.projectFolders?.[0] || null;
    if (cwd && (G.inKeepOutFolder(cwd, this.owner.keepFolders) || G.keepOutHit({ title: `${args.command} ${cwd}` }, { keepApps: [], keepFolders: this.owner.keepFolders, terminal: true }))) return this.fail(id, ERR.KEEP_OUT, 'the owner keeps this folder out of reach');
    if (!cwd && G.keepOutHit({ title: args.command }, { keepApps: [], keepFolders: this.owner.keepFolders, terminal: true })) return this.fail(id, ERR.KEEP_OUT, 'the owner keeps this folder out of reach');
    const found = G.findScripts(args.command, this.platform);
    if (found.problem) return this.fail(id, ERR.SCRIPT_UNREADABLE, found.problem.kind === 'dynamic' ? `a script path only the shell could resolve (${found.problem.word.slice(0, 80)}): give a plain path` : 'more than 3 scripts in one command');
    const peekArgs = (/** @type {string} */ p) => ({ path: p, cwd, keepFolders: this.owner.keepFolders });
    /** @type {Map<string, ReturnType<typeof G.peekScript>>} */
    const peeks = new Map();
    for (const p of found.scripts) {
      try { peeks.set(p, G.peekScript(peekArgs(p))); } catch (e) {
        const err = /** @type {any} */ (e);
        if (found.optional.includes(p) && err.code === 'not_found') continue;
        return this.fail(id, ERR.SCRIPT_UNREADABLE, `${p.slice(0, 200)}: ${String(err.message).slice(0, 200)}`);
      }
    }
    for (const exp of args.scripts || []) {
      const pk = peeks.get(exp.path);
      if (!pk || pk.sha256 !== exp.sha256) return this.fail(id, ERR.SCRIPT_CHANGED, `${String(exp.path).slice(0, 200)} is not the script shown on the card`);
    }
    const floor = G.commandFloor(args.command, cwd || '', this.owner.projectFolders || []);
    if ((peeks.size || floor || !this.commandsOk) && !this.d.autoConfirm) {
      const scripts = [...peeks.values()].map((p) => ({ path: p.path, sha256: p.sha256, lines: p.lines, more: p.more, binary: p.binary }));
      const answer = await this.prompt(bot, 'command', (promptId, timeoutMs) => this.d.ui.askCommand({ promptId, bot, command: args.command, cwd, timeoutMs, ...(scripts.length ? { scripts } : {}), ...(floor ? { floor: floor.kind } : {}) }));
      if (answer && typeof answer === 'object' && 'code' in answer) return this.fail(id, answer.code, answer.message, answer.extra);
      const a = /** @type {{ decision: string }} */ (answer);
      if (a.decision !== 'run') return this.fail(id, a.decision === 'expired' ? ERR.CONSENT_EXPIRED : ERR.COMMAND_REFUSED, 'the user did not allow this command');
      // An ordinary command: the yes covers the other ordinary commands of this session.
      if (!peeks.size && !floor) this.commandsOk = true;
      if (this.locked) return this.fail(id, ERR.LOCKED, 'the user stopped remote control on this computer');
      if (!this.session || this.session.botId !== bot.id) return this.fail(id, ERR.NO_SESSION, 'the control session ended');
    }
    // Right before it runs: each script must still be exactly what was shown.
    for (const [p, pk] of peeks) {
      if (G.scriptHash(peekArgs(p)) !== pk.sha256) return this.fail(id, ERR.SCRIPT_CHANGED, `${p.slice(0, 200)} changed after it was shown: nothing was run`);
    }
    const ac = new AbortController();
    const { scripts: _s, streamRef, ...shellArgs } = args;
    const stream = this.outputStream(streamRef);
    if (background) {
      const running = [...this.jobs.values()].filter((j) => !j.done).length;
      if (running >= MAX_JOBS) return this.fail(id, ERR.RATE_LIMITED, `${MAX_JOBS} background commands at most: stop one first`);
      const jobId = `j${++this.jobSeq}`;
      const job = { ac, botId: bot.id, command: args.command, out: '', err: '', truncated: false, done: false, exitCode: /** @type {number|null} */ (null), startedAt: this.now(), endedAt: 0 };
      this.jobs.set(jobId, job);
      const keep = (/** @type {string} */ buf, /** @type {string} */ add) => { const all = buf + add; if (all.length > JOB_KEEP) { job.truncated = true; return all.slice(-JOB_KEEP); } return all; };
      void Promise.resolve(this.d.caps.runShell({ ...shellArgs, cwd, timeoutMs: args.timeoutMs, signal: ac.signal, onChunk: (/** @type {string} */ st, /** @type {string} */ text) => { if (st === 'stderr') job.err = keep(job.err, text); else job.out = keep(job.out, text); stream(st, text); } }))
        .then((r) => { job.exitCode = r.exitCode; job.done = true; job.endedAt = this.now(); stream.flush(); this.d.log({ kind: 'shell.done', bot, command: args.command.slice(0, 500), exitCode: r.exitCode, background: true }); })
        .catch(() => { job.done = true; job.endedAt = this.now(); });
      return this.ok(id, { jobId, cwd });
    }
    this.running.set(id, ac);
    try {
      const r = await this.d.caps.runShell({ ...shellArgs, cwd, signal: ac.signal, onChunk: stream });
      stream.flush();
      this.d.log({ kind: 'shell.done', bot, command: args.command.slice(0, 500), exitCode: r.exitCode, timedOut: r.timedOut, cancelled: r.cancelled });
      return this.ok(id, { ...r, cwd });
    } finally {
      this.running.delete(id);
    }
  }

  /**
   * Output sent to Sklubot as it comes (`shell.output` events, grouped every 400 ms, 64 KiB per command at most), so
   * the owner sees it in the chat while the command runs.
   * @param {string|null} ref
   */
  outputStream(ref) {
    /** @type {{ stdout: string, stderr: string }} */
    let pending = { stdout: '', stderr: '' };
    let sent = 0;
    let timer = null;
    const flush = () => {
      if (timer) { this.clearTimer(timer); timer = null; }
      for (const st of /** @type {const} */ (['stdout', 'stderr'])) {
        if (!pending[st] || !ref) continue;
        const room = STREAM_MAX - sent;
        if (room <= 0) break;
        const text = pending[st].slice(0, room);
        sent += text.length;
        this.event('shell.output', { ref, stream: st, text });
      }
      pending = { stdout: '', stderr: '' };
    };
    const fn = /** @type {((st: string, text: string) => void) & { flush: () => void }} */ ((st, text) => {
      if (!ref || sent >= STREAM_MAX) return;
      pending[st === 'stderr' ? 'stderr' : 'stdout'] += text;
      if (!timer) timer = unref(this.setTimer(flush, 400));
    });
    fn.flush = flush;
    return fn;
  }

  /**
   * Vault fill: a saved login or one-time code that Sklubot sends ONLY here. Checked again right before typing: the
   * same window as Sklubot saw, a browser on a page of the item's site (or the app the item names), a password only
   * into a password field. Never written to the action log; the text is dropped after typing.
   * @param {string} id @param {Record<string, any>} args
   */
  async vaultType(id, args) {
    try {
      if (typeof this.d.caps.activeWindow !== 'function') return this.fail(id, ERR.FOREGROUND_UNKNOWN, 'cannot tell which window is in front');
      const a = await this.d.caps.activeWindow();
      if (!a || !a.app) return this.fail(id, ERR.FOREGROUND_UNKNOWN, 'cannot tell which window is in front: nothing was typed');
      if (!G.sameWindow(args.expect, a)) return this.fail(id, ERR.WINDOW_CHANGED, 'another window came to the front: nothing was typed');
      if (G.keepOutHit(a, this.owner)) return this.fail(id, ERR.KEEP_OUT, 'the owner keeps this window out of reach');
      const no = G.vaultVerdict(a, { site: args.site, field: args.field });
      if (no) return this.fail(id, no, `${no}: nothing was typed`);
      await this.d.caps.keyType({ text: args.text });
      return this.ok(id, { typed: true, field: args.field });
    } finally {
      args.text = '';
    }
  }

  // ───────────────────────── accessibility tree (L164) ─────────────────────────

  /** The app a snapshot is about, as guard.js reads a window. @param {{ app?: string, bundle?: string, pid?: number|null, windows?: string[] }} t */
  axTarget(t) { return { app: t.app || '', bundle: t.bundle || '', pid: t.pid ?? null, title: (t.windows || []).join(' — ') }; }

  /** Refusal for an app the bot must not read or touch (refused apps, the owner's keep-out list), else null. @param {any} target */
  axRefusal(target) {
    const group = G.deniedGroup(target) || G.deniedName(String(target.title || ''));
    if (group) return { code: ERR.BLOCKED_APP, message: `${group}: refused on this computer` };
    if (G.keepOutHit(target, this.owner)) return { code: ERR.KEEP_OUT, message: 'the owner keeps this app out of reach' };
    return null;
  }

  /** Reads an app's controls (the app named, or the one in front). Nothing of a refused app is kept or sent. @param {string} id @param {Bot} bot @param {Record<string, any>} args */
  async axTree(id, bot, args) {
    if (typeof this.d.caps.axRead !== 'function') return this.fail(id, ERR.UNSUPPORTED, 'the accessibility tree is offered on macOS and Windows only');
    if (args.app) { const pre = this.axRefusal({ app: args.app, title: args.app }); if (pre) return this.fail(id, pre.code, pre.message); }
    const raw = await this.d.caps.axRead({ app: args.app });
    const names = (raw && Array.isArray(raw.windows) ? raw.windows : []).map((/** @type {any} */ w) => String(w && (w.n || w.t) || ''));
    const no = this.axRefusal(this.axTarget({ app: raw && raw.app, bundle: raw && raw.bundle, pid: raw && raw.pid, windows: names }));
    if (no) { this.d.log({ kind: 'refused', bot, op: 'ax.tree', why: no.code }); return this.fail(id, no.code, no.message); }
    const snap = AX.buildSnapshot(raw, { platform: this.platform, snapshotId: this.ax.nextId(), interactiveOnly: args.interactiveOnly });
    AX.rememberNative(snap, raw);
    this.ax.add(snap);
    return this.ok(id, { snapshotId: snap.snapshotId, app: snap.app, complete: snap.complete, dialogs: snap.dialogs.map((d) => ({ role: d.role, name: d.name })), elements: snap.elements.map(({ path, ...e }) => e), text: AX.renderSnapshot(snap) });
  }

  /**
   * Acts on one control by reference. The relay's rules, whatever the server asks: the app must not be refused or kept
   * out; a password field is never filled (only focused: the user types it); without `background`, the app must still
   * be the one in front, re-read right now; the script checks the control is still the same before acting.
   * @param {string} id @param {Bot} bot @param {Record<string, any>} args
   */
  async axAct(id, bot, args) {
    if (typeof this.d.caps.axAct !== 'function') return this.fail(id, ERR.UNSUPPORTED, 'the accessibility tree is offered on macOS and Windows only');
    const { snap, el } = AX.resolveRef(this.ax.map, args.ref);
    const target = this.axTarget(snap);
    const no = this.axRefusal(target);
    if (no) return this.fail(id, no.code, no.message);
    if (el.secure && args.action !== 'focus') return this.fail(id, ERR.PASSWORD_FIELD, 'a password field: the user types passwords themselves');
    if (!AX.actionFits(args.action, el.role)) return this.fail(id, ERR.INVALID_ARGS, `${args.action} does not fit a ${el.role}`);
    if (!args.background) {
      if (typeof this.d.caps.activeWindow !== 'function') return this.fail(id, ERR.FOREGROUND_UNKNOWN, 'cannot tell which window is in front');
      const a = await this.d.caps.activeWindow();
      if (!a || !a.app) return this.fail(id, ERR.FOREGROUND_UNKNOWN, 'cannot tell which window is in front: nothing was done');
      const same = G.normApp(a.app) === G.normApp(snap.app) || (!!a.pid && a.pid === snap.pid);
      if (!same || (args.expect && !G.sameWindow(args.expect, a))) return this.fail(id, ERR.WINDOW_CHANGED, 'another app came to the front: nothing was done');
      const front = this.axRefusal(a);
      if (front) return this.fail(id, front.code, front.message);
    }
    try {
      await this.d.caps.axAct({ snap, el, action: args.action, text: args.text });
    } finally { args.text = ''; }
    this.d.log({ kind: 'ax.act', bot, op: 'ax.act', role: el.role, name: el.name.slice(0, 80), action: args.action, background: !!args.background });
    return this.ok(id, { done: true, ref: el.ref, role: el.role, name: el.name, action: args.action, background: !!args.background });
  }

  // ───────────────────────── safety rules (guard.js) ─────────────────────────

  /** Every held key and mouse button is let go (session end, Stop, lost connection): fail closed. */
  releaseInput() {
    try { if (typeof this.d.caps.releaseAll === 'function') void Promise.resolve(this.d.caps.releaseAll()).catch(() => {}); } catch { /* nothing held */ }
  }

  /**
   * The local safety rules for one request. Returns null when it may go ahead, else the refusal.
   * @param {Bot} bot @param {string} op @param {Record<string, any>} args
   * @returns {Promise<{ code: string, message: string } | null>}
   */
  async guardCheck(bot, op, args) {
    if (op === 'app.open' || op === 'window.focus') {
      const name = op === 'app.open' ? args.name : args.title;
      const group = G.deniedName(name);
      // A terminal window too: the bot runs commands with shell.run (each one asked), never keystrokes into a terminal.
      if (group) return { code: ERR.BLOCKED_APP, message: `${group}: refused on this computer` };
      const keep = G.keepOutHit({ app: name, title: name }, this.owner);
      if (keep) return { code: ERR.KEEP_OUT, message: 'the owner keeps this out of reach' };
      return null;
    }
    if (!INPUT_OPS.has(op) || typeof this.d.caps.activeWindow !== 'function') return null;
    // Re-read the window in front right before acting.
    const a = await this.d.caps.activeWindow();
    if (!a || !a.app) return { code: ERR.FOREGROUND_UNKNOWN, message: 'cannot tell which window is in front: nothing was done' };
    if (args.expect && !G.sameWindow(args.expect, a)) return { code: ERR.WINDOW_CHANGED, message: 'another window came to the front: nothing was done' };
    const group = G.deniedGroup(a);
    if (group) return { code: ERR.BLOCKED_APP, message: `${group}: refused on this computer` };
    if (G.keepOutHit(a, this.owner)) return { code: ERR.KEEP_OUT, message: 'the owner keeps this window out of reach' };
    if (op === 'keyboard.type' || (op === 'keyboard.press' && !(NAV_KEYS.has(args.key) && !args.modifiers.some((/** @type {string} */ m) => m !== 'shift')))) {
      const risk = G.passwordRisk(a);
      if (risk) return { code: ERR.PASSWORD_FIELD, message: risk === 'password_field' ? 'a password field has the focus: the user types passwords themselves' : 'this looks like a sign-in window and the system cannot say whether a password field has focus' };
    }
    if (op === 'keyboard.press') {
      const v = G.shortcutVerdict({ key: args.key, modifiers: args.modifiers }, this.platform, a, this.opened);
      if (v) {
        if (!args.force) return { code: ERR.BLOCKED_SHORTCUT, message: `${v.combo} (${v.why}) is refused on this computer` };
        if (!this.d.autoConfirm) {
          const answer = await this.askGuard(bot, 'shortcut', v.combo);
          if (answer !== 'allow') return { code: ERR.BLOCKED_SHORTCUT, message: `${v.combo} was not allowed on this computer` };
        }
      }
    }
    return null;
  }

  /**
   * gpu.http (1.6): the owner's own Wan2GP on 127.0.0.1 of this computer. The first use by a bot for a port is asked here
   * (kind "gpu"); the yes lasts until Stop or until the Relais restarts. Reading the rest of a long answer asks nothing.
   * @param {string} id @param {Bot} bot @param {Record<string, any>} args
   */
  async gpuHttp(id, bot, args) {
    const key = `${bot.id}:${args.port}`;
    if (!args.read && !this.gpuOk.has(key) && !this.d.autoConfirm) {
      const answer = await this.askGuard(bot, 'gpu', `http://127.0.0.1:${args.port} (Wan2GP)`);
      if (answer !== 'allow') return this.fail(id, ERR.CONSENT_REFUSED, 'the user did not allow Wan2GP on this computer');
      if (this.locked) return this.fail(id, ERR.LOCKED, 'the user stopped remote control on this computer');
      this.gpuOk.add(key);
    }
    if (typeof this.d.caps.gpuHttp !== 'function') return this.fail(id, ERR.UNSUPPORTED, 'not available on this computer');
    return this.ok(id, await this.d.caps.gpuHttp(args));
  }

  /**
   * net.fetch (1.8, L169): a bot's web request through this computer's connection. The first use by each bot is asked
   * here (kind "net"); the yes lasts until Stop or until the Relais restarts. Rate-limited on its own.
   * @param {string} id @param {Bot} bot @param {Record<string, any>} args
   */
  async netFetch(id, bot, args) {
    if (!this.netBucket.take()) return this.fail(id, ERR.RATE_LIMITED, 'too many web requests through this computer');
    if (!this.netOk.has(bot.id) && !this.d.autoConfirm) {
      const answer = await this.askGuard(bot, 'net', new URL(args.url).host);
      if (answer !== 'allow') return this.fail(id, ERR.CONSENT_REFUSED, 'the user did not allow web requests through this computer');
      if (this.locked) return this.fail(id, ERR.LOCKED, 'the user stopped remote control on this computer');
      this.netOk.add(bot.id);
    }
    if (typeof this.d.caps.netFetch !== 'function') return this.fail(id, ERR.UNSUPPORTED, 'not available on this computer');
    return this.ok(id, await this.d.caps.netFetch(args));
  }

  /** @param {Bot} bot @param {'terminal'|'shortcut'|'gpu'|'net'} kind @param {string} detail @returns {Promise<string>} */
  async askGuard(bot, kind, detail) {
    const ask = this.d.ui.askGuard;
    if (typeof ask !== 'function') return 'refuse';
    const answer = await this.prompt(bot, kind, (promptId, timeoutMs) => ask.call(this.d.ui, { promptId, bot, kind, detail, timeoutMs }));
    return typeof answer === 'string' ? answer : 'refuse';
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

/** Operations that act on the window in front: re-read and checked right before (guard.js). */
const MAX_JOBS = 5;
const JOB_KEEP = 256 * 1024;
const STREAM_MAX = 64 * 1024;
const INPUT_OPS = new Set(['mouse.click', 'mouse.drag', 'mouse.scroll', 'keyboard.type', 'keyboard.press']);
/** Keys that only move around (allowed while a password field has focus, to leave it). */
const NAV_KEYS = new Set(['tab', 'escape', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown']);

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
  if (op === 'shell.run' || op === 'shell.start') return { command: args.command.slice(0, 1000), timeoutMs: args.timeoutMs, cwd: args.cwd, scripts: (args.scripts || []).length };
  // A saved login: where and which field, never the text.
  if (op === 'vault.type') return { field: args.field, site: args.site, length: args.text.length };
  // A value filled by reference: its length only (it may be personal).
  if (op === 'ax.act') return { ref: args.ref, action: args.action, background: args.background, length: args.text.length };
  // A file written by a bot: where and how much, never its content.
  if (op === 'fs.write') return { root: args.root, path: args.path, mode: args.mode, bytes: Buffer.byteLength(args.text, 'utf8') };
  // Wan2GP on this computer: where, never the prompt or the picture.
  // A web request through this computer: where, never the query string or the body.
  if (op === 'net.fetch') { const u = new URL(args.url); return { method: args.method, host: u.host, path: u.pathname.slice(0, 200), bytes: args.body ? args.body.length : 0 }; }
  if (op === 'gpu.http') return args.read ? { port: args.port, read: args.read.offset } : { port: args.port, method: args.method, path: args.path, bytes: args.body ? args.body.length : 0 };
  return args;
}

module.exports = { RelayCore, TokenBucket, IDLE_SESSION_MS, HANDOVER_IDLE_MS };
