#!/usr/bin/env node
// Sklubot without a screen (L170): talk to ONE bot from a script, a cron job or a terminal, through its Bot API key.
// Nothing to install but Node 22+. Guide: docs/API.md « Commande sans écran ».
//
//   SKLUBOT_URL=https://bots.example.com SKLUBOT_KEY=sk_bot_… node scripts/sklubot.mjs <command> [arguments]
//
//   ask "<text>" [--thread N] [--timeout S]   send a message and print the bot's reply (waits up to S seconds, 120 by default)
//   send "<text>" [--thread N]                send a message, print its seq (no wait)
//   messages [--after SEQ] [--thread N]       print the conversation (JSON lines)
//   task "<objective>" [--rounds N]           give the bot a goal, print the task as JSON
//   task-status <taskId>                      where a goal stands (JSON)
//   memories                                  the bot's memory notes (key with the "memory" permission)
//   whoami                                    the bot and the key's permissions (JSON)
//   openapi                                   the OpenAPI description of the API (JSON, no key needed)
//
// Exit codes: 0 done · 1 refused or failed (the server's sentence on stderr) · 2 wrong usage · 3 the reply is still being
// written, or waits for the owner's approval in the app (its seq on stdout: run `ask` later or read `messages`).
const [, , command, ...rest] = process.argv;
const base = (process.env.SKLUBOT_URL ?? "").replace(/\/+$/, "");
const key = process.env.SKLUBOT_KEY ?? "";
const flags = {}; const args = [];
for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i]; else args.push(rest[i]); }
const usage = (msg) => { if (msg) console.error(msg); console.error("Usage: SKLUBOT_URL=… SKLUBOT_KEY=sk_bot_… node scripts/sklubot.mjs ask|send|messages|task|task-status|memories|whoami|openapi …"); process.exit(2); };
if (!command) usage();
if (!base) usage("SKLUBOT_URL is missing (the address of your Sklubot, e.g. https://bots.example.com).");
if (command !== "openapi" && !key.startsWith("sk_bot_")) usage("SKLUBOT_KEY is missing (a bot API key, made in the bot's settings → Accès API).");

async function call(method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) { console.error(json?.error?.message ?? json?.error ?? `HTTP ${res.status}`); process.exit(1); }
  return json;
}
const thread = flags.thread ? Number(flags.thread) : undefined;
const print = (v) => process.stdout.write(typeof v === "string" ? `${v}\n` : `${JSON.stringify(v, null, 2)}\n`);

switch (command) {
  case "ask": {
    if (!args[0]) usage("Give the text to send.");
    const sent = await call("POST", "/v1/bot/messages", { text: args[0], thread });
    const state = await call("GET", `/v1/bot/messages/${sent.seq}/wait?timeout=${Number(flags.timeout) || 120}`);
    if (state.status === "done" || state.status === "no_reply") { print(state.reply); break; }
    print(String(sent.seq)); console.error(state.status === "needs_approval" ? "The bot waits for its owner's approval in the app." : "The bot is still working on it."); process.exit(3);
  }
  case "send": { if (!args[0]) usage("Give the text to send."); print(String((await call("POST", "/v1/bot/messages", { text: args[0], thread })).seq)); break; }
  case "messages": {
    const q = new URLSearchParams(); if (flags.after) q.set("after", flags.after); if (thread !== undefined) q.set("thread", String(thread));
    for (const m of (await call("GET", `/v1/bot/messages?${q}`)).messages) process.stdout.write(`${JSON.stringify(m)}\n`);
    break;
  }
  case "task": { if (!args[0]) usage("Give the objective."); print((await call("POST", "/v1/bot/tasks", { objective: args[0], thread, maxRounds: flags.rounds ? Number(flags.rounds) : undefined })).task); break; }
  case "task-status": { if (!args[0]) usage("Give the task id."); print((await call("GET", `/v1/bot/tasks/${encodeURIComponent(args[0])}`)).task); break; }
  case "memories": { for (const m of (await call("GET", "/v1/bot/memories")).memories) process.stdout.write(`${m.text}\n`); break; }
  case "whoami": print(await call("GET", "/v1/bot")); break;
  case "openapi": print(await call("GET", "/v1/openapi.json")); break;
  default: usage(`Unknown command: ${command}`);
}
