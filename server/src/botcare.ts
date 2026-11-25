import { q } from "./db.js";
import type { Locale } from "./shared.js";
import { bots, newId, now, type BotRecord, type UserRecord } from "./store.js";

/**
 * L161 (backlog A-FAIRE), what a bot is told about itself, in four owner-made parts (sources: Timon T47, T53, T56 and
 * Hermes row 204, ideas only, our own code):
 *   - « Consignes pour tous les bots »: one text per account that every bot receives (language, style, habits).
 *   - « Rôles partagés »: a role text several bots use. Built-in roles can be edited (marked « modifié », « Rétablir »
 *     goes back to the product's text, which keeps following updates while it is not edited); the owner can add roles.
 *     A change reaches every bot of that role on its next turn.
 *   - « Identité en plusieurs documents »: short named documents (character, style, charter…) that make up who the bot
 *     is, apart from its standing instructions (what to do).
 *   - « Personnalités prêtes »: one click writes a ready-made character into the « Caractère » document, which the owner
 *     can then edit like any other document.
 * None of them adds a tool, an access or a permission: they are text in the bot's instructions (agent/prompt.ts).
 */

export const GLOBAL_MAX = 4000;
export const DOC_TITLE_MAX = 60;
export const DOC_BODY_MAX = 4000;
export const DOCS_PER_BOT = 8;
export const ROLE_NAME_MAX = 60;
export const ROLE_TEXT_MAX = 3000;
export const ROLES_PER_ACCOUNT = 30;

