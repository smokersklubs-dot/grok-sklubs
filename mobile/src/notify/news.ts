import type { Bot, Live } from "../api/types";
import { t } from "../i18n";

/** What was already told, per bot. */
export type Seen = Record<string, { unread: number; waiting: boolean }>;

/** What the background check found that deserves a notification. Pure: unit-tested. */
export function newsSince(prev: Seen, bots: Bot[], live: Record<string, Live>): { botId: string; title: string; body: string }[] {
  const out: { botId: string; title: string; body: string }[] = [];
  for (const b of bots) {
    const was = prev[b.id];
    const waiting = live[b.id]?.awaiting;
    if (waiting && !was?.waiting) out.push({ botId: b.id, title: b.name, body: waiting.reason || t("notify.waiting") });
    else if (b.unread > (was?.unread ?? 0)) out.push({ botId: b.id, title: b.name, body: b.preview || t("notify.waiting") });
  }
  return out;
}

