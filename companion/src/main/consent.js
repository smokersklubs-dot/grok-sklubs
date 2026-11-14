// @ts-check
'use strict';
/**
 * Local consent gate. Decides whether a consent prompt may be shown at all
 * (rate limiting, so the server can never make prompts pop up in a loop) and
 * keeps the single pending prompt. Pure logic: the UI is injected.
 */
const { ERR } = require('./protocol');

const DEFAULTS = Object.freeze({
  promptTimeoutMs: 60_000, // an unanswered prompt counts as a refusal
  cooldownMs: 60_000, // after a refusal, the same bot cannot ask again for 1 min
  longCooldownMs: 10 * 60_000, // after 3 refusals in 10 min: 10 min
  refusalWindowMs: 10 * 60_000,
  refusalsBeforeLong: 3,
  globalWindowMs: 10 * 60_000, // at most N prompts (all bots) per window
  globalMaxPrompts: 6,
});

class ConsentGate {
  /**
   * @param {{ now?: () => number, options?: Partial<typeof DEFAULTS> }} [opts]
   */
  constructor(opts = {}) {
    this.now = opts.now || Date.now;
    this.o = { ...DEFAULTS, ...(opts.options || {}) };
    /** @type {number[]} */
    this.promptTimes = [];
    /** @type {Map<string, number[]>} bot id → refusal timestamps */
    this.refusals = new Map();
    /** @type {Map<string, number>} bot id → cooldown end */
    this.cooldownUntil = new Map();
    /** @type {null | { id: string, botId: string, kind: string }} */
    this.pending = null;
    this.seq = 0;
  }

  /**
   * Returns null if a prompt may be shown now, otherwise the error code to answer with.
   * @param {string} botId
   * @returns {string | null}
   */
  check(botId) {
    const t = this.now();
    if (this.pending) return ERR.CONSENT_PENDING;
    const until = this.cooldownUntil.get(botId) || 0;
    if (t < until) return ERR.CONSENT_COOLDOWN;
    this.promptTimes = this.promptTimes.filter((x) => t - x < this.o.globalWindowMs);
    if (this.promptTimes.length >= this.o.globalMaxPrompts) return ERR.RATE_LIMITED;
    return null;
  }

  /** Remaining cooldown in ms for a bot (0 if none). @param {string} botId */
  cooldownLeft(botId) {
    return Math.max(0, (this.cooldownUntil.get(botId) || 0) - this.now());
  }

  /**
   * Reserve the single prompt slot. Call only after check() returned null.
   * @param {string} botId @param {string} kind
   */
  open(botId, kind) {
    this.promptTimes.push(this.now());
    this.pending = { id: `p${++this.seq}`, botId, kind };
    return this.pending;
  }

  /**
   * Close the pending prompt and record the outcome.
   * @param {boolean} refused
   */
  close(refused) {
    const p = this.pending;
    this.pending = null;
    if (!p || !refused) return;
    const t = this.now();
    const list = (this.refusals.get(p.botId) || []).filter((x) => t - x < this.o.refusalWindowMs);
    list.push(t);
    this.refusals.set(p.botId, list);
    const long = list.length >= this.o.refusalsBeforeLong;
    this.cooldownUntil.set(p.botId, t + (long ? this.o.longCooldownMs : this.o.cooldownMs));
  }

  get promptTimeoutMs() {
    return this.o.promptTimeoutMs;
  }
}

module.exports = { ConsentGate, CONSENT_DEFAULTS: DEFAULTS };
