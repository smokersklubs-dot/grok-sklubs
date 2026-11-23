/**
 * L184 — pure helpers shared by the web app and the phone app (unit-tested in web/scripts/chat-plus.test.mjs):
 * poll results (server polls.ts) and the first web address of a message for its link preview (server linkpreview.ts).
 */
export interface PollLike { options: string[]; multi: boolean; status: "open" | "closed"; votes: { by: string; name: string; choices: number[] }[] }

/** Votes per answer, the share of voters (0–100, rounded) and who chose it. */
export function pollResults(p: PollLike): { label: string; count: number; pct: number; names: string[] }[] {
  const voters = p.votes.length;
  return p.options.map((label, i) => {
    const who = p.votes.filter((v) => v.choices.includes(i));
    return { label, count: who.length, pct: voters ? Math.round((who.length / voters) * 100) : 0, names: who.map((v) => v.name) };
  });
}

/** The answers this voter ("user:<id>") picked. */
export const myChoices = (p: PollLike, by: string) => p.votes.find((v) => v.by === by)?.choices ?? [];

/** The next choice after a tap: one answer replaces, several answers toggle. */
export function nextChoice(p: Pick<PollLike, "multi">, current: number[], tapped: number): number[] {
  if (!p.multi) return [tapped];
  return current.includes(tapped) ? current.filter((i) => i !== tapped) : [...current, tapped].sort((a, b) => a - b);
}

/**
 * The first http(s) address of a message, outside code (fenced blocks and `inline code`), without the punctuation that
 * ends a sentence; null when there is none. Markdown links count ([texte](https://…)).
 */
export function firstLink(text: string): string | null {
  const bare = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const m = /\bhttps?:\/\/[^\s<>()"'`\]]+(?:\([^\s<>()]*\)[^\s<>()"'`\]]*)*/i.exec(bare);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?»]+$/, "");
  try { const u = new URL(url); return u.hostname && !u.username && !u.password ? u.toString() : null; } catch { return null; }
}
