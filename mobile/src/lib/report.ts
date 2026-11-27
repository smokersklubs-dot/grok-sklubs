/** L31 — « Signaler cette réponse »: the rules and the request, without React (components/ReportSheet.tsx; server/src/reports.ts). */
import type { Bot, MessageBody, Row } from "../api/types";

export const REPORT_REASONS = ["wrong", "harmful", "offensive", "private", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** The path and body the server expects (kept apart so a test can check them). */
export const reportRequest = (row: Pick<Row, "botId" | "seq">, reason: ReportReason, note: string) => ({
  path: `/bots/${encodeURIComponent(row.botId)}/rows/${row.seq}/report`,
  body: { reason, note: note.trim().slice(0, 500) },
});

export function canReport(bot: Pick<Bot, "access">, body: Pick<MessageBody, "role" | "streaming" | "text">): boolean {
  return !bot.access && body.role === "assistant" && !body.streaming && !!body.text.trim();
}

