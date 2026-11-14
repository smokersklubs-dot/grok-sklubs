'use strict';
const { RelayCore } = require('../../src/main/relay-core');

/** Build a RelayCore with in-memory fakes. `answers` drives the fake consent UI. */
function makeCore({ answers = {}, perms = {}, autoConfirm = false, gateOptions } = {}) {
  const sent = [];
  const prompts = [];
  const logs = [];
  const bots = JSON.parse(JSON.stringify(perms));
  let locked = false;
  const calls = [];
  const caps = new Proxy({}, {
    get: (_t, name) => async (args) => {
      calls.push({ name, args });
      if (name === 'runShell') return { exitCode: 0, stdout: 'ok\n', stderr: '', truncated: false, timedOut: false, cancelled: false, durationMs: 1, signal: null };
      if (name === 'capture') return { format: 'jpeg', width: 10, height: 10, screenWidth: 10, screenHeight: 10, data: Buffer.from('x') };
      if (name === 'captureFrame') return { width: 10, height: 10, data: Buffer.from('f' + Math.random()), hash: String(Math.random()) };
      return {};
    },
  });
  const ui = {
    askSession: (p) => { prompts.push({ kind: 'session', ...p }); const a = answers.session; return typeof a === 'function' ? a(p) : Promise.resolve(a || 'refuse'); },
    askCommand: (p) => { prompts.push({ kind: 'command', ...p }); const a = answers.command; return typeof a === 'function' ? a(p) : Promise.resolve(a || { decision: 'refuse' }); },
    cancelPrompt: () => {},
    onSession: () => {},
    onLocked: () => {},
  };
  const store = {
    getBot: (id) => bots[id],
    setBotPerm: (bot, key, value) => { bots[bot.id] = bots[bot.id] || { name: bot.name }; if (key === 'control') bots[bot.id].control = value; else bots[bot.id].commands = value; },
    isLocked: () => locked,
    setLocked: (v) => { locked = v; },
  };
  const core = new RelayCore({ send: (m) => { sent.push(m); return true; }, caps, ui, store, log: (e) => logs.push(e), autoConfirm, gateOptions });
  let n = 0;
  const req = async (op, args = {}, bot = { id: 'bot_a', name: 'Alice' }) => {
    const id = `t${++n}`;
    await core.handleRequest({ type: 'req', id, bot, op, args });
    return sent.filter((m) => m.type === 'res' && m.id === id).pop();
  };
  return { core, sent, prompts, logs, bots, calls, req, isLocked: () => locked };
}

module.exports = { makeCore };
