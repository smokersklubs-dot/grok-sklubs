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
  // The user's own computer (Sklubot Relais): "look at my screen", "run "ls" on my computer", "click 200 120 on my computer".
  if (/\b(my computer|my screen|my pc|mon ordinateur|mon ordi|mon écran|mon pc)\b/.test(lower)) {
    if (/\b(run|lance|exécute|execute)\b/.test(lower) && quoted) return call("my_command", { command: quoted });
    const at = /\b(\d{1,4})\D{1,3}(\d{1,4})\b/.exec(text);
    if (/\b(click|clique)\b/.test(lower) && at) return call("my_click", { x: Number(at[1]), y: Number(at[2]) });
    if (url && /\b(open|ouvre)\b/.test(lower)) return call("my_open", { url });
    if (/\b(stop|rends|release|give back)\b/.test(lower)) return call("my_release", {});
    return call("my_screen", { reason: quoted ?? (/[àâçéèêëîïôûùüÿœ]/.test(lower) || /\b(mon|ma|regarde)\b/.test(lower) ? "Voir ton écran pour t'aider." : "See your screen to help you.") });
  }
  // Wave 5: long research becomes a background task the user follows on a card.
  if (/\b(recherche approfondie|longue recherche|deep research|background task|tâche de fond|tache de fond)\b/.test(lower)) {
    const fr5 = /[àâçéèêëîïôûùüÿœ]/.test(lower) || /\b(une|sur|les|des)\b/.test(lower);
    const topic = quoted ?? (text.replace(/^.*?\b(recherche approfondie|longue recherche|deep research|background task|tâche de fond|tache de fond)\b\s*(sur|on|about|:)?/i, "").trim() || (fr5 ? "les concurrents" : "competitors"));
    return call("task_start", fr5 ? { title: `Recherche : ${topic}`.slice(0, 60), goal: `Fais une recherche approfondie sur ${topic} : sources, chiffres clés, comparaison. Rapport en 5 points.` } : { title: `Research: ${topic}`.slice(0, 60), goal: `Do deep research on ${topic}: sources, key figures, comparison. Report in 5 points.` });
  }
  // A long task (wave 4 demo): progress lines while it works, until the step limit stops it.
  if (/\b(long task|longue tâche|longue tache)\b/.test(lower)) return call("progress_update", { text: /[àâçéèêëîïôûùüÿœ]/.test(lower) ? "Je commence : 1 page lue sur 12." : "Starting: read 1 page of 12." });
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
  // Wave 3 stand-ins: the bot asks for the user's hand on its screen, for a secret, or makes a password.
  if (/\b(captcha|prends la main|take over|takeover)\b/.test(lower)) return call("ask_takeover", { reason: "captcha", detail: /[àâçéèêëîïôûùüÿœ]/.test(lower) || /\b(la|le|mon|ma)\b/.test(lower) ? "Un CAPTCHA bloque la connexion : coche la case « Je ne suis pas un robot », puis rends-moi la main." : "A CAPTCHA blocks the sign-in: tick “I am not a robot”, then hand the screen back." });
  if (/\b(api key|clé api|clé d'api|cle api|secret)\b/.test(lower)) return call("secret_request", { name: quoted ?? "Stripe API", reason: /[àâçéèêëîïôûùüÿœ]/.test(lower) || /\b(la|le|mon|ma|une)\b/.test(lower) ? "Pour lire tes derniers paiements et préparer le rapport mensuel." : "To read your latest payments for the monthly report.", host: "api.stripe.com" });
  if (/\b(password|mot de passe)\b/.test(lower)) return call("password_generate", { name: quoted ?? "Portail fournisseur", site: "portail.exemple.com", username: "moi@exemple.com", length: 20 });
  // Wave 4 stand-ins: search on X, a bot that creates a bot, the shared profile, a long task with progress lines.
  const fr = /[àâçéèêëîïôûùüÿœ]/.test(lower) || /\b(sur|le|la|les|un|une|mon|ma|crée|cherche)\b/.test(lower);
  if (/\b(x search|search x|sur x|twitter)\b/.test(lower)) return call("x_search", { query: quoted ?? (text.replace(/^.*?\b(x search|search x|sur x|twitter)\b\s*(for|pour|about|sur)?/i, "").trim() || "sklubot"), max_results: 10, sort: "recency" });
  if (/\b(create a bot|crée un bot|cree un bot|nouveau bot|new bot)\b/.test(lower)) return call("bot_create", fr
    ? { name: quoted ?? "Max", role: "Analyste SEO", instructions: "Tu suis le référencement du site chaque semaine : positions, pages qui montent, pages qui baissent. Tu résumes en 5 lignes.", look: { shape: "cat", color: "teal", accessory: "headset" }, model: "" }
    : { name: quoted ?? "Max", role: "SEO analyst", instructions: "Track the site's search rankings every week: positions, pages going up and down. Summarise in 5 lines.", look: { shape: "cat", color: "teal", accessory: "headset" }, model: "" });
  if (/\b(profile|profil)\b/.test(lower)) return call("profile_update", fr ? { timezone: "Europe/Paris", company: "SKLUBS", preferences: "Réponses courtes, en français, avec les chiffres d'abord." } : { timezone: "Europe/Paris", company: "SKLUBS", preferences: "Short answers, numbers first." });
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

/**
 * Wave 5 stand-ins: the automatic reviewer (allow / ask / deny from the rules' words), a quiet preparation pass (reads the
 * mail, then raises one nudge), the writing-style profile, and a background task's worker (a few steps, then a report).
 */
function demoWave5(req: TurnRequest, texts: string[], results: Block[]): Block[] | null {
  const fr = /French/.test(req.system) || /Write to the user in French/.test(req.system);
  const id = () => `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const prompt = texts.join("\n");
  if (req.system.includes("You review one action that an AI assistant wants to take")) {
    const rulesPart = (/Rules the user wrote[^\n]*\n([\s\S]*?)\n\nAction:/.exec(prompt)?.[1] ?? "").toLowerCase();
    const action = (/Action: ([\s\S]*?)\n\n/.exec(prompt)?.[1] ?? "").toLowerCase();
    const quoteOk = /found in a user message and within scope/.test(prompt);
    const toClient = /client/.test(action) && /client/.test(rulesPart);
    const french = /in French/.test(prompt);
    const decision = toClient && /(jamais|never)/.test(rulesPart) ? "ask" : quoteOk ? "allow" : /(jamais|never)/.test(rulesPart) && /send/.test(action) ? "ask" : "ask";
    const ruleOk = /camille/.test(rulesPart) && /camille/.test(action);
    const reason = decision === "allow"
      ? (ruleOk ? (french ? "Tu l'as demandé toi-même, et ta règle sur les devis de Camille le permet." : "You asked for it yourself, and your rule about Camille's quotes allows it.")
        : (french ? "Tu as demandé cette réponse toi-même, au bon destinataire, et aucune règle ne l'interdit." : "You asked for this reply yourself, to the right person, and no rule forbids it."))
      : (french ? "Ta règle demande de te consulter avant d'écrire à un client." : "Your rule says to ask you before writing to a client.");
    return [{ type: "text", text: JSON.stringify({ decision, reason }) }];
  }
  if (req.system.includes("You are preparing, quietly and in private")) {
    const mail = req.tools.find((t) => t.name.endsWith("__mail_search"));
    const french = /in French\.?/.test(req.system.split("Matters already raised")[0]);
    if (!results.length && mail) return [{ type: "tool_use", id: id(), name: mail.name, input: { query: "", max: 5 } }];
    const found = results.map((r) => (r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n") : "")).join("\n");
    const subject = /Subject: ([^\n]*devis[^\n]*)/i.exec(found)?.[1]?.trim() ?? /Subject: ([^\n]*)/.exec(found)?.[1]?.trim() ?? (french ? "Demande en attente" : "Request waiting");
    const from = /From: ([^<\n]*)</.exec(found)?.[1]?.trim() ?? "";
    return [{ type: "tool_use", id: id(), name: "nudge_raise", input: french
      ? { matter_key: `reponse:${subject}`, title: `${from || "Un contact"} attend ta réponse : « ${subject} »`, body: `Son e-mail est arrivé ce matin et reste sans réponse. J'ai préparé une réponse courte qui confirme le devis. Je l'envoie ?` }
      : { matter_key: `reply:${subject}`, title: `${from || "A contact"} is waiting for your answer: “${subject}”`, body: "Their email came in this morning and has no answer yet. I prepared a short reply confirming the quote. Shall I send it?" } }];
  }
  if (req.system.includes("You describe how a person writes, from samples")) {
    return [{ type: "text", text: fr || /\b(je|tu|merci|bonjour)\b/i.test(prompt)
      ? "- Tutoie ses proches, vouvoie les clients\n- Messages courts : 2 à 4 phrases\n- Commence par « Bonjour » ou le prénom, finit par « Merci ! » ou « Bonne journée »\n- Va droit au but, le chiffre ou la décision d'abord\n- Peu d'emoji, ponctuation simple\n- Écrit en français"
      : "- Informal with colleagues, formal with clients\n- Short messages: 2 to 4 sentences\n- Opens with “Hi” and the first name, signs off with “Thanks!”\n- Gets to the point: the number or decision first\n- Few emoji\n- Writes in English" }];
  }
  // A background task finished: its main conclusion, in one line.
  const finished = /Your background task "([^"]+)" is finished\.[^\n]*\n([\s\S]*?)\n\nTell the user/.exec(prompt);
  if (finished) {
    const first = finished[2].replace(/^(Rapport|Report)\s*:\s*/, "").split(/;\s*\d\)|\n/)[0].replace(/^1\)\s*/, "").trim();
    return [{ type: "text", text: fr || /Rapport/.test(finished[2]) ? `La tâche « ${finished[1]} » est terminée. En bref : ${first}… Le rapport complet est sur la carte.` : `The task “${finished[1]}” is done. In short: ${first}… The full report is on the card.` }];
  }
  // Right after starting a background task: one line to the user, the card does the rest.
  const prevMsg = req.messages[req.messages.length - 2];
  if (results.length && !texts.length && prevMsg?.role === "assistant" && prevMsg.content.some((b) => b.type === "tool_use" && b.name === "task_start") && !results.some((r) => r.type === "tool_result" && r.isError))
    return [{ type: "text", text: fr ? "C'est lancé en tâche de fond : tu peux suivre l'avancement sur la carte, l'arrêter ou lui répondre. Je te donne la conclusion dès qu'elle a fini." : "Started as a background task: follow it on the card, stop it or reply to it there. I'll give you the conclusion when it is done." }];
  const everything = req.messages.filter((m) => m.role === "user").flatMap((m) => m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text)).join("\n");
  if (everything.includes("[You are working on this as a background task") && !/^\[System notice\]/m.test(prompt.replace(/^(\[[^\]\n]*\]\n)+/, ""))) {
    const n = req.messages.filter((m) => m.role === "assistant" && m.content.some((b) => b.type === "tool_use")).length;
    const steps = Number(process.env.DEMO_TASK_STEPS ?? 8);
    const french = /recherche|Rapport/.test(everything);
    // Each step tracks a source it reads (results differ, so the loop guard sees progress).
    if (n < steps) return [{ type: "tool_use", id: id(), name: "task_add", input: { title: french ? `Lire la source ${n + 1}` : `Read source ${n + 1}` } }];
    return [{ type: "text", text: french ? "Rapport : 1) trois concurrents principaux ; 2) prix 20 à 30 % au-dessus des nôtres ; 3) aucun n'a d'appli mobile ; 4) avis clients moyens 3,9/5 ; 5) opportunité : une offre d'entrée de gamme." : "Report: 1) three main competitors; 2) prices 20-30% above ours; 3) none has a mobile app; 4) average reviews 3.9/5; 5) opportunity: an entry-level offer." }];
  }
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
    demoTools = req.tools.map((t) => t.name);
    let content: Block[];
    const wave5 = demoWave5(req, texts, results);
    if (wave5) {
      for (const b of wave5) if (b.type === "text") req.onText?.(b.text);
      if (wave5.some((b) => b.type === "tool_use") && !process.env.NODE_TEST_CONTEXT) await sleep(Number(process.env.DEMO_STEP_MS ?? 900));
      if (req.signal?.aborted) throw new Error("aborted");
      return { content: wave5, stopReason: wave5.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "demo", usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 } };
    }
    // After a mail search, when the user asked for a reply: draft one and send it (the user is asked first).
    const prev = req.messages[req.messages.length - 2];
    const searched = prev?.role === "assistant" ? prev.content.find((b) => b.type === "tool_use" && b.name.endsWith("__mail_search")) : undefined;
    const asked = [...req.messages].reverse().find((x) => x.role === "user" && x.content.some((b) => b.type === "text" && !b.text.startsWith("[What follows")));
    const askedText = asked?.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").toLowerCase() ?? "";
    const found = results.map((r) => (r.type === "tool_result" ? r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n") : "")).join("\n");
    if (searched && searched.type === "tool_use" && /\b(reply|answer|réponds|répondre|réponse)\b/.test(askedText) && /From: /.test(found)) {
      // The message from the person the user named, if any ("réponds à Camille"), else the first one.
      const named = /\b(?:[Rr]éponds?|[Rr]eponds?|[Rr]eply|[Aa]nswer)\s+(?:à|a|to)\s+([A-ZÀ-Ý][\p{L}-]+)/u.exec(asked?.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ") ?? "")?.[1]?.toLowerCase();
      const blocks = found.split(/\n(?=- id )/);
      const pick = (named && blocks.find((b) => b.toLowerCase().includes(named))) || found;
      const to = /From: [^\n]*?<([^>\s]+@[^>\s]+)>/.exec(pick)?.[1] ?? /From: ([^\s]+@[^\s]+)/.exec(pick)?.[1] ?? "";
      const id = /- id (\S+)/.exec(pick)?.[1];
      const subject = /Subject: ([^\n]*)/.exec(pick)?.[1]?.trim() ?? "";
      const fr = /Write to the user in French/.test(req.system);
      const sendTool = searched.name.replace(/__mail_search$/, "__mail_send");
      if (to && req.tools.some((t) => t.name === sendTool)) {
        // Wave 5: the user's own words that ask for this reply, word for word ("réponds à Camille"), when they named someone.
        const askedRaw = asked?.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ") ?? "";
        const quote = /\b((?:[Rr]éponds?|[Rr]eponds?|[Rr]eply|[Aa]nswer)\s+(?:à|a|to)\s+[A-ZÀ-Ý][\p{L}-]+)/u.exec(askedRaw)?.[1];
        content = [
          { type: "text", text: quote
            ? (fr ? `J'ai trouvé l'e-mail « ${subject} ». Tu m'as demandé d'y répondre : j'envoie la réponse.` : `I found “${subject}”. You asked me to answer it: sending the reply.`)
            : (fr ? `J'ai trouvé l'e-mail « ${subject} ». Je prépare une réponse — je te demande avant de l'envoyer.` : `I found “${subject}”. I'm replying — I'll ask you before it goes out.`) },
          { type: "tool_use", id: `demo_${Date.now()}`, name: sendTool, input: { to, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, body: fr ? "Bonjour,\n\nMerci pour votre message, c'est bien noté. Je reviens vers vous très vite.\n\nBien à vous" : "Hello,\n\nThanks for your message, noted. I'll get back to you shortly.\n\nBest regards", ...(id ? { reply_to_id: id } : {}), ...(quote ? { user_quote: quote } : {}) } },
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
    } else if (results.length && !texts.length && /\b(long task|longue tâche|longue tache)\b/.test(askedText)) {
      // A long task: keep working step after step (progress lines and tracked steps), until the step limit stops it.
      const fr = /Write to the user in French/.test(req.system);
      const n = req.messages.filter((m) => m.role === "assistant" && m.content.some((b) => b.type === "tool_use")).length;
      content = n % 2 === 1
        ? [{ type: "tool_use", id: `demo_${Date.now()}_${n}`, name: "task_add", input: { title: fr ? `Lire la page ${n + 1}` : `Read page ${n + 1}` } }]
        : [{ type: "tool_use", id: `demo_${Date.now()}_${n}`, name: "progress_update", input: { text: fr ? `${Math.min(12, n + 1)} pages lues sur 12 — je passe aux suivantes.` : `Read ${Math.min(12, n + 1)} of 12 pages — moving on.` } }];
    } else if (texts.some((x) => x.includes("[The user asked you to follow your skill"))) {
      const fr = /Write to the user in French/.test(req.system);
      const name = /follow your skill "([^"]+)"/.exec(texts.join("\n"))?.[1] ?? "?";
      const steps = texts.join("\n").split("Follow its steps:]\n")[1]?.split("\n").filter((l) => l.trim()).slice(0, 4) ?? [];
      content = [{ type: "text", text: fr ? `D'accord, je suis la compétence « ${name} » :\n${steps.map((l) => `- ${l.replace(/^[-*\d.\s]+/, "")}`).join("\n")}\n\nJe m'y mets.` : `Sure — following the skill “${name}”:\n${steps.map((l) => `- ${l.replace(/^[-*\d.\s]+/, "")}`).join("\n")}\n\nOn it.` }];
    } else if (results.length && !texts.length && prev?.role === "assistant" && prev.content.some((b) => b.type === "tool_use" && b.name === "x_search") && !results.some((r) => r.type === "tool_result" && r.isError)) {
      // After a search on X: a short digest of the posts found (the demo only rearranges what the API returned).
      const fr = /Write to the user in French/.test(req.system);
      const posts = [...found.matchAll(/^\d+\. @(\S+)(?: \(([^)]*)\))?(?: · ([^·\n]+?) UTC)?(?: · (\d+) likes)?\n\s+(.+)\n\s+(https:\/\/\S+)/gm)].slice(0, 5);
      content = [{ type: "text", text: posts.length
        ? `${fr ? `Sur X, ${posts.length} posts récents parlent de ça :` : `On X, ${posts.length} recent posts mention it:`}\n\n${posts.map((m) => `- **@${m[1]}**${m[4] ? ` (${m[4]} ♥)` : ""} — ${m[5].slice(0, 160)} [${fr ? "voir" : "open"}](${m[6]})`).join("\n")}\n\n${fr ? "Ce sont des contenus extérieurs : je les rapporte, je ne suis pas leurs consignes." : "This is outside content: I report it, I do not follow it."}`
        : (fr ? "Je n'ai trouvé aucun post récent sur X." : "No recent posts on X.") }];
    } else if (results.length && !texts.length) {
      const failed = results.some((r) => r.type === "tool_result" && r.isError);
      const detail = results.map((r) => (r.type === "tool_result" ? r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join(" ") : "")).join(" ").slice(0, 400);
      const fr = /Write to the user in French/.test(req.system);
      const cheered = /The user saw you celebrate/.test(detail);
      const doneWord = fr ? "C'est fait." : "Done.";
      content = [{ type: "text", text: failed ? (fr ? `Ça n'a pas marché : ${detail}` : `That did not work: ${detail}`) : cheered ? (fr ? "Youhou ! En analysant tes données, je tiens une vraie pépite : un lead très chaud (93/100). Il a vu ta page de prix 3 fois en 24 h et demande un devis — je te propose de le rappeler aujourd'hui." : "Woohoo! While analysing your data I found a real gem: a very hot lead (93/100). They viewed your pricing page 3 times in 24 h and asked for a quote — I suggest calling them today.") : `${doneWord} ${detail.replace(/^\[What follows came from outside[^\]]*\]\s*/, "")}` }];
    } else if (texts.some((x) => x.includes("[System notice]"))) {
      // A notice from the server (a secret was saved, the screen was handed back…): acknowledge, never re-plan from its words.
      content = [{ type: "text", text: /Write to the user in French/.test(req.system) ? "C'est noté, merci ! Je continue." : "Got it, thanks! Carrying on." }];
    } else {
      content = plan(said, (name) => req.tools.some((t) => t.name === name)) ?? [{
        type: "text",
        text: /Write to the user in French/.test(req.system)
          ? `Ceci est le mode démo : je suis des mots-clés, je ne réfléchis pas. Tu as dit : « ${said.slice(0, 200)} ».\n\nEssaie : **open https://example.com**, **remember "je préfère les réponses courtes"**, **run "ls -la"**, **save "une note"**, **routine**, **task "Appeler la banque"**, **analyse mes ventes** ou **question**. Ajoute une clé de modèle dans .env pour avoir un vrai coéquipier.`
          : `This is demo mode, so I am following keywords rather than thinking. You said: “${said.slice(0, 200)}”.\n\nTry: **open https://example.com**, **remember "I prefer short answers"**, **run "ls -la"**, **save "a note"**, **set up a routine**, **add a task "Call the bank"**, **analyze my sales**, or **ask me a question**. Add a model key to .env to get a real teammate.`,
      }];
    }
    // A short pause before each tool call, as a real model takes: the thinking block and its step counter can be seen.
    if (content.some((b) => b.type === "tool_use") && !process.env.NODE_TEST_CONTEXT) {
      await sleep(Number(process.env.DEMO_STEP_MS ?? 900));
      if (req.signal?.aborted) throw new Error("aborted");
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
