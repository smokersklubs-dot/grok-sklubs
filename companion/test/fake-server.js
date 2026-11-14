// @ts-check
'use strict';
/**
 * Minimal fake Sklubot server implementing the server side of docs/RELAIS-PROTOCOLE.md (v1).
 * Used by the end-to-end tests; also a reference for the real implementation.
 * Run standalone: node test/fake-server.js [port]  (prints the pairing code; type "ok" to confirm)
 */
const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { WebSocketServer } = require('ws');

const PATH = '/api/relay/connect';

/** Pairing codes avoid look-alike characters (0/O, 1/I/L). */
function pairingCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

class FakeServer extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, string>} deviceId → current token (the real server stores a hash) */
    this.tokens = new Map();
    /** @type {any} */ this.ws = null;
    /** @type {any[]} */ this.received = [];
    /** @type {any[]} */ this.frames = [];
    /** @type {Map<string, (m: any) => void>} */ this.pending = new Map();
    /** @type {string|null} */ this.pairCode = null;
    this.reqSeq = 0;
    this.autoAckFrames = true;
    /** @type {string|null} */ this.pendingRotation = null;
  }

  /** @param {number} [port] */
  start(port = 0) {
    this.http = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
    this.http.on('upgrade', (req, socket, head) => {
      if (!req.url || new URL(req.url, 'http://x').pathname !== PATH) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
    return new Promise((resolve) => this.http.listen(port, '127.0.0.1', () => {
      this.port = /** @type {any} */ (this.http.address()).port;
      resolve(this.port);
    }));
  }

  get url() { return `http://127.0.0.1:${this.port}`; }

  /** @param {any} ws */
  onConnection(ws) {
    if (this.ws) this.ws.close(4010, 'replaced');
    this.ws = ws;
    this.authed = false;
    ws.on('message', (/** @type {Buffer} */ data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { ws.close(4400, 'bad json'); return; }
      this.received.push(msg);
      this.onMessage(ws, msg);
    });
    ws.on('close', (/** @type {number} */ code) => { if (this.ws === ws) this.ws = null; this.emit('disconnected', code); });
    this.emit('connection');
  }

  /** @param {any} m */
  send(m) { if (this.ws) this.ws.send(JSON.stringify(m)); }

  /** @param {any} ws @param {any} msg */
  onMessage(ws, msg) {
    switch (msg.type) {
      case 'hello': {
        this.hello = msg;
        if (msg.v !== 1) { ws.close(4009, 'version'); return; }
        if (msg.auth) {
          const tok = this.tokens.get(msg.auth.deviceId);
          if (!tok || !timingSafeEqual(tok, msg.auth.token)) { ws.close(4001, 'unauthorized'); return; }
          this.deviceId = msg.auth.deviceId;
          this.authed = true;
          this.send({ type: 'welcome', v: 1, deviceId: this.deviceId, serverName: 'Sklubot (test)' });
        } else {
          this.pairCode = pairingCode();
          this.send({ type: 'pair.code', code: this.pairCode, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
        }
        break;
      }
      case 'token.ack':
        if (this.pendingPairing && msg.deviceId === this.pendingPairing) {
          this.pendingPairing = null;
          this.authed = true;
          this.send({ type: 'welcome', v: 1, deviceId: this.deviceId, serverName: 'Sklubot (test)' });
        } else if (this.pendingRotation) {
          this.tokens.set(/** @type {string} */ (this.deviceId), this.pendingRotation); // old token invalid from now on
          this.pendingRotation = null;
          this.emit('rotated');
        }
        break;
      case 'res': {
        const cb = this.pending.get(msg.id);
        if (cb) { this.pending.delete(msg.id); cb(msg); }
        break;
      }
      case 'frame':
        this.frames.push(msg);
        if (this.autoAckFrames) this.send({ type: 'view.ack', viewId: msg.viewId, seq: msg.seq });
        this.emit('frame', msg);
        break;
      case 'event':
        this.emit('event', msg);
        break;
      default:
        break;
    }
    this.emit('message', msg);
  }

  /** Simulates the user typing the code in the Sklubot web app. @param {string} code */
  confirmPairing(code) {
    if (!this.pairCode || code !== this.pairCode) return false;
    this.deviceId = `dev_${crypto.randomBytes(6).toString('hex')}`;
    const token = crypto.randomBytes(32).toString('base64url');
    this.tokens.set(this.deviceId, token);
    this.pendingPairing = this.deviceId;
    this.pairCode = null;
    this.send({ type: 'paired', deviceId: this.deviceId, token, serverName: 'Sklubot (test)' });
    return true;
  }

  rotateToken() {
    const token = crypto.randomBytes(32).toString('base64url');
    this.pendingRotation = token;
    this.send({ type: 'token.rotate', token });
    return token;
  }

  /**
   * @param {string} op @param {object} [args] @param {{ id: string, name: string }} [bot] @param {number} [timeoutMs]
   * @returns {Promise<any>}
   */
  request(op, args = {}, bot = { id: 'bot_alice', name: 'Alice' }, timeoutMs = 90_000) {
    const id = `r${++this.reqSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout waiting for ${op}`)); }, timeoutMs);
      this.pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
      this.send({ type: 'req', id, bot, op, args });
    });
  }

  /**
   * @param {(m: any) => boolean} pred @param {number} [timeoutMs] @param {string} [what]
   * @returns {Promise<any>}
   */
  waitFor(pred, timeoutMs = 20_000, what = 'message') {
    const found = this.received.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.off('message', on); reject(new Error(`timeout waiting for ${what}`)); }, timeoutMs);
      const on = (/** @type {any} */ m) => { if (pred(m)) { clearTimeout(timer); this.off('message', on); resolve(m); } };
      this.on('message', on);
    });
  }

  async close() {
    for (const c of this.wss ? this.wss.clients : []) c.terminate();
    await new Promise((r) => this.http ? this.http.close(() => r(null)) : r(null));
  }
}

/** @param {string} a @param {string} b */
function timingSafeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { FakeServer, pairingCode };

if (require.main === module) {
  const s = new FakeServer();
  s.start(Number(process.argv[2] || 8787)).then((port) => {
    console.log(`Fake Sklubot server on http://127.0.0.1:${port} — enter this address in the Relais.`);
    s.on('message', (m) => { if (m.type !== 'frame') console.log('<-', JSON.stringify(m).slice(0, 300)); });
    s.on('message', (m) => { if (m.type === 'hello' && !m.auth) setTimeout(() => console.log(`Pairing code: ${s.pairCode} (type "ok" + Enter to confirm)`), 50); });
    process.stdin.on('data', async (d) => {
      const line = d.toString().trim();
      if (line === 'ok' && s.pairCode) s.confirmPairing(s.pairCode);
      else if (line) {
        const [op, json] = line.split(/\s+(.*)/s);
        console.log('->', JSON.stringify(await s.request(op, json ? JSON.parse(json) : {})).slice(0, 500));
      }
    });
  });
}
