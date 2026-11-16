/**
 * Rows of a conversation → what the chat screen shows: messages, folded groups of tool steps, cards, notices, day
 * separators. Pure, unit-tested. Simpler than the web transcript (web/src/components/Transcript.tsx), same meaning.
 */
import type { MessageBody, Row } from "../api/types";

export type Item =
  | { t: "day"; key: string; at: number }
  | { t: "msg"; key: string; row: Row; body: MessageBody; mine: boolean; first: boolean }
  | { t: "steps"; key: string; rows: Row[]; live: boolean }
  | { t: "row"; key: string; row: Row };

const sameDay = (a: number, b: number) => {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

/** `viewer`: on a bot someone shares with you, only the messages you wrote (origin "member", your id) are yours. */
export function isMine(b: MessageBody, viewer?: string): boolean {
  if (viewer) return b.role === "user" && b.origin?.kind === "member" && b.origin.id === viewer;
  return b.role === "user" && (!b.origin || b.origin.kind === "voice");
}

function visible(row: Row): boolean {
  if (row.thread) return false;
  const b = row.body;
  if (b.kind === "message" && !b.text.trim() && !b.streaming && !b.attachments?.length) return false;
  return true;
}

export function buildItems(rows: Row[], running: boolean, viewer?: string): Item[] {
  const items: Item[] = [];
  const shown = rows.filter(visible);
  let lastAt = 0;
  let prevSender = "";
  for (let i = 0; i < shown.length; i++) {
    const row = shown[i];
    if (!lastAt || !sameDay(lastAt, row.createdAt)) {
      items.push({ t: "day", key: `d${row.seq}`, at: row.createdAt });
      prevSender = "";
    }
    lastAt = row.createdAt;
    const b = row.body;
    if (b.kind === "step") {
      const group: Row[] = [row];
      while (i + 1 < shown.length && shown[i + 1].body.kind === "step" && sameDay(shown[i + 1].createdAt, row.createdAt)) group.push(shown[++i]);
      const last = i === shown.length - 1;
      items.push({ t: "steps", key: `s${row.seq}`, rows: group, live: running && last });
      prevSender = "";
      continue;
    }
    if (b.kind === "message") {
      const sender = `${b.role}:${b.origin ? `${b.origin.kind}:${b.origin.id}` : ""}`;
      items.push({ t: "msg", key: `m${row.seq}`, row, body: b, mine: isMine(b, viewer), first: sender !== prevSender });
      prevSender = sender;
      continue;
    }
    items.push({ t: "row", key: `r${row.seq}`, row });
    prevSender = "";
  }
  return items;
}

/** The label of the step under way in a group (the last one), and how many steps it holds. */
export function stepSummary(rows: Row[]): { label: string; count: number; problem: boolean } {
  const steps = rows.map((r) => r.body).filter((b): b is Extract<Row["body"], { kind: "step" }> => b.kind === "step");
  const last = steps[steps.length - 1];
  return { label: last?.label ?? "", count: steps.length, problem: steps.some((s) => s.status === "error" || s.status === "denied") };
}
