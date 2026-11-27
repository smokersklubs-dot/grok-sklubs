import { q } from "./db.js"; import { tr } from "./i18n.js";
import { summaries } from "./agent/memoryprefs.js";
import type { Locale, Memory } from "./shared.js";
import { memories, settings, type BotRecord } from "./store.js";
import { writeZip, type ZipFile } from "./zipwrite.js";

/**
 * L161 « notes lisibles hors de l'appli » (10-timon T70: the user re-reads and corrects the memory with their usual
 * tools; behaviour only, our own code). One download, a .zip of plain Markdown files the owner opens with any text
 * editor or a notes app (Obsidian, Notes, Word…):
 *
 *   LISEZMOI.md                        what is in it, one line per file, and how to bring a correction back
 *   notes/utilisees/NNN-<début>.md     one file per memory note the bot uses (text, then date, source, confidence…)
 *   notes/contestees/…, notes/archivees/…  the notes it uses with caution, and the ones it no longer uses
 *   resume-conversation.md             the latest summary of the current conversation (when there is one)
 *   documents/<nom>.md                 the bot's own documents (« Base de documents »)
 *   profil.md                          the shared profile its bots know about the owner
 *
 * Read-only: nothing is changed in Sklubot. Corrections come back by the existing import (Réglages → Mémoire → Importer),
 * which reviews every line first. The single-file export (routes.ts /memories/export) stays as it was.
 */
export const NOTES_MAX = 5000;

const STATUS_DIR: Record<Memory["status"], { fr: string; en: string }> = {
  active: { fr: "utilisees", en: "active" }, contested: { fr: "contestees", en: "contested" }, archived: { fr: "archivees", en: "archived" },
};
const words = {
  fr: {
    status: { active: "utilisée", contested: "contestée (utilisée avec prudence)", archived: "archivée (plus utilisée)" },
    source: { chat: "conversation", learned: "apprise par le bot", import: "importée" },
    conf: { confirmed: "confirmée", once: "entendue une fois" },
    state: "État", written: "Écrite le", source_: "Source", confidence: "Confiance", pinned: "Épinglée (jamais retouchée automatiquement)", until: "Jusqu'au", quote: "Tes mots", used: "Dernier usage",
  },
  en: {
    status: { active: "active", contested: "contested (used with caution)", archived: "archived (no longer used)" },
    source: { chat: "conversation", learned: "learned by the bot", import: "imported" },
    conf: { confirmed: "confirmed", once: "heard once" },
    state: "Status", written: "Written on", source_: "Source", confidence: "Confidence", pinned: "Pinned (never changed automatically)", until: "Until", quote: "Your words", used: "Last used",
  },
};

/** A file-name piece: letters and digits of any language, dashes, at most 48 characters. */
export function slug(text: string, fallback = "note"): string {
  const s = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return s || fallback;
}
const day = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : "");

export function noteMarkdown(m: Memory, locale: Locale): string {
  const w = words[locale === "fr" ? "fr" : "en"]; // folder and field names: French, else English
  const title = m.text.split("\n")[0].slice(0, 80);
  const facts = [
    `- ${w.state} : ${w.status[m.status]}`,
    `- ${w.written} : ${day(m.createdAt)} · ${w.source_} : ${w.source[m.source]}`,
    `- ${w.confidence} : ${w.conf[m.confidence]}`,
    m.lastUsedAt ? `- ${w.used} : ${day(m.lastUsedAt)}` : "",
    m.pinned ? `- ${w.pinned}` : "",
    m.until ? `- ${w.until} : ${m.until}` : "",
    m.quote ? `- ${w.quote} : « ${m.quote.replace(/\s+/g, " ")} »` : "",
  ].filter(Boolean);
  return `# ${title}\n\n${m.text}\n\n---\n${facts.join("\n")}\n`;
}

