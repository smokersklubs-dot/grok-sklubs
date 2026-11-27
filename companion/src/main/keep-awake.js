// @ts-check
'use strict';
/**
 * nod audit item 16 — keep the computer awake while a bot works on it, released as soon as it is done.
 *
 * Electron's powerSaveBlocker (https://www.electronjs.org/docs/latest/api/power-save-blocker):
 *  - 'prevent-display-sleep' while a bot has a control session (it looks at the screen: a sleeping or locked display
 *    would leave it blind);
 *  - 'prevent-app-suspension' while a command runs (the system must not sleep, the screen may turn off).
 * Each reason is counted (two commands at once hold one blocker); the blocker stops when the last one ends, and
 * everything is released when the relay stops (`releaseAll`). Never held while nothing runs.
 */

/** @typedef {'session'|'command'} Reason */
/** @param {{ start: (type: 'prevent-app-suspension'|'prevent-display-sleep') => number, stop: (id: number) => void, isStarted?: (id: number) => boolean }} psb @param {(e: Record<string, any>) => void} [log] */
function createKeepAwake(psb, log = () => {}) {
  /** @type {Record<Reason, { count: number, id: number | null }>} */
  const held = { session: { count: 0, id: null }, command: { count: 0, id: null } };
  const TYPE = { session: /** @type {const} */ ('prevent-display-sleep'), command: /** @type {const} */ ('prevent-app-suspension') };

  /** @param {Reason} why */
  function hold(why) {
    const h = held[why];
    h.count++;
    if (h.id === null) {
      try { h.id = psb.start(TYPE[why]); log({ kind: 'awake.on', why }); } catch (e) { log({ kind: 'warning', message: `keep awake: ${/** @type {Error} */ (e).message}` }); }
    }
    let done = false;
    return () => { if (!done) { done = true; release(why); } };
  }
  /** @param {Reason} why */
  function release(why) {
    const h = held[why];
    h.count = Math.max(0, h.count - 1);
    if (h.count === 0 && h.id !== null) {
      try { psb.stop(h.id); } catch { /* already stopped */ }
      h.id = null;
      log({ kind: 'awake.off', why });
    }
  }
  /** The control session started (true) or ended (false): one hold at most for it. */
  let sessionRelease = /** @type {null | (() => void)} */ (null);
  function session(on) {
    if (on && !sessionRelease) sessionRelease = hold('session');
    else if (!on && sessionRelease) { sessionRelease(); sessionRelease = null; }
  }
  /** Wraps a command runner: awake for exactly the time the command runs. @template {any[]} A @template R @param {(...a: A) => Promise<R>} fn */
  function during(fn) {
    return /** @type {(...a: A) => Promise<R>} */ (async (...args) => {
      const done = hold('command');
      try { return await fn(...args); } finally { done(); }
    });
  }
  function releaseAll() {
    sessionRelease = null;
    for (const why of /** @type {Reason[]} */ (['session', 'command'])) { held[why].count = 1; release(why); }
  }
  const state = () => ({ session: held.session.id !== null, command: held.command.id !== null, commands: held.command.count });
  return { hold, session, during, releaseAll, state };
}

module.exports = { createKeepAwake };
