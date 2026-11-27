import { emit, setLive } from "../bus.js";
import { workspaceOf } from "../computer.js";
import { tr } from "../i18n.js";
import { linuxScreen } from "../linux.js";
import type { ToolSpec } from "../llm/types.js";
import { audit, bots, clip, newId, rows } from "../store.js";
import { hideValue, resolveRef, snapshotUrl } from "./elements.js";
import { tell } from "./loop.js";
import type { BuiltinTool } from "./tools.js";

/**
 * L91 — « case masquée » (CopilotKit / OpenBot audit: "ask for ONE value typed in a hidden box that goes straight into
 * the page's field"; our own code). The bot is on a page that asks for a one-time code (SMS, authenticator app, e-mail
 * code it cannot read): code_request names the field by its reference; the user gets a card with a hidden box; what
 * they type goes from the server into that field, and:
 *  - the bot never sees it: the tool's answer says only whether it was typed and read back; the field's value is hidden
 *    in every later listing of the page (elements.ts hideValue); the page is NOT read back in words after typing;
 *  - it is never kept: not in the card, the chat, the activity log or the database (only "typed" / "failed");
 *  - it goes only where it was asked for: the same tab, the same page and site as the bot's snapshot when it asked
 *    (the helper refuses a stale reference; the site is checked again right before typing), and only into a text field
 *    of the page itself (not a frame of another site: that needs ask_takeover);
 *  - the bot waits (10 minutes at most), like ask_takeover. Limit: a screenshot taken later can still show the field's
 *    characters if the page displays them (one-time codes expire quickly).
 */
export const CODE_WAIT_MS = () => (Number(process.env.CODE_WAIT_MS) > 0 ? Number(process.env.CODE_WAIT_MS) : 10 * 60_000);
const CODE_FORMAT = /^[A-Za-z0-9 -]{1,16}$/;
const TYPABLE = /^(textbox|searchbox|spinbutton|combobox)$/;

type Answer = { code: string } | { dismissed: true } | { timeout: true } | { stopped: true };
const waiting = new Map<string, { botId: string; resolve: (a: Answer) => void }>();

/** The user's answer on the card: the code (typed into the field by the waiting tool) or "I don't have it". */
export function answerCode(botId: string, codeId: string, answer: { code?: unknown; dismiss?: unknown }): "ok" | "gone" | "bad" {
  const w = waiting.get(codeId);
  if (!w || w.botId !== botId) return "gone";
  if (answer.dismiss === true) { w.resolve({ dismissed: true }); return "ok"; }
  const code = String(answer.code ?? "").trim();
  if (!CODE_FORMAT.test(code)) return "bad";
  w.resolve({ code });
  return "ok";
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });

