/**
 * DS-Bot item 8 (agent/viewcard.ts): answering the form of a view card in the chat, or closing it. Same rules as a
 * question card (routes.ts cards/:seq/answer): the owner's own bot only, the answer is checked against the form's
 * fields, a secret typed in it is masked, and it reaches the bot as the owner's next message in that conversation.
 */
import type { Context, Hono } from "hono";
import { submitUserMessage } from "./agent/loop.js";
import { formAnswer } from "./agent/viewcard.js";
import { holdAndOffer, screen as screenSecrets } from "./pastedsecrets.js";
import { body } from "./routeinput.js";
import { rows, type BotRecord, type UserRecord } from "./store.js";

const FR: Record<string, string> = {
  "That is not a form.": "Ce n'est pas un formulaire.",
  "This form was already answered.": "Ce formulaire a déjà une réponse.",
};
const say = (loc: string | undefined, msg: string) => (loc === "fr" ? FR[msg] ?? msg.replace(/^“(.+)” is needed\.$/, "« $1 » est à remplir.").replace(/^“(.+)” must be a number\.$/, "« $1 » doit être un nombre.").replace(/^“(.+)”: pick one of the options\.$/, "« $1 » : choisis une des options.") : msg);

export function registerViewRoutes(api: Hono<any>, ownBot: (c: Context) => BotRecord) {
  const cardOf = (c: Context, bot: BotRecord) => {
    const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
    return row && row.body.kind === "card" && row.body.card.type === "view" ? { row, card: row.body.card } : null;
  };
  api.post("/bots/:id/cards/:seq/view", async (c) => {
    const bot = ownBot(c);
    const user = c.get("user") as UserRecord;
    const found = cardOf(c, bot);
    if (!found || !found.card.blocks.some((b) => b.kind === "form")) return c.json({ error: say(user.locale, "That is not a form.") }, 400);
    if (found.card.status !== "pending") return c.json({ error: say(user.locale, "This form was already answered.") }, 409);
    const a = formAnswer(found.card, (await body(c)).values);
    if ("error" in a) return c.json({ error: say(user.locale, a.error) }, 400);
    const screened = screenSecrets(a.text, user.locale);
    const thread = found.row.thread ?? 0;
    rows.updateCard(bot, found.row.generation, found.row.seq, (k) => (k.type === "view" ? { ...k, status: "answered", answer: screened.text } : k));
    rows.append(bot, { kind: "message", role: "user", text: screened.text }, thread);
    if (screened.secrets.length) holdAndOffer(bot, user.id, screened.secrets, thread);
    submitUserMessage(bot, `(Answering your view "${found.card.title}")\n${screened.text}`, false, [], undefined, thread);
    return c.json({ ok: true });
  });
  api.post("/bots/:id/cards/:seq/view/dismiss", (c) => {
    const bot = ownBot(c);
    const found = cardOf(c, bot);
    if (found?.card.status === "pending") rows.updateCard(bot, found.row.generation, found.row.seq, (k) => (k.type === "view" ? { ...k, status: "dismissed" } : k));
    return c.json({ ok: true });
  });
}
