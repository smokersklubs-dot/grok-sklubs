import { randomUUID } from "node:crypto";
import { q } from "./db.js";
import { screen } from "./pastedsecrets.js";
import { rows, redactSecrets, type BotRecord } from "./store.js";
import type { Row, Card, PeerReviewState, Locale } from "./shared.js";
import { reviewChanges } from "./peerreview.js";

export function peerReviewStatus(bot: BotRecord, seq: number): PeerReviewState {
  const r = q.get<{ result: string | null; error: string | null; started: number }>(
    "SELECT result,error,started FROM peer_reviews WHERE bot=? AND generation=? AND seq=?",
    bot.id,
    bot.generation,
    seq,
  );
  if (!r) return { state: "none" };
  if (r.result) return { state: "ready", review: JSON.parse(r.result) };
  if (r.error || Date.now() - r.started > 12 * 60_000)
    return { state: "failed", error: r.error || "Relecture interrompue. Tu peux la relancer." };
  return { state: "working" };
}
export function startPeerReview(
  bot: BotRecord,
  reviewer: BotRecord,
  row: Row,
  card: Extract<Card, { type: "files" }>,
  locale: Locale,
) {
  if (
    reviewer.id === bot.id ||
    reviewer.hidden ||
    reviewer.kind !== "agent" ||
    reviewer.userId !== bot.userId ||
    card.status !== "available"
  )
    throw Error("Choisis un autre bot disponible.");
  const id = randomUUID();
  const started = q.tx(() => {
    if (peerReviewStatus(bot, row.seq).state === "working") return false;
    q.run(
      `INSERT INTO peer_reviews(id,bot,generation,seq,started) VALUES(?,?,?,?,?)
      ON CONFLICT(bot,generation,seq) DO UPDATE SET id=excluded.id,started=excluded.started,result=NULL,error=NULL`,
      id,
      bot.id,
      row.generation,
      row.seq,
      Date.now(),
    );
    return true;
  });
  if (started) {
    rows.updateCard(bot, row.generation, row.seq, (k) => (k.type === "files" ? { ...k, hasReview: true } : k));
    void reviewChanges(bot, reviewer, row, card, locale)
      .then(
        (result) => q.run("UPDATE peer_reviews SET result=? WHERE id=?", JSON.stringify(result), id),
        (e) =>
          q.run(
            "UPDATE peer_reviews SET error=? WHERE id=?",
            screen(
              redactSecrets(bot.userId, e instanceof Error ? e.message : "Relecture indisponible."),
              locale,
            ).text.slice(0, 500),
            id,
          ),
      )
      .catch((e) => console.error("[peer review]", id, String(e)));
  }
  return peerReviewStatus(bot, row.seq);
}
