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
  // Demo stand-in for a real analysis: "analyse"/"analyze" makes it find a (made-up) high-scoring lead.
  if (/\b(analyse|analyze|analyser|analysis)\b/.test(lower)) {
    const fr = /[àâçéèêëîïôûùüÿœ]/.test(lower) || /\b(analyse|analyser|mes|mon|ma)\b/.test(lower);
    return call("celebrate", fr
      ? { kind: "lead", score: 93, evidence: "démo : 3 visites de la page de prix en 24 h, entreprise de 40 personnes, demande de devis", value: "≈ 6 000 €/an", reason: quoted ?? "un nouveau lead très chaud" }
      : { kind: "lead", score: 93, evidence: "demo: 3 visits to the pricing page in 24 h, company of 40 people, asked for a quote", value: "≈ $6,000/yr", reason: quoted ?? "a very hot new lead" });
  }
  // Built-in mail accounts: "check my mail", "réponds au dernier e-mail"… searches the first mailbox it has.
  if (/\b(e-?mails?|mails?|inbox|courriels?)\b/.test(lower)) {
    const tool = mailTool(has, lower);
    if (tool) return call(tool, { query: quoted ?? "", max: 5 });
  }
  if (/\b(video|vidéo|clip)\b/.test(lower)) return call("video_generate", { prompt: quoted ?? (text.replace(/^.*?\b(video|vidéo|clip)\b\s*(of|de|d'|sur)?/i, "").trim() || "a calm sunrise over the sea"), duration_seconds: 4, aspect_ratio: "16:9", filename: "demo-video" });
  if (/\b(react|réagis|reaction|réaction)\b/.test(lower)) return call("message_react", { emoji: "👍" });
  if (/\b(ask me|demande-moi|question)\b/.test(lower)) return call("ask_user", { question: "Which format would you like?", options: ["Short summary", "Detailed report", "Bullet list"] });
  return null;
}

/** The first mailbox's search tool (<app>_<label>__mail_search), preferring the label named in the text. */
let demoTools: string[] = [];
function mailTool(has: (name: string) => boolean, lower: string): string | null {
  const all = demoTools.filter((n) => n.endsWith("__mail_search") && has(n));
  return all.find((n) => lower.includes(n.split("__")[0].split("_").slice(1).join(" "))) ?? all[0] ?? null;
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
    demoTools = req.tools.map((t) => t.name);
    let content: Block[];
    // After a mail search, when the user asked for a reply: draft one and send it (the user is asked first).
    const prev = req.messages[req.messages.length - 2];
    const searched = prev?.role === "assistant" ? prev.content.find((b) => b.type === "tool_use" && b.name.endsWith("__mail_search")) : undefined;
    const asked = [...req.messages].reverse().find((x) => x.role === "user" && x.content.some((b) => b.type === "text" && !b.text.startsWith("[What follows")));
    const askedText = asked?.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").toLowerCase() ?? "";
    const found = results.map((r) => (r.type === "tool_result" ? r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n") : "")).join("\n");
    if (searched && searched.type === "tool_use" && /\b(reply|answer|réponds|répondre|réponse)\b/.test(askedText) && /From: /.test(found)) {
      const to = /From: [^\n]*?<([^>\s]+@[^>\s]+)>/.exec(found)?.[1] ?? /From: ([^\s]+@[^\s]+)/.exec(found)?.[1] ?? "";
      const id = /- id (\S+)/.exec(found)?.[1];
      const subject = /Subject: ([^\n]*)/.exec(found)?.[1]?.trim() ?? "";
      const fr = /Write to the user in French/.test(req.system);
      const sendTool = searched.name.replace(/__mail_search$/, "__mail_send");
      if (to && req.tools.some((t) => t.name === sendTool)) {
        content = [
          { type: "text", text: fr ? `J'ai trouvé l'e-mail « ${subject} ». Je prépare une réponse — je te demande avant de l'envoyer.` : `I found “${subject}”. I'm replying — I'll ask you before it goes out.` },
          { type: "tool_use", id: `demo_${Date.now()}`, name: sendTool, input: { to, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, body: fr ? "Bonjour,\n\nMerci pour votre message, c'est bien noté. Je reviens vers vous très vite.\n\nBien à vous" : "Hello,\n\nThanks for your message, noted. I'll get back to you shortly.\n\nBest regards", ...(id ? { reply_to_id: id } : {}) } },
        ];
        for (const word of (content[0] as { text: string }).text.split(/(?<=\s)/)) { req.onText?.(word); await sleep(18); }
        return { content, stopReason: "tool_use", model: "demo", usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 } };
      }
    }
    if (!req.tools.length && /recorded demonstration/.test(req.system)) {
      // "Show me how": a skill drafted from the recorded timeline (the demo cannot look at the screenshots).
      const timeline = texts.join("\n").split("\n").filter((l) => /^\d\d:\d\d (clicked|double-clicked|right-clicked|typed|pressed|scrolled|dragged|opened|page:)/.test(l)).slice(0, 12);
      const fr = /Write in French/.test(texts.join(" "));
      const steps = timeline.length ? timeline.map((l) => l.slice(6)) : [fr ? "Refaire les gestes montrés à l'écran" : "Repeat what was shown on the screen"];
      content = [{ type: "text", text: JSON.stringify(fr
        ? { name: "Procédure montrée", when: "Quand on me demande de refaire ce que tu m'as montré", steps: steps.map((x) => `Démo : ${x}`) }
        : { name: "Demonstrated procedure", when: "When asked to do again what you showed me", steps: steps.map((x) => `Demo: ${x}`) }) }];
    } else if (!req.tools.length) {
      content = [{ type: "text", text: '{"facts": []}' }];
    } else if (results.length && !texts.length) {
      const failed = results.some((r) => r.type === "tool_result" && r.isError);
      const detail = results.map((r) => (r.type === "tool_result" ? r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join(" ") : "")).join(" ").slice(0, 400);
      const fr = /Write to the user in French/.test(req.system);
      const cheered = /The user saw you celebrate/.test(detail);
      content = [{ type: "text", text: failed ? `That did not work: ${detail}` : cheered ? (fr ? "Youhou ! En analysant tes données, je tiens une vraie pépite : un lead très chaud (93/100). Il a vu ta page de prix 3 fois en 24 h et demande un devis — je te propose de le rappeler aujourd'hui." : "Woohoo! While analysing your data I found a real gem: a very hot lead (93/100). They viewed your pricing page 3 times in 24 h and asked for a quote — I suggest calling them today.") : `Done. ${detail}` }];
    } else {
      content = plan(said, (name) => req.tools.some((t) => t.name === name)) ?? [{
        type: "text",
        text: /Write to the user in French/.test(req.system)
          ? `Ceci est le mode démo : je suis des mots-clés, je ne réfléchis pas. Tu as dit : « ${said.slice(0, 200)} ».\n\nEssaie : **open https://example.com**, **remember "je préfère les réponses courtes"**, **run "ls -la"**, **save "une note"**, **routine**, **task "Appeler la banque"**, **analyse mes ventes** ou **question**. Ajoute une clé de modèle dans .env pour avoir un vrai coéquipier.`
          : `This is demo mode, so I am following keywords rather than thinking. You said: “${said.slice(0, 200)}”.\n\nTry: **open https://example.com**, **remember "I prefer short answers"**, **run "ls -la"**, **save "a note"**, **set up a routine**, **add a task "Call the bank"**, **analyze my sales**, or **ask me a question**. Add a model key to .env to get a real teammate.`,
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
