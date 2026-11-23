/**
 * Recorded flows (L165) — the recorder. While the owner records a flow for a bot (flows.ts), each browser action the bot
 * does with its own tools is written down as a step: open an address, click (with the words of the control under the
 * point), type, press keys, scroll, read the page, click / type / choose on a page element (by its role and name, so it
 * can be found again on a fresh page). Only steps that worked are kept.
 *
 * Never recorded: a secret (vault_type, card_fill, a typed text that looks like a password, a key or a card number:
 * sensitive.ts), a file sent to a site (element_upload), a dialog answer, a download. The recording notes that such a
 * step happened, so the replay stops there and asks for the bot instead of guessing.
 *
 * A step is marked « engage » (commit) when replaying it could commit something: a click whose words commit (bind.ts
 * committingKind — pay, send, delete, order…), a control whose words were not readable, Enter, or a typed text sent
 * with submit. The replay asks the owner before each such step, every run (flows.ts).
 *
 * Portions adapted in idea only from agent-browser (record/replay of browser steps, Apache-2.0); written for Sklubot.
 */
import { q } from "../db.js";
import { clip, now } from "../store.js";
import { committingKind, seenTarget } from "./bind.js";
import { resolveRef } from "./elements.js";
import { looksSecret } from "./sensitive.js";
import type { BuiltinTool, ToolOutput } from "./tools.js";

q.run(`CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', recording INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  last_run_at INTEGER)`);
q.run("CREATE INDEX IF NOT EXISTS flows_user ON flows(user_id, created_at)");

export const FLOW_STEP_KINDS =["open", "click", "type", "key", "scroll", "read", "element_click", "element_type", "element_select", "blocked"] as const;
export type FlowStepKind = (typeof FLOW_STEP_KINDS)[number];
export interface FlowStep {
  kind: FlowStepKind;
  url?: string;
  x?: number; y?: number;
  /** The words of the control (a click) or the element's name. */
  label?: string;
  role?: string;
  host?: string;
  text?: string;
  keys?: string;
  dy?: number;
  option?: string;
  submit?: boolean;
  clear?: boolean;
  /** Replaying it could commit something: the owner is asked first, every run. */
  commit: boolean;
  /** The page's host after the step when it was recorded (checked on replay). */
  expectHost?: string;
  /** Words the page must contain after the step (the owner adds them). */
  expectText?: string;
  /** For a « blocked » step: why it cannot be replayed. */
  why?: string;
}

export const MAX_STEPS = 60;
const RECORDED = new Set(["browser_open", "screen_click", "screen_type", "screen_key", "screen_scroll", "page_read", "element_click", "element_type", "element_select"]);
const NEVER = new Map<string, string>([["vault_type", "a saved login was typed"], ["card_fill", "a payment card was filled in"], ["element_upload", "a file was sent to the site"], ["element_fill", "a form was filled in several fields at once"], ["browser_dialog", "a page's dialog was answered"], ["browser_download", "a download was saved"], ["screen_drag", "a drag"]]);

/** The flow each bot is recording, if any (one at a time per bot). Kept in SQLite: a restart keeps the recording. */
export const recording = {
  of: (botId: string) => q.get<{ id: string; steps: string }>("SELECT id, steps FROM flows WHERE bot_id = ? AND recording = 1", botId) ?? null,
};

