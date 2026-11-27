import { readFileSync } from "node:fs";
import { workspaceOf } from "../computer.js";
import { tr } from "../i18n.js";
import { linuxExec } from "../linux.js";
import { rows } from "../store.js";
import { CRAFT_RUN_DIR, craftRounds, craftRunNotice, parseCraftRun } from "./craft-run.js"; import { noteCraftUpdate } from "./creationplus.js"; import { sendOwnerAnswer } from "./craft-relay.js";
import { userWordsFor } from "./grounding.js";
import type { BuiltinTool } from "./tools.js";

/** The install script with its guard (clean-room mode only, kept output), as run in the bot's computer. */
export const craftInstallScript = () => readFileSync(new URL("../../../docker/desktop/install-craft.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const quoted = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export const craftReady: BuiltinTool = {
  spec: {
    name: "craft_workspace",
    description: "Prepare the built-in Craft Anything CLI on this bot's Linux computer for a clean-room design study or a web build, and get the exact rebuild command. New desktops already have it. No third-party model key is needed for the bot's own connected Codex subscription. Check rounds (a resemblance score) are only allowed for the owner's own site: pass own_site_quote, the owner's exact words saying the reference is their site. After a rebuild, call this tool again with report: true so the owner sees what the builder decided on its own.",
    inputSchema: {
      type: "object",
      properties: {
        reference_url: { type: "string", description: "The public page to study, if any (http or https)." },
        own_site_quote: { type: "string", description: "The owner's exact words, copied from their own message, saying the reference is their own site. Leave empty otherwise." },
        report: { type: "boolean", description: "After a rebuild: read what Craft Anything decided on its own and how alike the result is, and show it to the owner." },
        relay_answer: { type: "boolean", description: "After your owner answered a question Craft Anything asked during a rebuild (you asked them with ask_user): pass it on. Their own latest message is sent, never your words." },
      },
    },
  },
  group: "shell", activity: "shell", label: "Preparing the design workspace",
  run: async (args, ctx) => {
    void noteCraftUpdate(ctx.bot, ctx.thread).catch(() => {}); // L158: a newer Craft Anything is announced once, never installed (creationplus.ts)
    if (args.relay_answer === true) {
      // L23: the owner's own answer goes into the waiting rebuild (craft-relay.ts).
      const r = await sendOwnerAnswer(ctx.bot, ctx.thread ?? 0, ctx.signal);
      if (!r.ok) return { isError: true, content: r.error };
      return { content: `Sent to Craft Anything: "${r.sent}" (for: ${r.ask.title}). It goes on; you will be told if it asks again or when the background job ends.`, summary: tr(ctx.user.locale, "Answer passed to Craft Anything") };
    }
    if (args.report === true) {
      // The newest kept output of a rebuild (install-craft.sh guard), its end only (questions and checks come late).
      const read = await linuxExec(ctx.bot.id, ctx.user.id, workspaceOf(ctx.bot.id), ["sh", "-c", `f=$(ls -1t ${CRAFT_RUN_DIR}/*.log 2>/dev/null | head -n 1); [ -n "$f" ] && tail -c 200000 "$f"`], 30, { signal: ctx.signal, maxBytes: 250_000 });
      if (read.code !== 0 || !read.stdout.trim()) return { isError: true, content: "No Craft Anything rebuild output was found on this computer. Run the rebuild first." };
      const run = parseCraftRun(read.stdout);
      const notice = craftRunNotice(run, ctx.user.locale);
      // Shown to the owner by the server itself, whatever the bot says next.
      if (notice) rows.append(ctx.bot, { kind: "notice", tone: "info", text: notice }, ctx.thread || undefined);
      const best = run.checks.filter((c) => c.similarity !== null).at(-1);
      return {
        content: `Rebuild report: ${run.answered.length} question(s) answered automatically, ${run.refused.length} approval(s) refused automatically${best ? `, ${Math.round(best.similarity!)}% alike after check ${best.round}` : ", no resemblance score"}. ${run.end || "No end line."}${notice ? " The owner has been shown this list in the chat; offer to redo any choice they disagree with." : ""}`,
        summary: tr(ctx.user.locale, "{n} choices made automatically", { n: String(run.answered.length + run.refused.length) }),
      };
    }
    const result = await linuxExec(ctx.bot.id, ctx.user.id, workspaceOf(ctx.bot.id), ["sh", "-c", craftInstallScript()], 200, { signal: ctx.signal, maxBytes: 2000 });
    if (result.code !== 0) return { isError: true, content: "The design workspace could not be prepared. " + result.stderr.slice(-300) };
    const reference = typeof args.reference_url === "string" ? args.reference_url.trim() : "";
    const policy = craftRounds(reference || undefined, typeof args.own_site_quote === "string" ? args.own_site_quote : undefined, userWordsFor(ctx.bot, ctx.thread ?? 0));
    const target = policy.host ? quoted(reference) : "-";
    const rounds = policy.rounds > 0 ? `--rounds ${policy.rounds}` : "--rounds 0";
    // L23: the owner follows this work (their own message): questions are relayed to them live; otherwise --unattended
    // and the after-the-fact list (owner decision n° 15 still open on the default).
    const live = ctx.origin === "user" || ctx.origin === "member" || ctx.origin === "resume";
    const mode = live ? "" : " --unattended";
    const relayNote = live ? " The builder may ask questions while it works: each one is relayed to you as a message; ask your owner with ask_user and pass their answer with craft_workspace relay_answer: true. Never answer for them." : "";
    return {
      content: `Craft Anything 0.6.1 is ready at /usr/local/bin/craft-anything-cli, locked in clean-room mode (--deep and deep_mode are refused). For a requested web rebuild on the bot's connected Codex account run, as a background job: craft-anything-cli rebuild --backend Codex --build-with 'Plain HTML and CSS' ${rounds}${mode} --project-folder /root/files/<new folder> -- ${target} '<what to make>'.${relayNote} ${policy.rounds > 0 ? `Check rounds are allowed: ${policy.host} is the owner's own site.` : `No check rounds (${policy.why}).`} Request a self-contained app/index.html. Check the exit status, then call craft_workspace with report: true (the owner must see what was chosen automatically), then use artifact_from_file. For ordinary artifacts create directly with artifact_create.`,
    };
  },
};
