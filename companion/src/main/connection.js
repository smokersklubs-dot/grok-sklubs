// @ts-check
'use strict';
/**
 * Outbound WebSocket connection to `${SERVER}/api/relay/connect`.
 * Handles hello, pairing, device-token auth and rotation, heartbeat, flood
 * protection and reconnection with exponential backoff. Requests are handed
 * to RelayCore. Nothing is ever sent while paused (the socket is closed).
 * Uses the `ws` package: https://github.com/websockets/ws/blob/master/doc/ws.md
 */
const { EventEmitter } = require('node:events');
const { PROTOCOL_VERSION, LIMITS, CLOSE, isObj } = require('./protocol');

const HEARTBEAT_MS = 25_000;
const STABLE_AFTER_MS = 30_000;
const FLOOD_MAX_PER_SEC = 200;

/** Exponential backoff with ±30 % jitter: 1 s, 2 s, 4 s … capped at 60 s. @param {number} attempt @param {() => number} [rand] */
function backoffDelay(attempt, rand = Math.random) {
  const base = Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.7 + rand() * 0.6));
}

const TOKEN_RE = /^[A-Za-z0-9._~-]{16,512}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const PAIR_CODE_RE = /^[A-Z0-9-]{4,16}$/;

/**
 * @typedef {'idle'|'connecting'|'pairing'|'online'|'waiting'|'paused'|'unauthorized'|'outdated'|'replaced'} ConnStatus
 */

class RelayConnection extends EventEmitter {
  /**
   * @param {{
   *   wsUrl: string,
   *   hello: () => object,
   *   getAuth: () => ({ deviceId: string, token: string } | null),
   *   onPaired: (p: { deviceId: string, token: string, serverName: string }) => Promise<void>,
   *   onTokenRotated: (token: string) => Promise<void>,
   *   onRevoked: () => Promise<void>,
   *   core: import('./relay-core').RelayCore,
   *   log: (e: Record<string, any>) => void,
   *   WebSocketImpl?: any,
   *   userAgent?: string,
   * }} opts
   */
  constructor(opts) {
    super();
    this.o = opts;
    this.WS = opts.WebSocketImpl || require('ws');
    /** @type {ConnStatus} */
    this.status = 'idle';
    /** @type {any} */
    this.ws = null;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.stableTimer = null;
    this.heartbeat = null;
    this.alive = false;
    this.authenticated = false;
    this.wanted = false; // true while the user wants the relay running
    this.floodCount = 0;
    this.floodWindow = 0;
    /** @type {null | { code: string, expiresAt: string|null }} */
    this.pairing = null;
    this.serverName = '';
    this.lastError = '';
  }

  /** @param {ConnStatus} s @param {string} [detail] */
  setStatus(s, detail = '') {
    this.status = s;
    this.lastError = detail;
    this.emit('status', s, detail);
  }

  start() {
    this.wanted = true;
    this.attempt = 0;
    this.connect();
  }

  /** Pause: close the socket and do not reconnect. Nothing is sent while paused. */
  pause() {
    // Last messages (session.ended, bye) go out at the moment of pausing, then the socket is closed.
    this.o.core.onDisconnected('paused');
    if (this.ws) {
      try { this.sendRaw({ type: 'bye', reason: 'paused' }); } catch { /* ignore */ }
    }
    this.wanted = false;
    this.clearTimers();
    this.closeSocket(CLOSE.NORMAL, 'paused');
    this.setStatus('paused');
  }

  /** Stop completely (quit, forget server). */
  stop() {
    this.o.core.onDisconnected('stopped');
    this.wanted = false;
    this.clearTimers();
    this.closeSocket(CLOSE.NORMAL, 'bye');
    this.setStatus('idle');
  }

  clearTimers() {
    for (const t of [this.reconnectTimer, this.stableTimer]) if (t) clearTimeout(t);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.reconnectTimer = this.stableTimer = this.heartbeat = null;
  }