const hostIn = (text: string) => { const m = /\bPage: .*? — (https?:\/\/\S+)/.exec(text) ?? /^(https?:\/\/\S+)$/m.exec(text); try { return m ? new URL(m[1]).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };
const outText = (o: ToolOutput) => (typeof o.content === "string" ? o.content : o.content.map((b) => (b.type === "text" ? b.text : "")).join("\n"));
const hostOfUrl = (u: unknown) => { try { return new URL(/^[a-z]+:/i.test(String(u)) ? String(u) : `https://${u}`).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** The step a tool call makes, or null when it is not a browser action (pure: the tests call it). */
export function stepOf(name: string, a: Record<string, any>, out: ToolOutput, element?: { role: string; name: string } | null): FlowStep | null {
  if (NEVER.has(name)) return { kind: "blocked", why: NEVER.get(name)!, commit: true };
  if (!RECORDED.has(name) || out.isError) return null;
  const after = hostIn(outText(out));
  const base = after ? { expectHost: after } : {};
  switch (name) {
    case "browser_open": return { kind: "open", url: clip(String(a.url ?? ""), 2000), commit: false, ...base, ...(after ? {} : { expectHost: hostOfUrl(a.url) }) };
    case "screen_click": {
      const seen = seenTarget(a);
      const label = seen?.label ?? "";
      return { kind: "click", x: Number(a.x), y: Number(a.y), label, host: seen?.host ?? "", commit: !label || !!committingKind(label), ...base };
    }
    case "screen_type": {
      const text = String(a.text ?? "");
      if (looksSecret(text)) return { kind: "blocked", why: "a secret was typed", commit: true };
      return { kind: "type", text: clip(text, 2000), commit: false, ...base };
    }
    case "screen_key": { const keys = String(a.keys ?? ""); return { kind: "key", keys, commit: /(^|\+)(enter|return)$/i.test(keys.trim()), ...base }; }
    case "screen_scroll": return { kind: "scroll", x: Number(a.x), y: Number(a.y), dy: (a.direction === "up" ? -1 : 1) * 120 * Math.max(1, Number(a.amount ?? 3)), commit: false, ...base };
    case "page_read": return { kind: "read", commit: false, ...base };
    case "element_click": case "element_type": case "element_select": {
      if (!element) return { kind: "blocked", why: "the element could not be named", commit: true };
      if (name === "element_type") {
        const text = String(a.text ?? "");
        if (looksSecret(text)) return { kind: "blocked", why: "a secret was typed", commit: true };
        return { kind: "element_type", role: element.role, label: element.name, text: clip(text, 2000), clear: a.clear === true, submit: a.submit === true, commit: a.submit === true, ...base };
      }
      if (name === "element_select") return { kind: "element_select", role: element.role, label: element.name, option: clip(String(a.option ?? ""), 200), commit: !!committingKind(String(a.option ?? "")), ...base };
      return { kind: "element_click", role: element.role, label: element.name, commit: !element.name || !!committingKind(element.name), ...base };
    }
  }
  return null;
}

export function appendStep(flowId: string, step: FlowStep) {
  const r = q.get<{ steps: string }>("SELECT steps FROM flows WHERE id = ?", flowId);
  if (!r) return;
  let steps: FlowStep[] = [];
  try { steps = JSON.parse(r.steps); } catch { steps = []; }
  if (steps.length >= MAX_STEPS) return;
  steps.push(step);
  q.run("UPDATE flows SET steps = ?, updated_at = ? WHERE id = ?", JSON.stringify(steps), now(), flowId);
}

/** Wraps a browser tool: after it ran, its step is added to the flow its bot is recording (nothing changes otherwise). */
export function recordable(t: BuiltinTool): BuiltinTool {
  if (!RECORDED.has(t.spec.name) && !NEVER.has(t.spec.name)) return t;
  return {
    ...t,
    run: async (a, c) => {
      const rec = recording.of(c.bot.id);
      // The element is named BEFORE the action (the action may replace the page's snapshot and its references).
      const found = rec && t.spec.name.startsWith("element_") ? resolveRef(c.bot.id, a.ref) : null;
      const out = await t.run(a, c);
      if (rec) {
        try {
          const step = stepOf(t.spec.name, a, out, found && !("error" in found) ? { role: found.element.role, name: found.element.name } : null);
          if (step) appendStep(rec.id, step);
        } catch (err) { console.error("[flow record]", (err as Error).message); }
      }
      return out;
    },
  };
}
