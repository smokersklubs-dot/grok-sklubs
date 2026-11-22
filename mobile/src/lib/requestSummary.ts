import type { Row } from "../api/types";

/**
 * nod item 3: the activity line says at once what the bot is on — a one-line summary of the request, taken from the
 * person's last message (first line, links and extra spaces shortened), until the bot's first real step or thought.
 * Done here, without any model call, so it shows the instant the message is sent (same as web/src/lib/requestSummary.ts).
 */
export function requestSummary(rows: Row[], max = 70): string {
  for (let i = rows.length - 1; i >= 0; i--) {
    const b = rows[i].body;
    if (b.kind !== "message") continue;
    if (b.role !== "user") return "";
    const line = (b.text ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    const plain = line.replace(/https?:\/\/(\S+)/g, (_m, rest: string) => rest.split("/")[0]).replace(/\s+/g, " ").trim();
    return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
  }
  return "";
}
