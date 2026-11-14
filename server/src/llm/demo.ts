import type { Block, LlmProvider, TurnRequest, TurnResult } from "./types.js";

/**
 * A model-free stand-in, switched on with DEMO_MODE=1. It costs nothing and lets you try the whole
 * app — streaming, tools, approvals, cards, routines — before adding a real model key.
 * It follows a few keywords; it does not understand language.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function plan(text: string, has: (name: string) => boolean): Block[] | null {
  const call = (name: string, input: Record<string, unknown>): Block[] | null =>
    has(name) ? [{ type: "tool_use", id: `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, input }] : null;
  const url = /https?:\/\/\S+/.exec(text)?.[0];
  const quoted = /"([^"]+)"/.exec(text)?.[1];
  const lower = text.toLowerCase();
  if (url && /\b(open|ouvre|visit|go to|va sur)\b/.test(lower)) return call("browser_open", { url });
  if (url) return call("web_fetch", { url });
  if (/\b(remember|retiens|souviens)\b/.test(lower)) return call("memory_save", { text: quoted ?? text.replace(/^.*?(remember|retiens|souviens[- ]toi)( that| que)?/i, "").trim() });
  if (/\b(run|lance|exécute|execute)\b/.test(lower) && quoted) return call("shell_run", { command: quoted });
  if (/\b(save|enregistre|sauvegarde)\b/.test(lower)) return call("file_save", { filename: "demo-note.md", content: `# Demo note\n\n${quoted ?? text}\n` });
  if (/\b(every day|chaque jour|tous les jours|routine)\b/.test(lower)) return call("routine_create", { name: "Daily brief", prompt: "Give a short summary of what is open today.", kind: "cron", schedule: "0 9 * * 1-5", timezone: "Europe/Paris" });
  if (/\b(task|tâche)\b/.test(lower)) return call("task_add", { title: quoted ?? "Demo task" });
  if (/(pépite|pepite|diamant|diamond|\bgem\b|nugget|jackpot)/.test(lower)) return call("celebrate", { reason: quoted ?? (/[àâçéèêëîïôûùüÿœ]|pépite|diamant/.test(lower) ? "une pépite pour la démo" : "a gem for the demo") });
  if (/\b(ask me|demande-moi|question)\b/.test(lower)) return call("ask_user", { question: "Which format would you like?", options: ["Short summary", "Detailed report", "Bullet list"] });
  return null;
}

export class DemoProvider implements LlmProvider {
  readonly id = "demo";
  readonly label = "Demo (no model)";
  readonly models = ["demo"];
  available(): boolean {
    return process.env.DEMO_MODE === "1";
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    const results = last.content.filter((b) => b.type === "tool_result");
    const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
    let content: Block[];
    if (!req.tools.length) {
      content = [{ type: "text", text: '{"facts": []}' }];
    } else if (results.length && !texts.length) {
      const failed = results.some((r) => r.type === "tool_result" && r.isError);
      const detail = results.map((r) => (r.type === "tool_result" ? r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join(" ") : "")).join(" ").slice(0, 400);
      const fr = /Write to the user in French/.test(req.system);
      const cheered = /The user saw you celebrate/.test(detail);
      content = [{ type: "text", text: failed ? `That did not work: ${detail}` : cheered ? (fr ? "Youhou ! Une vraie pépite — c'est rare, je te la garde de côté." : "Woohoo! A real gem — that's rare, I'm keeping it for you.") : `Done. ${detail}` }];
    } else {
      content = plan(said, (name) => req.tools.some((t) => t.name === name)) ?? [{
        type: "text",
        text: /Write to the user in French/.test(req.system)
          ? `Ceci est le mode démo : je suis des mots-clés, je ne réfléchis pas. Tu as dit : « ${said.slice(0, 200)} ».\n\nEssaie : **open https://example.com**, **remember "je préfère les réponses courtes"**, **run "ls -la"**, **save "une note"**, **routine**, **task "Appeler la banque"**, **pépite** ou **question**. Ajoute une clé de modèle dans .env pour avoir un vrai coéquipier.`
          : `This is demo mode, so I am following keywords rather than thinking. You said: “${said.slice(0, 200)}”.\n\nTry: **open https://example.com**, **remember "I prefer short answers"**, **run "ls -la"**, **save "a note"**, **set up a routine**, **add a task "Call the bank"**, **gem**, or **ask me a question**. Add a model key to .env to get a real teammate.`,
      }];
    }
    for (const b of content) {
      if (b.type !== "text") continue;
      for (const word of b.text.split(/(?<=\s)/)) {
        if (req.signal?.aborted) throw new Error("aborted");
        req.onText?.(word);
        await sleep(18);
      }
    }
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "demo", usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 } };
  }
}
