import { subscribe } from "../bus.js";
import type { BotRecord, UserRecord } from "../store.js";
import { openUpstream, RealtimeBridge, realtimeKey, realtimeSettings, recordRealtimeCost, type Upstream } from "./realtime.js";

/**
 * L167 — a call over the real-time voice model (voice/realtime.ts), wired to the bot: `post` writes the delegated request in
 * the bot's chat (the same function as the classic call's, so secrets spoken aloud are masked and a workspace member's
 * words are theirs), and the bot's next finished answer in the main chat is handed back to the voice model. An approval
 * card the bot asks for meanwhile is announced (answered on the screen only: a voice model never answers an approval).
 */
export const DELEGATE_TIMEOUT_MS = () => (Number(process.env.REALTIME_DELEGATE_MS) > 0 ? Number(process.env.REALTIME_DELEGATE_MS) : 4 * 60_000);

export interface RealtimeCall { bridge: RealtimeBridge; close(): void }

export function startRealtimeCall(o: {
  bot: BotRecord; user: UserRecord; send: (d: string | Buffer) => void;
  /** Posts the words in the bot's chat as the caller's voice message; returns the row's seq. */
  post: (said: string) => number;
  /** Tests: a fake upstream instead of OpenAI's socket. */
  upstream?: Upstream;
}): RealtimeCall | null {
  const s = realtimeSettings.get(o.bot.userId);
  const key = realtimeKey(o.bot.userId);
  if (!key && !o.upstream) return null;
  const upstream: Upstream = o.upstream ?? openUpstream(key!.key, s.model);
  const waiting: { after: number; done: (text: string) => void }[] = [];
  const announced = new Set<string>();
  const bridge = new RealtimeBridge({
    upstream, send: o.send, model: s.model, voice: s.voice, botName: o.bot.name, locale: o.user.locale,
    cost: (usd) => recordRealtimeCost(o.bot.userId, o.bot.id, s.model, usd, key?.payer ?? ""),
    delegate: (request) => new Promise<string>((resolve) => {
      const after = o.post(request);
      const entry = { after, done: (text: string) => { clearTimeout(timer); resolve(text); } };
      const timer = setTimeout(() => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        resolve("The teammate is still working on it; its answer will appear in the chat.");
      }, DELEGATE_TIMEOUT_MS());
      waiting.push(entry);
    }),
  });
  const off = subscribe(o.user.id, (e) => {
    if (e.type !== "rows" || e.botId !== o.bot.id) return;
    for (const r of e.rows) {
      if ((r.thread ?? 0) !== 0) continue;
      if (r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending" && !announced.has(r.body.card.approvalId)) {
        announced.add(r.body.card.approvalId);
        bridge.tell(`The teammate needs the user's approval on the screen for: ${r.body.card.title}. Tell the user to answer it on the screen.`);
        continue;
      }
      if (r.body.kind !== "message" || r.body.role !== "assistant" || r.body.streaming || !r.body.text.trim()) continue;
      const w = waiting.find((x) => r.seq > x.after);
      if (!w) continue;
      waiting.splice(waiting.indexOf(w), 1);
      w.done(r.body.text.slice(0, 4000));
    }
  });
  upstream.on("open", () => bridge.start());
  if (o.upstream) bridge.start();
  upstream.on("close", () => { if (!bridge.closed) o.send(JSON.stringify({ type: "error", message: "realtime: the voice service closed the call" })); });
  return { bridge, close: () => { off(); bridge.close(); for (const w of waiting.splice(0)) w.done(""); } };
}
