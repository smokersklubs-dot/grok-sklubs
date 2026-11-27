import { committingKind, seenTarget } from "./bind.js";
import { actionKind, normalize } from "./grounding.js";
import type { Turn } from "./loop.js";

/**
 * Whether an action cannot be undone once it runs: a message or an email sent, a payment, a deletion, a page published,
 * a form confirmed, a booking. Shown on the approval card ("Action irréversible : …"), and such a card never offers
 * "Always": every irreversible action needs its own yes (decideApproval counts "Always" on a `once` card as once).
 *
 * Decided by the server from what it knows itself, never from what the model says about its own call:
 *  - built-in tools: a fixed list, refined by the arguments that change what happens (a page's visibility, an API
 *    call's method, a command's words);
 *  - clicks: the words of the control under the click, read by the server in the page (bind.ts, `seen_target`);
 *  - built-in app actions: the action itself (mail_send, slack_post, calendar_delete…);
 *  - connector tools (URL or command): the tool's name, plus the server's `destructiveHint` annotation. Annotations come
 *    from a server we do not control, and the MCP specification says clients must not make tool-use decisions based on
 *    annotations from untrusted servers (https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool —
 *    ToolAnnotations): here a hint can only ADD the warning, never remove one or let anything through.
 *
 * `reason`: an English template, translated with tr() where it is shown.
 */
export type IrreversibleKind = "send" | "pay" | "delete" | "publish" | "submit" | "book" | "destructive" | "command";
export interface Irreversible { kind: IrreversibleKind; reason: string }

export const IRREVERSIBLE_REASONS: Record<IrreversibleKind, string> = {
  send: "a message or an email cannot be taken back once it is sent.",
  pay: "a payment cannot be undone from here.",
  delete: "what is deleted cannot be recovered.",
  publish: "once it is published, others can see it right away.",
  submit: "a confirmed form cannot be withdrawn.",
  book: "a booking commits you as soon as it is made.",
  destructive: "the app says this action may change or erase data for good.",
  command: "this command deletes or overwrites data with no way back.",
};

const of = (kind: IrreversibleKind): Irreversible => ({ kind, reason: IRREVERSIBLE_REASONS[kind] });

/** Words of a "submit" control that commit a form (confirm, submit, sign), as opposed to merely saving it. */
const COMMIT_WORDS = ["confirmer", "valider", "soumettre", "signer", "confirm", "submit", "sign"];

/**
 * Shell commands that delete or overwrite for good. Matched as whole commands (at the start, or after ; & | ( or `),
 * so "firmware" or "--format" do not count. A heuristic: it adds a warning, it never lets a command through.
 */
export const DESTRUCTIVE_COMMAND = [ // also the base of the Relais command floor (relayguard.ts, companion guard.js)
  /(^|[;&|(`]|\$\()\s*(sudo\s+)?(rm|rmdir|shred|unlink|wipefs|mkfs(\.\w+)?|dd|truncate|del|erase|rd|format|remove-item|srm)\b/i,
  /\bgit\s+(push\b[^;&|]*\s(--force\b|-f\b|--delete\b)|reset\s+--hard\b|clean\s+-\w*f)/i,
  /\b(drop\s+(table|database|schema)|delete\s+from|truncate\s+table)\b/i,
  /\bcurl\b[^;&|]*\s-X\s*DELETE\b/i,
  /\bfind\b[^;&|]*\s-delete\b/i,
];
/** L47 (mattpocock audit): a forced branch deletion loses its unmerged commits. Kept apart from DESTRUCTIVE_COMMAND, whose list the Relais mirrors (its own "git" floor already has it). */
export const BRANCH_DELETE = /\bgit\s+branch\b[^;&|]*\s(?:-D\b|--delete\s+(?:[^;&|]*\s)?--force\b|--force\s+(?:[^;&|]*\s)?--delete\b|-d\s+(?:[^;&|]*\s)?(?:-f|--force)\b|-[a-zA-Z]*D[a-zA-Z]*\b)/;
export const destructiveCommand = (command: string) => DESTRUCTIVE_COMMAND.some((re) => re.test(command)) || BRANCH_DELETE.test(command);

/** The irreversibility of a name-described action (a built-in app action, a connector tool, an API path). */
function byName(name: string): Irreversible | null {
  switch (actionKind(name)) {
    case "pay": return of("pay");
    case "delete": return of("delete");
    case "send": case "post": return of("send");
    case "publish": return of("publish");
    default: return null;
  }
}

export function irreversibility(turn: Pick<Turn, "builtin" | "remote">, name: string, input: Record<string, unknown> = {}): Irreversible | null {
  if (name === "screen_click" || name === "element_click") {
    const seen = seenTarget(input);
    const kind = seen ? committingKind(seen.label) : null;
    if (!seen || !kind) return null;
    if (kind === "pay" || kind === "delete" || kind === "publish" || kind === "send") return of(kind);
    if (kind === "calendar") return of("book");
    if (kind === "submit") { const n = ` ${normalize(seen.label)} `; return COMMIT_WORDS.some((w) => n.includes(` ${w} `)) ? of("submit") : null; }
    return null;
  }
  if (name === "browser_dialog") {
    // OK on a page's question (tools-browser.ts): its words, read by the server (bind.ts, `seen_dialog`), as for a click.
    const d = input.seen_dialog as { type?: string; message?: string } | null | undefined;
    const kind = input.action === "accept" && d && d.type !== "alert" ? committingKind(String(d.message ?? "")) : null;
    return kind === "pay" || kind === "delete" || kind === "publish" || kind === "send" ? of(kind) : kind === "calendar" ? of("book") : kind === "submit" ? of("submit") : null;
  }
  const remote = turn.remote.get(name);
  if (remote) {
    if (remote.native) return remote.native.risk === "read" ? null : byName(remote.remoteName);
    if (remote.readOnly) return null;
    if (/^make_(?:conversation_)?call$/i.test(remote.remoteName)) return { kind: "send", reason: "placing this phone call contacts the recipient and may incur a charge." };
    if (/^COMPOSIO_(?:MULTI_EXECUTE_TOOL|REMOTE_(?:BASH_TOOL|WORKBENCH))$/i.test(remote.remoteName)) return { kind: "destructive", reason: "this tool can run actions in your connected accounts." };
    return byName(remote.remoteName) ?? (remote.destructive ? of("destructive") : null);
  }
  if (!turn.builtin.has(name)) return null;
  switch (name) {
    case "bot_email_send": return of("send");
    case "card_fill": return of("pay");
    case "routine_delete": return of("delete");
    case "page_publish": return input.visibility === "private" ? null : of("publish");
    case "api_send": {
      // DELETE deletes; a POST is judged by its path (/messages/send, /payments…); PUT and PATCH edit what exists.
      const method = String(input.method ?? "").toUpperCase();
      return method === "DELETE" ? of("delete") : method === "POST" ? byName(String(input.path ?? "").replace(/[^a-zA-Z0-9]+/g, "_")) : null;
    }
    case "shell_run": case "my_command": return destructiveCommand(String(input.command ?? "")) ? of("command") : null;
    default: return null;
  }
}
