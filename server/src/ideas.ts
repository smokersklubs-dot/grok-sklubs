import { recentSubjects } from "./native/access.js";
import type { Locale, TaskIdea } from "./shared.js";
import { tr } from "./i18n.js";

/**
 * First-task ideas for an empty main chat (spec 07 A19). With the user's opt-in and a connected mailbox, the subjects
 * of a dozen recent inbox emails are read (subjects only, read-only) and matched here, on the server, against a few
 * common situations — invoices, quotes, meetings, deliveries, newsletters, job applications… Nothing is sent to a model,
 * nothing is sent anywhere, nothing runs until the user picks an idea. Classic ideas complete the list (a morning
 * brief, a Friday review). At most 5 ideas: one-off ones first, then recurring ones.
 */
interface Rule { words: RegExp; idea: (loc: Locale) => TaskIdea }

const RULES: Rule[] = [
  { words: /\b(facture|invoice|reçu|recu|receipt|avoir|payment due|échéance|echeance|prélèvement|prelevement)\b/i, idea: (l) => ({ kind: "once", title: tr(l, "Sort out my invoices"), prompt: tr(l, "Find the invoices and receipts in my mailbox from this month, list them in a table (vendor, date, amount, due date, paid or not) and tell me what needs paying soon."), why: tr(l, "Recent emails look like invoices.") }) },
  { words: /\b(devis|quote|quotation|estimate|proposition commerciale|proposal)\b/i, idea: (l) => ({ kind: "once", title: tr(l, "Follow up on quotes"), prompt: tr(l, "Look at the quotes and proposals in my recent emails, tell me which ones are still waiting for an answer and draft short follow-ups for me to check."), why: tr(l, "Recent emails mention quotes.") }) },
  { words: /\b(réunion|reunion|meeting|rendez-vous|rdv|invitation|call|visio|webinar|entretien)\b/i, idea: (l) => ({ kind: "once", title: tr(l, "Prepare my next meeting"), prompt: tr(l, "Prepare my next meeting: who is coming, what it is about from our recent emails, a short agenda and the questions I should ask."), why: tr(l, "Recent emails are about meetings.") }) },
  { words: /\b(livraison|delivery|colis|parcel|commande|order|expédi|expedi|shipped|tracking|suivi)\b/i, idea: (l) => ({ kind: "recurring", title: tr(l, "Track my deliveries"), prompt: tr(l, "Every morning, check my emails for orders and deliveries and tell me only when something ships, is delayed or arrives."), why: tr(l, "Recent emails are about orders or deliveries.") }) },
  { words: /\b(newsletter|unsubscribe|désinscri|desinscri|promo|offre spéciale|offre speciale|sale|soldes|-\d+ ?%)\b/i, idea: (l) => ({ kind: "once", title: tr(l, "Tidy up my newsletters"), prompt: tr(l, "List the newsletters and promotional senders in my mailbox, with how often they write, and suggest which ones I could unsubscribe from (do not unsubscribe without asking)."), why: tr(l, "Many recent emails are newsletters or promotions.") }) },
  { words: /\b(candidature|application|cv|resume|recrutement|recruiting|job|offre d'emploi|poste)\b/i, idea: (l) => ({ kind: "once", title: tr(l, "Review applications"), prompt: tr(l, "Go through the job applications in my recent emails and give me a short table: name, role, key experience, and your first impression."), why: tr(l, "Recent emails look like job applications.") }) },
  { words: /\b(urgent|asap|relance|reminder|rappel|en attente|waiting for|sans réponse|follow[- ]?up)\b/i, idea: (l) => ({ kind: "recurring", title: tr(l, "Never miss an urgent email"), prompt: tr(l, "Every hour on weekdays, check my new emails and tell me only when one is urgent or waits for my answer, with a one-line summary."), why: tr(l, "Recent emails ask for an answer.") }) },
];

const CLASSICS = (l: Locale): TaskIdea[] => [
  { kind: "recurring", title: tr(l, "Morning brief"), prompt: tr(l, "Every weekday at 8:30, give me a short morning brief: my meetings of the day, the emails that need me, and anything due today."), why: tr(l, "A classic to start the day.") },
  { kind: "recurring", title: tr(l, "Friday review"), prompt: tr(l, "Every Friday at 17:00, review my week: what got done, what is still open, and the three things to start with on Monday."), why: tr(l, "A classic to close the week.") },
  { kind: "once", title: tr(l, "Compare prices for me"), prompt: tr(l, "I want to buy something: ask me what, then compare prices at three sellers (delivery included) and recommend the best offer."), why: tr(l, "A typical one-off job.") },
  { kind: "once", title: tr(l, "Write a quote"), prompt: tr(l, "Help me write a quote for a customer: ask me what you need, then produce a clean document I can send."), why: tr(l, "A typical one-off job.") },
];

/** Ideas from a list of email subjects (pure, for tests and for the route). */
export function ideasFromSubjects(subjects: string[], loc: Locale): TaskIdea[] {
  const found: TaskIdea[] = [];
  for (const r of RULES) if (subjects.some((s) => r.words.test(s))) found.push(r.idea(loc));
  const once = found.filter((i) => i.kind === "once").slice(0, 2);
  const recurring = found.filter((i) => i.kind === "recurring").slice(0, 2);
  const picked = [...once, ...recurring];
  for (const c of CLASSICS(loc)) { if (picked.length >= 5) break; if (!picked.some((p) => p.title === c.title)) picked.push(c); }
  return picked.slice(0, 5);
}

export async function firstTaskIdeas(userId: string, loc: Locale, useMail: boolean): Promise<{ ideas: TaskIdea[]; source: "mail" | "default"; sampled: number }> {
  let subjects: string[] = [];
  if (useMail) { try { subjects = await recentSubjects(userId, 12); } catch { subjects = []; } }
  return { ideas: ideasFromSubjects(subjects, loc), source: subjects.length ? "mail" : "default", sampled: subjects.length };
}
