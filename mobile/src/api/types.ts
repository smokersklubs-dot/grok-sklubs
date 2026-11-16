/**
 * Wire types shared with the Sklubot server. Type-only: Babel strips these imports, so nothing from the server
 * code ends up in the app bundle. The server's server/src/shared.ts stays the single source of truth.
 */
export type {
  Attachment, Bot, BotBundle, BgTask, Card, FileEntry, Live, Locale, Origin, Routine, Row, RowBody, ServerEvent, Task, User, ActivityKind,
} from "../../../server/src/shared";

import type { Card, RowBody } from "../../../server/src/shared";
export type MessageBody = Extract<RowBody, { kind: "message" }>;
export type StepBody = Extract<RowBody, { kind: "step" }>;
export type CardBody = Extract<RowBody, { kind: "card" }>;
export type NoticeBody = Extract<RowBody, { kind: "notice" }>;
export type EventBody = Extract<RowBody, { kind: "event" }>;
export type ApprovalCard = Extract<Card, { type: "approval" }>;
export type QuestionCard = Extract<Card, { type: "question" }>;

/** GET /api/me (server/src/routes.ts). */
export interface MeResponse {
  user: { id: string; email: string; name: string; locale: "fr" | "en" } | null;
  signupOpen: boolean;
  setupCodeRequired: boolean;
  firstBot: { name: string; label: string };
}
