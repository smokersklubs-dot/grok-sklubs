/**
 * L159 « fiche coordonnées au coffre » (backlog A-FAIRE L159; behaviour from the Nightly audit: the vault holds logins,
 * cards AND contact details for address forms; "use the one that fits, ask when there are several" — our own code).
 *
 *  - A contact card (name, company, address, postcode, city, country, phone, email) is sealed as a whole on disk, like
 *    the other vault values (auth.ts seal). The owner adds, edits and deletes it in Settings → Vault.
 *  - A bot reads it with `contact_details` to fill a delivery or billing form. Each card may be reserved to some bots
 *    (empty list: any of the owner's bots). After the turn has read outside content (a web page could ask for it), each
 *    read asks the owner first, single use (the deterministic floor's "outside content" rule). Every read is logged in
 *    the account's activity.
 *  - Not secret like a password: the bot sees the fields it types. Never a card number (that is card_fill).
 */
import { seal, unseal } from "./auth.js";
import { q } from "./db.js";
import { audit, bots, clip, newId, now } from "./store.js";
import type { BuiltinTool } from "./agent/tools.js";

q.run(`CREATE TABLE IF NOT EXISTS vault_contacts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, data_enc TEXT NOT NULL, bots TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS vault_contacts_user ON vault_contacts (user_id)");

export const CONTACT_FIELDS = ["fullName", "company", "address1", "address2", "postalCode", "city", "country", "phone", "email"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
export interface ContactCard { id: string; label: string; fields: Record<ContactField, string>; bots: string[]; createdAt: number; updatedAt: number }

const LIMITS: Record<ContactField, number> = { fullName: 120, company: 120, address1: 160, address2: 160, postalCode: 20, city: 80, country: 60, phone: 40, email: 160 };

/** Cleans what the owner typed. Throws with a message for the owner. */
export function cleanContact(input: Record<string, unknown>): { label: string; fields: Record<ContactField, string> } {
  const fields = {} as Record<ContactField, string>;
  for (const k of CONTACT_FIELDS) fields[k] = String(input[k] ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS[k]);
  if (!fields.fullName && !fields.address1 && !fields.email && !fields.phone) throw new Error("Fill in at least a name, an address, an email or a phone number.");
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw new Error("This email address does not look valid.");
  if (fields.phone && !/^[+\d][\d\s().-]{3,}$/.test(fields.phone)) throw new Error("This phone number does not look valid.");
  const label = String(input.label ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || fields.fullName || fields.city || "Coordonnées";
  return { label, fields };
}

const toCard = (r: any): ContactCard => {
  let fields = {} as Record<ContactField, string>;
  try { fields = JSON.parse(unseal(r.data_enc) ?? "{}"); } catch { /* unreadable: empty */ }
  for (const k of CONTACT_FIELDS) fields[k] = typeof fields[k] === "string" ? fields[k] : "";
  let list: string[] = [];
  try { list = (JSON.parse(r.bots) as unknown[]).filter((x): x is string => typeof x === "string"); } catch { /* none */ }
  return { id: r.id, label: r.label, fields, bots: list, createdAt: r.created_at, updatedAt: r.updated_at };
};
const ownBots = (userId: string, list: unknown) => (Array.isArray(list) ? list : []).map(String).filter((id, i, a) => a.indexOf(id) === i && bots.byId(id)?.userId === userId).slice(0, 50);

export const contacts = {
  list: (userId: string): ContactCard[] => q.all("SELECT * FROM vault_contacts WHERE user_id = ? ORDER BY created_at", userId).map(toCard),
  get: (userId: string, id: string) => { const r = q.get("SELECT * FROM vault_contacts WHERE id = ? AND user_id = ?", id, userId); return r ? toCard(r) : null; },
  save(userId: string, input: Record<string, unknown>, id?: string): ContactCard | null {
    const { label, fields } = cleanContact(input);
    const list = ownBots(userId, input.bots);
    if (id) {
      if (!contacts.get(userId, id)) return null;
      q.run("UPDATE vault_contacts SET label = ?, data_enc = ?, bots = ?, updated_at = ? WHERE id = ? AND user_id = ?", label, seal(JSON.stringify(fields)), JSON.stringify(list), now(), id, userId);
    } else {
      if (contacts.list(userId).length >= 20) throw new Error("You can keep up to 20 contact cards.");
      id = newId("ctc");
      q.run("INSERT INTO vault_contacts (id, user_id, label, data_enc, bots, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId, label, seal(JSON.stringify(fields)), JSON.stringify(list), now(), now());
    }
    audit(userId, "vault", `Contact card saved: ${label}`);
    return contacts.get(userId, id);
  },
  remove(userId: string, id: string): boolean {
    const c = contacts.get(userId, id);
    if (!c) return false;
    q.run("DELETE FROM vault_contacts WHERE id = ? AND user_id = ?", id, userId);
    audit(userId, "vault", `Contact card deleted: ${c.label}`);
    return true;
  },
  /** The cards this bot may read. */
  forBot: (userId: string, botId: string) => contacts.list(userId).filter((c) => !c.bots.length || c.bots.includes(botId)),
};

/** The text the bot gets: one line per filled field. */
export const contactText = (c: ContactCard) => [`Contact card "${c.label}":`, ...CONTACT_FIELDS.filter((k) => c.fields[k]).map((k) => `- ${k}: ${c.fields[k]}`)].join("\n");

export const contactTools: BuiltinTool[] = [{
  spec: {
    name: "contact_details",
    description: "Read one of the user's saved contact cards (name, company, address, postcode, city, country, phone, email) to fill a delivery, billing or sign-up form. Without `card`, lists the card names you may use; when several fit and the user did not say which, ask them. Never invent missing fields: leave them empty or ask.",
    inputSchema: { type: "object", properties: { card: { type: "string", description: "Name of the contact card (leave empty to list them)" } }, required: [] },
  },
  activity: "reading", label: "Reading a contact card", group: "vault", audited: true, detail: (a) => clip(String(a.card ?? ""), 40),
  // After outside content (a page could ask for the address), every read asks first, single use.
  gate: (a, ctx) => (ctx.tainted && String(a.card ?? "").trim()
    ? { key: `contact: ${String(a.card).trim()}`, strict: true, once: true, source: "Vault", title: "Allow {bot} to read the contact card {card}?", reason: "read the contact card {card} to fill a form", vars: { card: clip(String(a.card), 60) }, note: "The bot read a web page or a message from outside in this conversation: it asks before reading your contact details." }
    : null),
  run: async (a, c) => {
    const mine = contacts.forBot(c.user.id, c.bot.id);
    const want = String(a.card ?? "").trim().toLowerCase();
    if (!want) return { content: mine.length ? `Contact cards you may use: ${mine.map((x) => `"${x.label}"`).join(", ")}. Read one with contact_details {card}.` : "No contact card is saved for you. Ask the user to add one in Settings → Vault → Coordonnées, or to give you the details." };
    const card = mine.find((x) => x.label.toLowerCase() === want);
    if (!card) {
      const exists = contacts.list(c.user.id).some((x) => x.label.toLowerCase() === want);
      return { content: exists ? `The contact card "${a.card}" is reserved to other bots. Ask the user.` : `No contact card is called "${a.card}". Call contact_details without a name to list them.`, isError: true };
    }
    audit(c.user.id, "vault", `${c.bot.name} read the contact card ${card.label}`, c.bot.id);
    return { content: contactText(card) };
  },
}];