export const codeTools: BuiltinTool[] = [{
  spec: {
    name: "code_request",
    description: "Ask the user for a one-time code (SMS, authenticator app, an email you cannot read) that a field of the page in front of your browser needs. Give the field's reference: they type the code into a hidden box on a card and it goes straight into that field. You never see the code. You wait (up to 10 minutes); then click the page's own button to confirm (element_click).",
    inputSchema: obj({ ref: { type: "string", description: "The code field's reference from your latest element_snapshot, e.g. 3f9a.7" }, detail: { type: "string", description: "What the code is for, in one sentence (e.g. the bank's SMS code to sign in)" } }, ["ref", "detail"]),
  },
  activity: "waiting", label: "Waiting for a code from you", group: "computer",
  run: async (a, c) => {
    const found = resolveRef(c.bot.id, a.ref);
    if ("error" in found) return { content: found.error, isError: true, summary: "no such element" };
    if (found.element.frameTarget) return { content: "That field is inside a frame of another site: ask the user to type the code themselves with ask_takeover (reason 2fa).", isError: true, summary: "frame" };
    if (!TYPABLE.test(found.element.role)) return { content: `That element is a ${found.element.role}, not a text field: give the reference of the field where the code goes.`, isError: true, summary: "not a field" };
    const site = host(snapshotUrl(c.bot.id));
    const codeId = newId("code");
    const detail = clip(String(a.detail ?? "").trim(), 300);
    const card = rows.append(c.bot, { kind: "card", card: { type: "code", codeId, label: clip(found.element.name || found.element.role, 80), host: site, detail, status: "pending", expiresAt: Date.now() + CODE_WAIT_MS() } });
    bots.bumpUnread(c.bot.id);
    const loc = c.user.locale;
    setLive(c.user.id, c.bot.id, { running: true, activity: { kind: "waiting", since: Date.now() }, awaiting: { reason: tr(loc, "Needs a code from you"), since: Date.now() } });
    tell({ type: "waiting", bot: c.bot, text: `${tr(loc, "Needs a code from you")}${detail ? ` — ${detail}` : ""}` });
    emit(c.user.id, { type: "tasks", botId: c.bot.id });
    const answer = await new Promise<Answer>((resolve) => {
      const done = (x: Answer) => { clearTimeout(timer); c.signal.removeEventListener("abort", onAbort); waiting.delete(codeId); resolve(x); };
      const onAbort = () => done({ stopped: true });
      const timer = setTimeout(() => done({ timeout: true }), CODE_WAIT_MS());
      if (c.signal.aborted) return done({ stopped: true });
      c.signal.addEventListener("abort", onAbort, { once: true });
      waiting.set(codeId, { botId: c.bot.id, resolve: done });
    });
    const settle = (status: "typed" | "failed" | "dismissed" | "timeout" | "stopped") => {
      rows.updateCard(c.bot, card.generation, card.seq, (k) => (k.type === "code" ? { ...k, status } : k));
      setLive(c.user.id, c.bot.id, { running: true, awaiting: null, activity: { kind: "thinking", since: Date.now() } });
      emit(c.user.id, { type: "tasks", botId: c.bot.id });
    };
    if ("stopped" in answer) { settle("stopped"); return { content: "Stopped while waiting for the code.", isError: true, summary: tr(loc, "stopped") }; }
    if ("timeout" in answer) { settle("timeout"); return { content: "The user did not give the code within 10 minutes. Do not try to get past this step yourself: tell them where things stand.", isError: true, summary: tr(loc, "no answer") }; }
    if ("dismissed" in answer) { settle("dismissed"); return { content: "The user does not have the code (they dismissed the card). Ask them what to do, or use ask_takeover so they finish this step themselves.", isError: true, summary: tr(loc, "no code") }; }
    // Right before typing: still the same site as when the bot asked (the helper checks the same tab and document).
    if (host(snapshotUrl(c.bot.id)) !== site) { settle("failed"); return { content: "The page changed since you asked for the code: nothing was typed. Take a new element_snapshot and ask again.", isError: true, summary: "page changed" }; }
    const r = await linuxScreen.elementAct(c.bot.id, c.user.id, workspaceOf(c.bot.id), { ...found.req, action: "type", text: answer.code, clear: true }).then((x) => x.answer).catch((err: Error) => ({ ok: false, error: err.message } as { ok?: boolean; error?: string; stale?: string; verified?: boolean | null; typed?: { verified: boolean | null } }));
    if (!r.ok) {
      settle("failed");
      audit(c.user.id, "system", `${c.bot.name}: a code from the hidden box could not be typed on ${site}`, c.bot.id);
      // The helper's words about the page only (never the value).
      return { content: `The code could not be typed (${clip(String(r.stale ?? r.error ?? "the field refused it"), 160)}). Nothing else was done. Take a new element_snapshot and ask again if the field is still there.`, isError: true, summary: "not typed" };
    }
    hideValue(c.bot.id, a.ref);
    settle("typed");
    audit(c.user.id, "system", `${c.bot.name}: a code was typed from the hidden box on ${site} (never shown to the bot)`, c.bot.id);
    const verified = r.typed?.verified ?? r.verified ?? null;
    return { content: `The user's code was typed into “${clip(found.element.name || found.element.role, 60)}” on ${site}${verified === true ? " (read back: the field holds it)" : verified === false ? " (NOT confirmed by reading the field back)" : ""}. You did not see it and never will. Now click the page's button to confirm (element_click), then look at the result.`, summary: tr(loc, "code typed") };
  },
}];