  /** @param {number} code @param {string} reason */
  closeSocket(code, reason) {
    const ws = this.ws;
    this.ws = null;
    this.authenticated = false;
    if (!ws) return;
    ws.removeAllListeners();
    ws.on('error', () => {});
    try { ws.close(code, reason); } catch { /* ignore */ }
    setTimeout(() => { try { ws.terminate(); } catch { /* ignore */ } }, 2000).unref?.();
  }

  connect() {
    if (!this.wanted) return;
    this.clearTimers();
    this.closeSocket(CLOSE.NORMAL, 'reconnect');
    this.setStatus('connecting');
    const ws = new this.WS(this.o.wsUrl, {
      maxPayload: LIMITS.MAX_INBOUND_BYTES, // server → client messages larger than this close the socket (1009)
      handshakeTimeout: 15_000,
      headers: { 'User-Agent': this.o.userAgent || 'SklubotRelais' },
      perMessageDeflate: false,
    });
    this.ws = ws;
    ws.on('open', () => {
      this.alive = true;
      this.heartbeat = setInterval(() => {
        if (!this.alive) { try { ws.terminate(); } catch { /* ignore */ } return; }
        this.alive = false;
        try { ws.ping(); } catch { /* ignore */ }
      }, HEARTBEAT_MS);
      const auth = this.o.getAuth();
      this.sendRaw({
        ...this.o.hello(),
        type: 'hello',
        v: PROTOCOL_VERSION,
        auth: auth ? { deviceId: auth.deviceId, token: auth.token } : null,
      });
    });
    ws.on('pong', () => { this.alive = true; });
    ws.on('message', (/** @type {Buffer} */ data, /** @type {boolean} */ isBinary) => this.onMessage(data, isBinary));
    ws.on('error', (/** @type {Error} */ err) => { this.lastError = err.message; this.o.log({ kind: 'conn.error', error: err.message }); });
    ws.on('close', (/** @type {number} */ code, /** @type {Buffer} */ reason) => this.onClose(code, reason ? reason.toString() : ''));
  }