q.run("CREATE TABLE IF NOT EXISTS global_instructions (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, updated_at INTEGER NOT NULL)");
q.run("CREATE TABLE IF NOT EXISTS shared_roles (id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, text TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, id))");
q.run("CREATE TABLE IF NOT EXISTS bot_shared_role (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, role_id TEXT NOT NULL)");
q.run("CREATE TABLE IF NOT EXISTS bot_identity_docs (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, personality TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
q.run("CREATE INDEX IF NOT EXISTS bot_identity_docs_bot ON bot_identity_docs(bot_id, position)");

export class CareError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const line = (v: unknown, max: number) => clean(v, max * 2).replace(/\s+/g, " ").slice(0, max);

/* ---------- Consignes pour tous les bots ---------- */

export const globalInstructions = {
  get: (userId: string) => q.get<{ text: string; updated_at: number }>("SELECT text, updated_at FROM global_instructions WHERE user_id = ?", userId) ?? null,
  set(userId: string, text: unknown) {
    if (typeof text !== "string") throw new CareError(400, "text must be a string.");
    const t = clean(text, GLOBAL_MAX + 1);
    if (t.length > GLOBAL_MAX) throw new CareError(400, "These instructions are too long (4,000 characters at most).");
    if (!t) { q.run("DELETE FROM global_instructions WHERE user_id = ?", userId); return { text: "", updatedAt: null }; }
    q.run("INSERT INTO global_instructions (user_id, text, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at", userId, t, now());
    return { text: t, updatedAt: now() };
  },
};

/* ---------- Rôles partagés ---------- */

interface BuiltinRole { id: string; fr: [string, string]; en: [string, string] }
/** The product's roles. Their text follows Sklubot's updates as long as the owner has not edited it. */
export const BUILTIN_ROLES: BuiltinRole[] = [
  { id: "relecteur", fr: ["Relecteur", "Tu relis le travail qu'on te donne avant qu'il parte : fautes, chiffres, noms, dates, ton. Tu listes chaque problème avec l'endroit exact et une correction proposée, le plus grave d'abord. Tu ne réécris pas tout : tu dis ce qui ne va pas et pourquoi. Si tout est bon, tu le dis en une phrase."], en: ["Reviewer", "You review the work you are given before it goes out: typos, figures, names, dates, tone. List each problem with its exact place and a proposed fix, the most serious first. Do not rewrite everything: say what is wrong and why. If everything is fine, say so in one sentence."] },
  { id: "chercheur", fr: ["Chercheur", "Tu cherches des informations fiables. Tu croises au moins deux sources indépendantes, tu notes la date et l'adresse de chacune, tu sépares les faits des avis et tu dis clairement ce qui reste incertain. Jamais de chiffre ni de citation inventés."], en: ["Researcher", "You look for reliable information. Cross at least two independent sources, note the date and address of each, keep facts apart from opinions and say plainly what remains uncertain. Never invent a figure or a quote."] },
  { id: "redacteur", fr: ["Rédacteur", "Tu écris des textes clairs pour le public visé : la phrase la plus utile d'abord, des phrases courtes, des mots simples. Tu respectes la longueur demandée et le ton de la maison. Tu proposes un titre et tu relis avant de livrer."], en: ["Writer", "You write clear texts for the intended readers: the most useful sentence first, short sentences, plain words. Keep to the requested length and the house tone. Suggest a title and reread before delivering."] },
  { id: "assistant", fr: ["Assistant administratif", "Tu t'occupes des papiers : courriers, factures, rendez-vous, démarches. Tu tiens une liste de ce qui est en cours avec les dates limites, tu préviens avant l'échéance et tu gardes une trace de chaque envoi. Tu ne paies et n'envoies rien sans accord."], en: ["Admin assistant", "You handle paperwork: letters, invoices, appointments, procedures. Keep a list of what is open with its deadlines, warn before a due date and keep a record of everything sent. Never pay or send anything without approval."] },
  { id: "commercial", fr: ["Commercial", "Tu aides à trouver et suivre des clients : qui contacter, quoi leur dire, quand relancer. Tes messages sont courts, personnels et honnêtes : aucune promesse que l'entreprise ne peut pas tenir. Tu notes chaque échange et la prochaine étape."], en: ["Sales", "You help find and follow up customers: who to contact, what to tell them, when to follow up. Your messages are short, personal and honest: no promise the business cannot keep. Note each exchange and the next step."] },
  { id: "support", fr: ["Support client", "Tu réponds aux clients avec patience et précision. Tu reformules le problème, tu donnes la solution étape par étape, et si tu ne sais pas, tu le dis et tu passes la demande à un humain. Tu ne donnes jamais d'information personnelle d'un autre client."], en: ["Customer support", "You answer customers with patience and accuracy. Restate the problem, give the solution step by step, and if you do not know, say so and hand the request to a human. Never give out another customer's personal information."] },
];

export interface SharedRoleView { id: string; name: string; text: string; builtin: boolean; modified: boolean; bots: { id: string; name: string }[] }

const builtinText = (r: BuiltinRole, loc: Locale) => (loc === "fr" ? r.fr : r.en);

function roleRow(userId: string, id: string) { return q.get<{ name: string; text: string }>("SELECT name, text FROM shared_roles WHERE user_id = ? AND id = ?", userId, id) ?? null; }

/** The role as bots receive it, or null when it does not exist (any more) in this account. */
export function sharedRole(userId: string, id: string, loc: Locale): { id: string; name: string; text: string; builtin: boolean; modified: boolean } | null {
  const b = BUILTIN_ROLES.find((r) => r.id === id);
  const row = roleRow(userId, id);
  if (b) { const [name, text] = builtinText(b, loc); return { id, name: row?.name ?? name, text: row?.text ?? text, builtin: true, modified: !!row }; }
  return row ? { id, name: row.name, text: row.text, builtin: false, modified: false } : null;
}

export const sharedRoles = {
  list(userId: string, loc: Locale): SharedRoleView[] {
    const users = q.all<{ bot_id: string; role_id: string }>("SELECT r.bot_id, r.role_id FROM bot_shared_role r JOIN bots b ON b.id = r.bot_id WHERE b.user_id = ? AND b.hidden = 0", userId);
    const botsOf = (id: string) => users.filter((u) => u.role_id === id).map((u) => ({ id: u.bot_id, name: bots.byId(u.bot_id)?.name ?? "" }));
    const custom = q.all<{ id: string }>("SELECT id FROM shared_roles WHERE user_id = ? ORDER BY updated_at", userId).map((r) => r.id).filter((id) => !BUILTIN_ROLES.some((b) => b.id === id));
    return [...BUILTIN_ROLES.map((b) => b.id), ...custom].map((id) => ({ ...sharedRole(userId, id, loc)!, bots: botsOf(id) }));
  },
  /** Edits a role (built-in: an override), or adds one when id is absent. */
  save(userId: string, id: string | null, name: unknown, text: unknown, loc: Locale) {
    if (id && !sharedRole(userId, id, loc)) throw new CareError(404, "That role does not exist.");
    const n = line(name, ROLE_NAME_MAX);
    const t = clean(text, ROLE_TEXT_MAX + 1);
    if (!n) throw new CareError(400, "Give the role a name.");
    if (!t) throw new CareError(400, "Write what this role does.");
    if (t.length > ROLE_TEXT_MAX) throw new CareError(400, "This role text is too long (3,000 characters at most).");
    if (!id) {
      const count = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM shared_roles WHERE user_id = ?", userId)!.n;
      if (count >= ROLES_PER_ACCOUNT) throw new CareError(409, "You already have 30 roles: remove one first.");
    }
    const rid = id ?? newId("role");
    q.run("INSERT INTO shared_roles (id, user_id, name, text, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, text = excluded.text, updated_at = excluded.updated_at", rid, userId, n, t, now());
    return sharedRole(userId, rid, loc)!;
  },
  /** Built-in: back to the product's text. Own role: removed, and the bots that used it no longer have a shared role. */
  reset(userId: string, id: string, loc: Locale) {
    if (!sharedRole(userId, id, loc)) throw new CareError(404, "That role does not exist.");
    q.run("DELETE FROM shared_roles WHERE user_id = ? AND id = ?", userId, id);
    if (!BUILTIN_ROLES.some((b) => b.id === id)) q.run("DELETE FROM bot_shared_role WHERE role_id = ? AND bot_id IN (SELECT id FROM bots WHERE user_id = ?)", id, userId);
  },
  of: (botId: string) => q.get<{ role_id: string }>("SELECT role_id FROM bot_shared_role WHERE bot_id = ?", botId)?.role_id ?? null,
  assign(bot: BotRecord, roleId: unknown, loc: Locale) {
    if (roleId === null || roleId === "") { q.run("DELETE FROM bot_shared_role WHERE bot_id = ?", bot.id); return null; }
    if (typeof roleId !== "string" || !sharedRole(bot.userId, roleId, loc)) throw new CareError(404, "That role does not exist.");
    q.run("INSERT INTO bot_shared_role (bot_id, role_id) VALUES (?, ?) ON CONFLICT (bot_id) DO UPDATE SET role_id = excluded.role_id", bot.id, roleId);
    return roleId;
  },
};

/* ---------- Identité en plusieurs documents, personnalités prêtes ---------- */

export interface IdentityDoc { id: string; title: string; body: string; personality: string; updatedAt: number }

interface Personality { id: string; fr: [string, string]; en: [string, string] }
export const PERSONALITIES: Personality[] = [
  { id: "chaleureux", fr: ["Chaleureux", "Tu es chaleureux et encourageant. Tu salues simplement, tu remarques ce qui va bien avant ce qui ne va pas, et tu restes positif sans en faire trop. Tu tutoies si on te tutoie."], en: ["Warm", "You are warm and encouraging. Greet simply, notice what goes well before what does not, and stay positive without overdoing it."] },
  { id: "direct", fr: ["Direct et bref", "Tu vas droit au but : la réponse d'abord, en peu de mots, sans formule de politesse inutile. Tu poses une question seulement si elle change la réponse."], en: ["Direct and brief", "You get to the point: the answer first, in few words, without needless pleasantries. Ask a question only when it changes the answer."] },
  { id: "rigoureux", fr: ["Rigoureux", "Tu es précis et méthodique. Tu vérifies les chiffres, tu cites tes sources, tu distingues ce qui est sûr de ce qui est supposé, et tu préfères dire « je ne sais pas » plutôt que deviner."], en: ["Thorough", "You are precise and methodical. Check figures, cite sources, keep what is certain apart from what is assumed, and prefer saying \"I don't know\" to guessing."] },
  { id: "creatif", fr: ["Créatif", "Tu proposes des idées originales. Pour une demande ouverte, tu donnes trois pistes différentes, dont une audacieuse, puis tu aides à en choisir une. Tu restes concret."], en: ["Creative", "You suggest original ideas. For an open request, give three different directions, one of them bold, then help choose one. Stay concrete."] },
  { id: "pedagogue", fr: ["Pédagogue", "Tu expliques comme à quelqu'un qui découvre : un exemple de la vie courante, une étape à la fois, et tu vérifies que c'est clair avant de passer à la suite."], en: ["Teacher", "You explain as to someone new to the subject: an everyday example, one step at a time, and check it is clear before moving on."] },
  { id: "calme", fr: ["Calme et posé", "Tu restes calme, même quand il y a urgence ou erreur. Tu résumes la situation en une phrase, tu proposes la prochaine étape la plus sûre, et tu évites les points d'exclamation."], en: ["Calm", "You stay calm, even in a rush or after a mistake. Sum up the situation in one sentence, suggest the safest next step, and avoid exclamation marks."] },
];
export const personalityList = (loc: Locale) => PERSONALITIES.map((p) => { const [name, text] = loc === "fr" ? p.fr : p.en; return { id: p.id, name, text }; });

const toDoc = (r: any): IdentityDoc => ({ id: r.id, title: r.title, body: r.body, personality: r.personality, updatedAt: r.updated_at });

export const identityDocs = {
  list: (botId: string): IdentityDoc[] => q.all("SELECT * FROM bot_identity_docs WHERE bot_id = ? ORDER BY position, updated_at", botId).map(toDoc),
  save(botId: string, id: string | null, title: unknown, body: unknown): IdentityDoc {
    if (id && !q.get("SELECT 1 FROM bot_identity_docs WHERE id = ? AND bot_id = ?", id, botId)) throw new CareError(404, "That document does not exist.");
    const t = line(title, DOC_TITLE_MAX);
    const b = clean(body, DOC_BODY_MAX + 1);
    if (!t) throw new CareError(400, "Give the document a title.");
    if (!b) throw new CareError(400, "This document is empty.");
    if (b.length > DOC_BODY_MAX) throw new CareError(400, "This document is too long (4,000 characters at most).");
    if (id) {
      q.run("UPDATE bot_identity_docs SET title = ?, body = ?, personality = '', updated_at = ? WHERE id = ?", t, b, now(), id);
      return toDoc(q.get("SELECT * FROM bot_identity_docs WHERE id = ?", id));
    }
    const list = identityDocs.list(botId);
    if (list.length >= DOCS_PER_BOT) throw new CareError(409, "This bot already has 8 documents: remove one first.");
    const nid = newId("idoc");
    q.run("INSERT INTO bot_identity_docs (id, bot_id, title, body, position, updated_at) VALUES (?, ?, ?, ?, ?, ?)", nid, botId, t, b, list.length, now());
    return toDoc(q.get("SELECT * FROM bot_identity_docs WHERE id = ?", nid));
  },
  remove(botId: string, id: string) {
    if (!q.run("DELETE FROM bot_identity_docs WHERE id = ? AND bot_id = ?", id, botId).changes) throw new CareError(404, "That document does not exist.");
  },
  /** Writes a ready-made personality into the bot's « Caractère » document (created first in the list, or replaced). */
  applyPersonality(botId: string, pid: unknown, loc: Locale): IdentityDoc {
    const p = PERSONALITIES.find((x) => x.id === pid);
    if (!p) throw new CareError(404, "That personality does not exist.");
    const [name, text] = loc === "fr" ? p.fr : p.en;
    const title = loc === "fr" ? `Caractère : ${name}` : `Character: ${name}`;
    const old = q.get<{ id: string }>("SELECT id FROM bot_identity_docs WHERE bot_id = ? AND personality != '' ORDER BY position LIMIT 1", botId);
    if (old) {
      q.run("UPDATE bot_identity_docs SET title = ?, body = ?, personality = ?, updated_at = ? WHERE id = ?", title, text, p.id, now(), old.id);
      return toDoc(q.get("SELECT * FROM bot_identity_docs WHERE id = ?", old.id));
    }
    if (identityDocs.list(botId).length >= DOCS_PER_BOT) throw new CareError(409, "This bot already has 8 documents: remove one first.");
    q.run("UPDATE bot_identity_docs SET position = position + 1 WHERE bot_id = ?", botId);
    const nid = newId("idoc");
    q.run("INSERT INTO bot_identity_docs (id, bot_id, title, body, personality, position, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)", nid, botId, title, text, p.id, now());
    return toDoc(q.get("SELECT * FROM bot_identity_docs WHERE id = ?", nid));
  },
};

/**
 * The prompt blocks, in the order the model receives them: instructions for every bot, the shared role, then the
 * identity documents. An account and a bot with none of these get nothing (their prompt stays exactly as it was).
 */
export function careBlocks(bot: BotRecord, user: UserRecord): string[] {
  const out: string[] = [];
  const g = globalInstructions.get(user.id);
  if (g?.text) out.push(`## Instructions from ${user.name} for every bot\n${g.text}`);
  const rid = sharedRoles.of(bot.id);
  const role = rid ? sharedRole(user.id, rid, user.locale === "fr" ? "fr" : "en") : null;
  if (role) out.push(`## Your shared role: ${role.name}\n(Every bot with this role receives the same text.)\n${role.text}`);
  for (const d of identityDocs.list(bot.id)) out.push(`## Who you are: ${d.title}\n${d.body}`);
  return out;
}
