// @ts-check
'use strict';
/**
 * gpu.http (protocol 1.6, docs/RELAIS-PROTOCOLE.md §17): lets Sklubot reach the owner's own Wan2GP (free video and
 * pictures on their GPU) running on THIS computer. Rules, enforced here whatever the server asks:
 *  - only http://127.0.0.1:<port> — never another host, never another computer on the network;
 *  - GET, POST and PUT only; a path, never a full address; no cookies, no Authorization header sent;
 *  - the first use by a bot for a port is asked on this computer (relay-core.js, kind "gpu"); Stop locks it like the rest;
 *  - answers larger than one message (4 MiB) come back in pieces of CHUNK bytes, kept here for 5 minutes at most.
 */
const http = require('node:http');
const crypto = require('node:crypto');

const CHUNK = 2 * 1024 * 1024;
const MAX_BODY = 180 * 1024;
const MAX_RESPONSE = 300 * 1024 * 1024;
const KEEP_MS = 5 * 60_000;
const HEADERS = new Set(['content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id']);

/** @param {unknown} v */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Validates gpu.http's arguments (throws an Error with `code`).
 * @param {Record<string, any>} a
 */
function validateGpuArgs(a) {
  const bad = (/** @type {string} */ m, code = 'invalid_args') => Object.assign(new Error(m), { code });
  const port = a.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) throw bad('port must be 1024-65535');
  if (a.read !== undefined) {
    if (!isObj(a.read) || typeof a.read.token !== 'string' || !/^[a-f0-9]{32}$/.test(a.read.token) || typeof a.read.offset !== 'number' || a.read.offset < 0) throw bad('read must be { token, offset }');
    return { port, read: { token: a.read.token, offset: Math.floor(a.read.offset) } };
  }
  const method = typeof a.method === 'string' ? a.method.toUpperCase() : '';
  if (!['GET', 'POST', 'PUT'].includes(method)) throw bad('method must be GET, POST or PUT');
  const path = typeof a.path === 'string' ? a.path : '';
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 512 || /[\\\s]|%2f%2f/i.test(path) || /^\/[^/]*:/.test(path)) throw bad('path must be a plain path');
  /** @type {Record<string, string>} */
  const headers = {};
  if (a.headers !== undefined) {
    if (!isObj(a.headers)) throw bad('headers must be an object');
    for (const [k, v] of Object.entries(a.headers)) {
      const key = k.toLowerCase();
      if (HEADERS.has(key) && typeof v === 'string' && v.length <= 300 && !/[\r\n]/.test(v)) headers[key] = v;
    }
  }
  let body;
  if (a.body !== undefined) {
    if (typeof a.body !== 'string') throw bad('body must be base64');
    body = Buffer.from(a.body, 'base64');
    if (body.length > MAX_BODY) throw bad('body too large', 'too_large');
  }
  return { port, method, path, headers, body };
}

/** @param {{ request?: typeof http.request, now?: () => number }} [deps] */
function createGpuHttp(deps = {}) {
  const request = deps.request || http.request;
  const now = deps.now || Date.now;
  /** @type {Map<string, { data: Buffer, status: number, headers: Record<string, string>, at: number }>} */
  const kept = new Map();
  const sweep = () => { for (const [k, v] of kept) if (now() - v.at > KEEP_MS) kept.delete(k); };

  /** @param {{ data: Buffer, status: number, headers: Record<string, string> }} r @param {number} offset @param {string|null} token */
  const piece = (r, offset, token) => {
    const end = Math.min(r.data.length, offset + CHUNK);
    const more = end < r.data.length;
    return { status: r.status, headers: r.headers, size: r.data.length, offset, data: r.data.subarray(offset, end).toString('base64'), token: more ? token : null };
  };

  /** @param {Record<string, any>} a */
  async function gpuHttp(a) {
    sweep();
    if (a.read) {
      const r = kept.get(a.read.token);
      if (!r) throw Object.assign(new Error('that answer is no longer kept'), { code: 'not_found' });
      const out = piece(r, a.read.offset, a.read.token);
      if (!out.token) kept.delete(a.read.token);
      return out;
    }
    const r = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: a.port, method: a.method, path: a.path, headers: { ...a.headers, ...(a.body ? { 'content-length': String(a.body.length) } : {}) }, timeout: 170_000 }, (res) => {
        /** @type {Buffer[]} */
        const parts = [];
        let size = 0;
        res.on('data', (/** @type {Buffer} */ c) => {
          size += c.length;
          if (size > MAX_RESPONSE) { req.destroy(Object.assign(new Error('answer too large'), { code: 'too_large' })); return; }
          parts.push(c);
        });
        res.on('end', () => {
          /** @type {Record<string, string>} */
          const headers = {};
          for (const k of ['content-type', 'mcp-session-id']) { const v = res.headers[k]; if (typeof v === 'string') headers[k] = v; }
          resolve({ data: Buffer.concat(parts), status: res.statusCode || 502, headers });
        });
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Wan2GP did not answer in time')));
      req.on('error', (e) => reject(Object.assign(new Error(/ECONNREFUSED/.test(String(e)) ? `nothing answers on 127.0.0.1:${a.port} (is Wan2GP started with --mcp?)` : String(e.message || e)), { code: e && /** @type {any} */ (e).code === 'too_large' ? 'too_large' : 'internal' })));
      req.end(a.body);
    });
    const res = /** @type {{ data: Buffer, status: number, headers: Record<string, string> }} */ (r);
    if (res.data.length <= CHUNK) return piece(res, 0, null);
    const token = crypto.randomBytes(16).toString('hex');
    kept.set(token, { ...res, at: now() });
    return piece(res, 0, token);
  }
  return { gpuHttp };
}

module.exports = { createGpuHttp, validateGpuArgs, CHUNK, MAX_BODY };
