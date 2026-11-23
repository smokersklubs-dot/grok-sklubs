import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-callflow-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";

const { VoiceSession } = await import("../src/voice/session.js");
const { callPhrases, clearYesNo, voiceApprovable, ACK_AFTER_MS, STILL_WORKING_MS } = await import("../src/voice/callflow.js");

/** L154 — a call that never leaves the user in silence (voice/callflow.ts, voice/session.ts). */
const SR = 16000;
function wav(ms: number): Buffer {
  const n = Math.round((SR * ms) / 1000);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + n * 2, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, Buffer.alloc(n * 2)]);
}
const tone = (ms: number) => { const n = Math.round((SR * ms) / 1000); const a = new Int16Array(n); for (let i = 0; i < n; i++) a[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / SR) * 0.3 * 32767); return a; };
const noise = (ms: number) => new Int16Array(Math.round((SR * ms) / 1000));
const join = (...p: Int16Array[]) => { const out = new Int16Array(p.reduce((a, b) => a + b.length, 0)); let at = 0; for (const x of p) { out.set(x, at); at += x.length; } return out; };
async function until<T>(probe: () => T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 400; i++) { const v = probe(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error(`timed out waiting for ${label}`);
}

function harness(heard: string[], opts: { busy?: boolean; decide?: boolean } = {}) {
  const spoken: string[] = [];
  const submitted: string[] = [];
  const decided: [string, boolean][] = [];
  let busy = opts.busy ?? true;
  const s = new VoiceSession({
    send: (d) => { if (typeof d === "string") { const m = JSON.parse(d); if (m.type === "audio") { spoken.push(m.text); s.played(m.id); } } },
    stt: async () => heard.shift() ?? "", tts: async () => wav(200),
    submit: (t) => submitted.push(t), interrupt: () => {}, botBusy: () => busy, partials: false, bargeIn: { enabled: true, minSpeechMs: 200 },
    phrases: callPhrases("fr"), ...(opts.decide === false ? {} : { decide: (id: string, allow: boolean) => decided.push([id, allow]) }),
  });
  const speakUtterance = () => s.onAudio(join(noise(200), tone(600), noise(900)));
  return { s, spoken, submitted, decided, speakUtterance, setBusy: (v: boolean) => { busy = v; } };
}

test("clear yes / no only: polite words allowed, anything ambiguous is not an answer", () => {
  for (const y of ["oui", "Oui !", "oui merci", "Oui, vas-y.", "yes please", "je confirme"]) assert.equal(clearYesNo(y), "yes", y);
  for (const n of ["non", "Non merci.", "non, pas maintenant", "no thanks", "laisse tomber"]) assert.equal(clearYesNo(n), "no", n);
  for (const x of ["oui mais attends", "non enfin oui", "peut-être", "ouais bof je sais pas trop en fait", "", "oui non"]) assert.equal(clearYesNo(x), null, x);
});

test("voice approval never for the floor, a payment, a deletion, a private card, or someone else than the owner", () => {
  const base = { tool: "browser_open", status: "pending" as const };
  assert.equal(voiceApprovable(base, true), true);
  assert.equal(voiceApprovable(base, false), false, "a workspace member answers on the screen");
  assert.equal(voiceApprovable({ ...base, irreversible: true }, true), false, "an action that cannot be undone is the floor");
  assert.equal(voiceApprovable({ ...base, once: true, why: "new recipient after outside content" }, true), false, "the deterministic floor");
  assert.equal(voiceApprovable({ ...base, tool: "card:pay" }, true), false);
  assert.equal(voiceApprovable({ ...base, tool: "stripe_payment" }, true), false);
  assert.equal(voiceApprovable({ ...base, tool: "file_delete" }, true), false);
  assert.equal(voiceApprovable({ ...base, tool: "vault:github" }, true), false);
  assert.equal(voiceApprovable({ ...base, status: "allowed" as never }, true), false);
});

test("a spoken « oui » answers an approval and is not sent to the bot; unclear words are asked again, then left to the screen", async () => {
  const h = harness(["oui", "euh quoi", "hein", "oui"]);
  h.s.approvalAsked("apr_1", "Ouvrir le site **exemple.fr**", true);
  await h.s.idle();
  assert.equal(h.spoken[0], "J'ai besoin de ton accord : Ouvrir le site exemple.fr. Dis oui ou non.");
  h.speakUtterance();
  await until(() => h.decided.length, "decided");
  assert.deepEqual(h.decided, [["apr_1", true]]);
  assert.deepEqual(h.submitted, [], "the « oui » went to the card, not to the bot");
  await h.s.idle();
  assert.equal(h.spoken.at(-1), "C'est noté, j'y vais.");
  // Another card: two unclear answers, then the call gives up and the card stays on the screen.
  h.s.approvalAsked("apr_2", "Écrire le fichier", true);
  h.speakUtterance();
  await until(() => h.spoken.includes("Je n'ai pas compris. Dis juste oui ou non, ou réponds à l'écran."), "asked again");
  h.speakUtterance();
  await until(() => h.spoken.includes("Je laisse la demande à l'écran : réponds-y quand tu veux."), "left to the screen");
  h.speakUtterance();
  await until(() => h.submitted.length, "a later « oui » is a plain message once voice is given up");
  assert.deepEqual(h.decided, [["apr_1", true]]);
});

test("a floor card is announced but never answered by voice; a long sentence while a card waits is a new request", async () => {
  const h = harness(["oui", "en fait cherche plutôt le prix du billet de train"]);
  h.s.approvalAsked("apr_9", "Payer 40 €", false);
  await h.s.idle();
  assert.equal(h.spoken[0], "J'ai besoin de ton accord pour : Payer 40 €. Celui-là se valide à l'écran.");
  h.speakUtterance();
  await until(() => h.submitted.length, "the « oui » is only a message");
  assert.deepEqual(h.decided, []);
  // Without a decide hook (a workspace member's call), never answered either.
  const m = harness(["oui"], { decide: false });
  m.s.approvalAsked("apr_3", "Ouvrir le site", true);
  await m.s.idle();
  assert.match(m.spoken[0], /se valide à l'écran/);
});

test("an acknowledgement when the bot is slow to answer, then « je travaille encore » every 30 s, never while a card waits", async () => {
  const h = harness(["cherche les horaires"]);
  h.speakUtterance();
  await until(() => h.submitted.length, "submitted");
  const t0 = Date.now();
  h.s.tick(t0 + 100);
  await h.s.idle();
  assert.equal(h.spoken.length, 0, "not before the delay");
  h.s.tick(t0 + ACK_AFTER_MS + 50);
  await h.s.idle();
  assert.equal(h.spoken.length, 1);
  assert.match(h.spoken[0], /je regarde|m'en occupe|un instant/i);
  h.s.tick(Date.now() + 10_000);
  await h.s.idle();
  assert.equal(h.spoken.length, 1, "nothing more within 30 s");
  h.s.tick(Date.now() + STILL_WORKING_MS + 100);
  await h.s.idle();
  assert.equal(h.spoken.length, 2);
  assert.match(h.spoken[1], /travaille encore|Toujours dessus|Ça avance/);
  h.s.approvalAsked("apr_5", "Ouvrir", true);
  await h.s.idle();
  const n = h.spoken.length;
  h.s.tick(Date.now() + 5 * STILL_WORKING_MS);
  await h.s.idle();
  assert.equal(h.spoken.length, n, "the bot waits for the user: no « still working »");
  // The bot idle: silence is fine.
  h.s.approvalGone("apr_5");
  h.setBusy(false);
  h.s.tick(Date.now() + 5 * STILL_WORKING_MS);
  await h.s.idle();
  assert.equal(h.spoken.length, n + 1, "only the acknowledgement owed after the card was answered");
});

test("a quick answer gets no acknowledgement; a long answer is read in short, the rest is in the chat", async () => {
  const h = harness(["raconte"]);
  h.speakUtterance();
  await until(() => h.submitted.length, "submitted");
  h.s.botText(7, "Une. Deux. Trois. Quatre. Cinq. Six.", false);
  h.s.tick(Date.now() + ACK_AFTER_MS * 3);
  await h.s.idle();
  assert.deepEqual(h.spoken, ["Une.", "Deux.", "Trois.", "La suite est écrite dans le chat."]);
  // Short answers are read whole.
  h.s.botText(9, "Oui. C'est fait.", false);
  await h.s.idle();
  assert.deepEqual(h.spoken.slice(4), ["Oui.", "C'est fait."]);
});
