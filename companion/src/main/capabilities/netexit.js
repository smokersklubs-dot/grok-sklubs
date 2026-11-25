// @ts-check
'use strict';
/**
 * net.fetch (protocol 1.8, docs/RELAIS-PROTOCOLE.md §19, A-FAIRE L169): « sortir par la maison » — a web request of one
 * of the owner's bots leaves from THIS computer's internet connection (sites see the home address). Rules, enforced
 * here whatever the server asks:
 *  - asked on this computer the first time for each bot (relay-core.js, kind "net"); the yes lasts until Stop or until
 *    the Relais closes; Stop locks it like everything else;
 *  - http and https on the internet only: every address the name resolves to is checked at connection time, and an
 *    address of the home network (router, printer, NAS…), of this computer, or any private/reserved range is refused
 *    (code blocked_address) — the bot must not reach the owner's home network;
 *  - GET, HEAD and POST only; a short list of headers (never cookies, never Authorization); body ≤ 180 KiB;
 *  - redirects are not followed here (Sklubot follows them and checks the bot's network policy on each hop);
 *  - answer ≤ 2.5 MiB (one message), the rest cut with `truncated: true`; 30 s at most;
 *  - rate: 20 requests at once in a burst, 2 per second after (relay-core.js), every request in the action log.
 */
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const zlib = require('node:zlib');

const MAX_BODY = 180 * 1024;
const MAX_RESPONSE = Math.floor(2.5 * 1024 * 1024);
const TIMEOUT_MS = 30_000;
const SEND_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'signature', 'signature-input', 'signature-agent']);
const BACK_HEADERS = ['content-type', 'content-length', 'content-language', 'location', 'last-modified', 'etag', 'retry-after', 'cache-control'];

/** Private, local and reserved ranges (the same list as Sklubot's server, server/src/net.ts). */
const blocked = new net.BlockList();
for (const [a, p] of /** @type {Array<[string, number]>} */ ([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
])) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of /** @type {Array<[string, number]>} */ ([
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
])) blocked.addSubnet(a, p, 'ipv6');

/** @param {string} ip */
function isPrivateAddress(ip) {
  const f = net.isIP(ip);
  if (f === 4) return blocked.check(ip, 'ipv4');
  if (f === 6) return blocked.check(ip, 'ipv6');
  return true;
}

/** @param {unknown} v */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** @param {string} m @param {string} [code] */
const bad = (m, code = 'invalid_args') => Object.assign(new Error(m), { code });

/**
 * Validates net.fetch's arguments (throws an Error with `code`).
 * @param {Record<string, any>} a
 */
function validateNetArgs(a) {
  if (typeof a.url !== 'string' || a.url.length > 4096) throw bad('url must be a string of 4096 characters at most');
  let u;
  try { u = new URL(a.url); } catch { throw bad('url is not an address'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('only http and https addresses');
  if (u.username || u.password) throw bad('no user name or password in the address');
  const method = typeof a.method === 'string' ? a.method.toUpperCase() : 'GET';
  if (!['GET', 'HEAD', 'POST'].includes(method)) throw bad('method must be GET, HEAD or POST');
  /** @type {Record<string, string>} */
  const headers = {};
  if (a.headers !== undefined) {
    if (!isObj(a.headers)) throw bad('headers must be an object');
    for (const [k, v] of Object.entries(a.headers)) {
      const key = k.toLowerCase();
      if (SEND_HEADERS.has(key) && typeof v === 'string' && v.length <= 2000 && !/[\r\n]/.test(v)) headers[key] = v;
    }
  }
  let body;
  if (a.body !== undefined) {
    if (typeof a.body !== 'string') throw bad('body must be base64');
    if (method !== 'POST') throw bad('only POST has a body');
    body = Buffer.from(a.body, 'base64');
    if (body.length > MAX_BODY) throw bad('body too large', 'too_large');
  }
  return { url: u.toString(), method, headers, body };
}

/**
 * @param {{ lookup?: typeof dns.lookup, allowPrivate?: boolean }} [deps] allowPrivate: tests against servers on 127.0.0.1 only.
 */
function createNetExit(deps = {}) {
  const resolve = deps.lookup || dns.lookup;
  /** dns.lookup that refuses any private address (checked at connection time, so a name cannot switch in between). @type {any} */
  const guardedLookup = (/** @type {string} */ hostname, /** @type {any} */ options, /** @type {Function} */ callback) => {
    resolve(hostname, { ...options, all: true }, (/** @type {any} */ err, /** @type {any} */ list) => {
      if (err) return callback(err);
      if (!list.length) return callback(new Error(`${hostname} has no address`));
      if (!deps.allowPrivate && list.some((/** @type {any} */ x) => isPrivateAddress(x.address))) return callback(bad(`${hostname} is on the home network or a private network`, 'blocked_address'));
      if (options && options.all) callback(null, list); else callback(null, list[0].address, list[0].family);
    });
  };

  /** @param {{ url: string, method: string, headers: Record<string, string>, body?: Buffer }} a */
  async function netFetch(a) {
    const u = new URL(a.url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateAddress(host) && !deps.allowPrivate) throw bad(`${host} is on the home network or a private network`, 'blocked_address');
    return await new Promise((done, fail) => {
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        protocol: u.protocol, hostname: host, port: u.port || undefined, path: `${u.pathname}${u.search}`, method: a.method,
        headers: { ...a.headers, ...(a.body ? { 'content-length': String(a.body.length) } : {}) },
        lookup: guardedLookup, agent: false, timeout: TIMEOUT_MS,
      }, (res) => {
        const coding = String(res.headers['content-encoding'] || '').toLowerCase();
        /** @type {NodeJS.ReadableStream} */
        let stream = res;
        if (coding === 'gzip' || coding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (coding === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (coding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        /** @type {Buffer[]} */
        const parts = [];
        let size = 0;
        let truncated = false;
        const finish = () => {
          /** @type {Record<string, string>} */
          const headers = {};
          for (const k of BACK_HEADERS) { const v = res.headers[k]; if (typeof v === 'string' && !(k === 'content-length' && (coding || truncated))) headers[k] = v; }
          done({ status: res.statusCode || 502, headers, data: Buffer.concat(parts).toString('base64'), truncated });
        };
        stream.on('data', (/** @type {Buffer} */ c) => {
          if (truncated) return;
          if (size + c.length > MAX_RESPONSE) { parts.push(c.subarray(0, MAX_RESPONSE - size)); size = MAX_RESPONSE; truncated = true; req.destroy(); finish(); return; }
          size += c.length; parts.push(c);
        });
        stream.on('end', () => { if (!truncated) finish(); });
        stream.on('error', (e) => { if (!truncated) fail(e); });
      });
      req.on('timeout', () => req.destroy(bad('the site did not answer in time', 'internal')));
      req.on('error', (e) => fail(/** @type {any} */ (e).code === 'blocked_address' ? e : bad(String(e.message || e).slice(0, 300), 'internal')));
      req.end(a.body);
    });
  }
  return { netFetch };
}

module.exports = { createNetExit, validateNetArgs, isPrivateAddress, MAX_BODY, MAX_RESPONSE };