export function notesArchive(bot: BotRecord, locale: Locale, t = new Date()): { name: string; zip: Buffer; files: string[] } {
  const fr = locale === "fr"; // file and folder names: French, else English (docs/LANGUES.md)
  const fw = fr ? "fr" : "en";
  const files: ZipFile[] = [];
  const index: string[] = [];
  const list = memories.list(bot.id, NOTES_MAX).reverse();
  const used = new Set<string>();
  const counters: Record<string, number> = {};
  for (const m of list) {
    const dir = `notes/${STATUS_DIR[m.status][fw]}`;
    const n = (counters[dir] = (counters[dir] ?? 0) + 1);
    let name = `${dir}/${String(n).padStart(3, "0")}-${slug(m.text)}.md`;
    for (let i = 2; used.has(name); i++) name = `${dir}/${String(n).padStart(3, "0")}-${slug(m.text)}-${i}.md`;
    used.add(name);
    files.push({ name, data: noteMarkdown(m, locale), mtime: new Date(m.createdAt) });
  }
  const summary = summaries.latest(bot.id, bot.generation);
  if (summary?.summary) files.push({ name: fr ? "resume-conversation.md" : "conversation-summary.md", data: `# ${tr(locale, "Conversation summary")}\n\n${tr(locale, "Written on {day}.", { day: day(summary.at) })}\n\n${summary.summary}\n`, mtime: new Date(summary.at) });
  for (const d of q.all<{ name: string; text: string; created_at: number }>("SELECT name, text, created_at FROM doc_base WHERE user_id = ? AND scope_kind = 'bot' AND scope_id = ? ORDER BY created_at", bot.userId, bot.id)) {
    let name = `documents/${slug(d.name, "document")}.md`;
    for (let i = 2; used.has(name); i++) name = `documents/${slug(d.name, "document")}-${i}.md`;
    used.add(name);
    files.push({ name, data: `# ${d.name}\n\n${d.text}\n`, mtime: new Date(d.created_at) });
  }
  const p = settings.profile(bot.userId);
  const profile = [p.name && `- ${tr(locale, "Name")} : ${p.name}`, p.company && `- ${tr(locale, "Company")} : ${p.company}`, p.timezone && `- ${tr(locale, "Time zone")} : ${p.timezone}`, p.preferences && `\n${p.preferences}`].filter(Boolean);
  if (profile.length) files.push({ name: fr ? "profil.md" : "profile.md", data: `# ${tr(locale, "What your bots know about you")}\n\n${profile.join("\n")}\n` });
  const counts = (st: Memory["status"]) => list.filter((m) => m.status === st).length;
  index.push(
    tr(locale, "# {bot}'s notes", { bot: bot.name }), "",
    tr(locale, "Exported on {day}. Plain text files (Markdown): open them with any text editor or notes app (Obsidian, Notes, Word…).", { day: day(t.getTime()) }), "",
    tr(locale, "- notes/{dir}/: {n} note(s) the bot uses", { dir: STATUS_DIR.active[fw], n: counts("active") }),
    tr(locale, "- notes/{dir}/: {n} note(s) used with caution", { dir: STATUS_DIR.contested[fw], n: counts("contested") }),
    tr(locale, "- notes/{dir}/: {n} note(s) it no longer uses", { dir: STATUS_DIR.archived[fw], n: counts("archived") }),
    ...files.filter((f) => !f.name.startsWith("notes/")).map((f) => `- ${f.name}`), "",
    tr(locale, "This export changes nothing in Sklubot. To correct a note: edit it in the app (bot settings → Memory), or paste the corrected text into Memory → Import, which shows you every line before adding it."), "",
  );
  files.unshift({ name: fr ? "LISEZMOI.md" : "README.md", data: index.join("\n") });
  const name = `Notes-${slug(bot.name, "bot")}-${day(t.getTime())}.zip`;
  return { name, zip: writeZip(files), files: files.map((f) => String(f.name)) };
}
