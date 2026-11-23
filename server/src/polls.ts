/**
 * L184 « sondages » (backlog A-FAIRE L184, OpenClaw audit G19 "polls" — behaviour only, our own code).
 *
 * The owner asks a question with 2 to 10 answers in a bot's chat or in a group. The poll is a card in that conversation:
 * the owner votes with a tap, and the bots vote with `poll_vote` (in a group, each member is asked; in a bot's chat,
 * the bot). One vote per voter, which can be changed while the poll is open; the owner closes it. Votes live on the card
 * itself (rows.updateCard), the table only finds the card again from the poll's id.
 */
import { q } from "./db.js";
import type { PollCard, PollVote } from "./polltypes.js";
import { bots, clip, newId, now, rows, type BotRecord } from "./store.js";
import type { BuiltinTool } from "./agent/tools.js";

q.run(`CREATE TABLE IF NOT EXISTS polls (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, generation INTEGER NOT NULL, seq INTEGER NOT NULL, created_at INTEGER NOT NULL)`);

export const POLL_LIMITS = { question: 300, option: 120, minOptions: 2, maxOptions: 10, reason: 200 } as const;

/** Checks what the owner typed. Throws with a message for the owner. */
export function cleanPoll(input: { question?: unknown; options?: unknown; multi?: unknown }): { question: string; options: string[]; multi: boolean } {
  const question = clip(String(input.question ?? "").replace(/\s+/g, " ").trim(), POLL_LIMITS.question);
  if (!question) throw new Error("Write the question.");
  const seen = new Set<string>();
  const options = (Array.isArray(input.options) ? input.options : []).map((o) => clip(String(o ?? "").replace(/\s+/g, " ").trim(), POLL_LIMITS.option))
    .filter((o) => o && !seen.has(o.toLowerCase()) && (seen.add(o.toLowerCase()), true));
  if (options.length < POLL_LIMITS.minOptions) throw new Error("Give at least 2 different answers.");
  if (options.length > POLL_LIMITS.maxOptions) throw new Error("A poll has at most 10 answers.");
  return { question, options, multi: input.multi === true };
}

/** Records or replaces one voter's choice on the card. Returns the new card or an error for whoever voted. */
export function applyVote(card: PollCard, vote: PollVote): PollCard | { error: string } {
  if (card.status !== "open") return { error: "This poll is closed." };
  const choices = [...new Set(vote.choices)].filter((i) => Number.isInteger(i) && i >= 0 && i < card.options.length).sort((a, b) => a - b);
  if (!choices.length) return { error: `Pick one of the answers (1 to ${card.options.length}).` };
  if (!card.multi && choices.length > 1) return { error: "This poll takes one answer only." };
  const clean: PollVote = { by: vote.by, name: clip(vote.name, 60), choices, ...(vote.reason ? { reason: clip(vote.reason.replace(/\s+/g, " ").trim(), POLL_LIMITS.reason) } : {}) };
  return { ...card, votes: [...card.votes.filter((v) => v.by !== vote.by), clean] };
}

/** How many votes each answer has. */
export const tally = (card: PollCard) => card.options.map((_, i) => card.votes.filter((v) => v.choices.includes(i)).length);

/** Plain text of the poll for the bots (and the chat services). */
export function pollText(card: PollCard): string {
  const counts = tally(card);
  return [`Poll ${card.pollId}${card.status === "closed" ? " (closed)" : ""}: ${card.question}`, ...card.options.map((o, i) => `${i + 1}. ${o} — ${counts[i]} vote(s)`), card.multi ? "Several answers allowed." : "One answer."].join("\n");
}

export const polls = {
  create(chat: BotRecord, createdBy: string, input: { question?: unknown; options?: unknown; multi?: unknown }, thread = 0): PollCard {
    const p = cleanPoll(input);
    const card: PollCard = { type: "poll", pollId: newId("poll"), question: p.question, options: p.options, multi: p.multi, status: "open", votes: [], createdBy };
    const row = rows.append(chat, { kind: "card", card }, thread);
    q.run("INSERT INTO polls (id, user_id, bot_id, generation, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)", card.pollId, chat.userId, chat.id, row.generation, row.seq, now());
    return card;
  },
  /** The poll's card and its conversation, for this account only. */
  find(userId: string, pollId: string): { chat: BotRecord; generation: number; seq: number; card: PollCard } | null {
    const r = q.get<{ bot_id: string; generation: number; seq: number }>("SELECT bot_id, generation, seq FROM polls WHERE id = ? AND user_id = ?", pollId, userId);
    const chat = r ? bots.byId(r.bot_id) : null;
    if (!r || !chat) return null;
    const row = rows.get(chat.id, r.generation, r.seq);
    return row?.body.kind === "card" && row.body.card.type === "poll" ? { chat, generation: r.generation, seq: r.seq, card: row.body.card } : null;
  },
  vote(userId: string, pollId: string, vote: PollVote): PollCard | { error: string } {
    const f = polls.find(userId, pollId);
    if (!f) return { error: "No such poll." };
    const next = applyVote(f.card, vote);
    if ("error" in next) return next;
    rows.updateCard(f.chat, f.generation, f.seq, () => next);
    return next;
  },
  close(userId: string, pollId: string): PollCard | null {
    const f = polls.find(userId, pollId);
    if (!f) return null;
    const next: PollCard = { ...f.card, status: "closed" };
    rows.updateCard(f.chat, f.generation, f.seq, () => next);
    return next;
  },
};

/** May this bot vote in the poll's conversation: its own chat, or a group it is a member of. */
export const canVote = (bot: BotRecord, chat: BotRecord) => chat.id === bot.id || (chat.kind === "room" && chat.memberIds.includes(bot.id));

export const pollTools: BuiltinTool[] = [{
  spec: {
    name: "poll_vote",
    description: "Vote in a poll the user posted in your chat or in a group you are in (its id looks like poll_…). Give the number(s) of your answer(s), 1 for the first. You can change your vote while the poll is open. Add a one-line reason.",
    inputSchema: { type: "object", properties: { poll: { type: "string", description: "The poll's id (poll_…)" }, choices: { type: "array", items: { type: "integer" }, description: "Answer numbers, 1 for the first" }, reason: { type: "string", description: "One short line: why" } }, required: ["poll", "choices"] },
  },
  activity: "messaging", label: "Voting in a poll", detail: (a) => clip(String(a.poll ?? ""), 30),
  run: async (a, c) => {
    const f = polls.find(c.user.id, String(a.poll ?? "").trim());
    if (!f || !canVote(c.bot, f.chat)) return { content: "No poll with this id in your chat or your groups.", isError: true };
    const r = polls.vote(c.user.id, f.card.pollId, { by: `bot:${c.bot.id}`, name: c.bot.name, choices: (Array.isArray(a.choices) ? a.choices : [a.choices]).map((n: unknown) => Number(n) - 1), reason: a.reason ? String(a.reason) : undefined });
    if ("error" in r) return { content: r.error, isError: true };
    return { content: `Your vote is counted.\n${pollText(r)}` };
  },
}];