  /** @param {object} msg */
  sendRaw(msg) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    const s = JSON.stringify(msg);
    if (Buffer.byteLength(s) > LIMITS.MAX_OUTBOUND_BYTES) return false;
    this.ws.send(s);
    return true;
  }

  /** Used by RelayCore. Only sends once authenticated. @param {object} msg */
  send(msg) {
    if (!this.authenticated || !this.wanted) return false;
    return this.sendRaw(msg);
  }

  get bufferedAmount() {
    return this.ws ? this.ws.bufferedAmount : 0;
  }

  /** @param {Buffer} data @param {boolean} isBinary */
  onMessage(data, isBinary) {
    const t = Date.now();
    if (t - this.floodWindow > 1000) { this.floodWindow = t; this.floodCount = 0; }
    if (++this.floodCount > FLOOD_MAX_PER_SEC) {
      this.o.log({ kind: 'conn.flood' });
      return this.ws && this.ws.close(CLOSE.TOO_MANY_MESSAGES, 'too many messages');
    }
    if (isBinary) return this.protocolError('binary messages are not used by protocol v1');
    /** @type {any} */
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return this.protocolError('invalid JSON'); }
    if (!isObj(msg) || typeof msg.type !== 'string') return this.protocolError('missing type');
    this.dispatch(msg).catch((e) => this.o.log({ kind: 'conn.dispatch_error', error: String(e && e.message || e) }));
  }

  /** @param {string} why */
  protocolError(why) {
    this.o.log({ kind: 'conn.protocol_error', why });
    if (this.ws) this.ws.close(CLOSE.PROTOCOL_ERROR, why.slice(0, 100));
  }

  /** @param {any} msg */
  async dispatch(msg) {
    switch (msg.type) {
      case 'pair.code': {
        if (this.authenticated || this.o.getAuth()) return;
        if (typeof msg.code !== 'string' || !PAIR_CODE_RE.test(msg.code)) return this.protocolError('bad pairing code');
        this.pairing = { code: msg.code, expiresAt: typeof msg.expiresAt === 'string' ? msg.expiresAt : null };
        this.setStatus('pairing');
        this.emit('pairing', this.pairing);
        return;
      }
      case 'paired': {
        if (this.authenticated || !this.pairing) return;
        if (typeof msg.token !== 'string' || !TOKEN_RE.test(msg.token)) return this.protocolError('bad token');
        if (typeof msg.deviceId !== 'string' || !DEVICE_ID_RE.test(msg.deviceId)) return this.protocolError('bad deviceId');
        const serverName = typeof msg.serverName === 'string' ? msg.serverName.slice(0, 80) : '';
        await this.o.onPaired({ deviceId: msg.deviceId, token: msg.token, serverName });
        this.pairing = null;
        this.sendRaw({ type: 'token.ack', deviceId: msg.deviceId });
        return;
      }
      case 'welcome': {
        if (msg.v !== PROTOCOL_VERSION) return this.ws && this.ws.close(CLOSE.VERSION_UNSUPPORTED, 'version');
        if (!this.o.getAuth()) return this.protocolError('welcome before pairing');
        this.authenticated = true;
        this.serverName = typeof msg.serverName === 'string' ? msg.serverName.slice(0, 80) : '';
        this.setStatus('online');
        this.emit('online');
        this.stableTimer = setTimeout(() => { this.attempt = 0; }, STABLE_AFTER_MS);
        return;
      }
      case 'token.rotate': {
        if (!this.authenticated) return;
        if (typeof msg.token !== 'string' || !TOKEN_RE.test(msg.token)) return this.protocolError('bad token');
        await this.o.onTokenRotated(msg.token);
        this.sendRaw({ type: 'token.ack', deviceId: (this.o.getAuth() || { deviceId: '' }).deviceId });
        return;
      }
      case 'revoke': {
        await this.o.onRevoked();
        this.wanted = false;
        this.closeSocket(CLOSE.NORMAL, 'revoked');
        this.o.core.onDisconnected();
        this.setStatus('unauthorized', 'revoked');
        return;
      }
      case 'req':
        if (!this.authenticated) return;
        return this.o.core.handleRequest(msg);
      case 'cancel':
        if (this.authenticated) this.o.core.handleCancel(msg);
        return;
      case 'view.ack':
        if (this.authenticated) this.o.core.handleViewAck(msg);
        return;
      case 'error':
        this.o.log({ kind: 'server.error', code: String(msg.code || '').slice(0, 40), message: String(msg.message || '').slice(0, 200) });
        this.lastError = String(msg.code || '');
        return;
      default:
        // Unknown types are ignored (forward compatibility), but logged.
        this.o.log({ kind: 'conn.unknown_type', type: String(msg.type).slice(0, 40) });
    }
  }

  /** @param {number} code @param {string} reason */
  async onClose(code, reason) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.heartbeat = this.stableTimer = null;
    this.ws = null;
    this.authenticated = false;
    this.pairing = null;
    this.o.core.onDisconnected();
    this.o.log({ kind: 'conn.closed', code, reason: reason.slice(0, 100) });
    if (!this.wanted) return;
    if (code === CLOSE.UNAUTHORIZED) { this.wanted = false; return this.setStatus('unauthorized', 'unauthorized'); }
    if (code === CLOSE.REVOKED) { await this.o.onRevoked(); this.wanted = false; return this.setStatus('unauthorized', 'revoked'); }
    if (code === CLOSE.VERSION_UNSUPPORTED) { this.wanted = false; return this.setStatus('outdated'); }
    if (code === CLOSE.REPLACED) { this.wanted = false; return this.setStatus('replaced'); }
    const delay = backoffDelay(this.attempt++);
    this.setStatus('waiting', String(Math.round(delay / 1000)));
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

module.exports = { RelayConnection, backoffDelay, TOKEN_RE };
