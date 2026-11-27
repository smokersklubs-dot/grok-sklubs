/**
 * DS-Bot item 8 (agent/viewcard.ts): the wire type of a "view" card — key figures, a table, a bar or line chart, a
 * progress bar, a short text and a small form — drawn by the app from data only. No HTML, no script, no outside address
 * from the model ever reaches the page: each block is checked against this schema on the server and drawn by our own
 * components (web/src/components/ViewCard.tsx). Shared by the server, the web app and the phone app.
 */

export type ViewBlock =
  | { kind: "text"; text: string }
  | { kind: "stats"; items: { label: string; value: string; hint?: string }[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "chart"; chart: "bar" | "line"; labels: string[]; series: { name: string; values: number[] }[]; unit?: string }
  | { kind: "progress"; label: string; value: number; max: number }
  | { kind: "form"; fields: ViewField[]; submit: string };

export interface ViewField {
  id: string;
  label: string;
  type: "text" | "number" | "choice" | "checkbox";
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

/**
 * `status`: "shown" (nothing to answer), "pending" (a form waits for the user), "answered", "dismissed".
 * `fallback`: the same content in plain text, for places that cannot draw it (phone, Telegram, Slack, Discord).
 * `answer`: what the user sent, as text.
 */
export interface ViewCard { type: "view"; title: string; blocks: ViewBlock[]; fallback: string; status: "shown" | "pending" | "answered" | "dismissed"; answer?: string }

export const VIEW_LIMITS = {
  blocks: 8, title: 120, text: 2000, label: 80, value: 40, hint: 120,
  stats: 8, columns: 8, rows: 50, cell: 200, labels: 24, series: 4, fields: 8, options: 12, answer: 500,
} as const;
