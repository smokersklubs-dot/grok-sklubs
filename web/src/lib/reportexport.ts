/**
 * L156 — a research report (« Recherche » panel) as a Markdown file or a printable page (the browser's « Enregistrer en
 * PDF »): the subject, each question with what was found (claim, quote, link, date), the notes, then the numbered list of
 * sources. Built in the browser from the report already shown; secrets masked like a conversation export (chatexport.ts).
 */
import { exportFileName, maskSecrets, stamp, type SecretFinder } from "./chatexport.ts";

export interface ExportableReport {
  id: string; state: string;
  brief: { subject: string; plan: string[] };
  sections: { question: string; read: number; findings: { url: string; title: string; claim: string; quote: string; published?: string }[]; notes: string[]; at: number }[];
}

const quote = (s: string) => s.trim().split("\n").map((l) => `> ${l}`.trimEnd()).join("\n");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function reportMarkdown(r: ExportableReport, fr: boolean, find: SecretFinder, now = Date.now()): string {
  const L = (f: string, e: string) => (fr ? f : e);
  const state = r.state === "done" ? L("terminé", "completed") : r.state === "queued" ? L("en cours", "in progress") : L("interrompu", "interrupted");
  const out = [`# ${oneLine(r.brief.subject) || L("Rapport de recherche", "Research report")}`, "", `_${L("Exporté le", "Exported on")} ${stamp(now)} · ${state} · ${r.sections.length}/${r.brief.plan.length} ${L("questions traitées", "questions processed")}_`, ""];
  const sources: string[] = [];
  const ref = (url: string, title: string) => {
    let i = sources.findIndex((s) => s.endsWith(`(${url})`));
    if (i < 0) { sources.push(`[${oneLine(title || url).replace(/[[\]]/g, "")}](${url})`); i = sources.length - 1; }
    return i + 1;
  };
  r.brief.plan.forEach((question, i) => {
    out.push(`## ${i + 1}. ${oneLine(question)}`, "");
    const step = r.sections[i];
    if (!step) { out.push(`_${L("Pas encore traitée.", "Not processed yet.")}_`, ""); return; }
    out.push(`_${step.read} ${L("sources lues", "sources read")} · ${stamp(step.at)}_`, "");
    if (!step.findings.length) out.push(L("Rien de sûr trouvé.", "Nothing reliable found."), "");
    for (const f of step.findings) {
      const n = ref(f.url, f.title);
      if (f.claim) out.push(`${oneLine(f.claim)} [${n}]`, "");
      if (f.quote) out.push(quote(f.quote), "");
      if (f.published) out.push(`_${L("Publié", "Published")} : ${f.published}_`, "");
    }
    for (const note of step.notes) out.push(`- ${oneLine(note)}`);
    if (step.notes.length) out.push("");
  });
  if (sources.length) { out.push(`## ${L("Sources", "Sources")}`, ""); sources.forEach((s, i) => out.push(`${i + 1}. ${s}`)); out.push(""); }
  return maskSecrets(out.join("\n"), find, L("masqué", "masked"));
}

export const reportFileName = (r: ExportableReport, ext: "md" | "html", now = Date.now()) => exportFileName(`recherche-${r.brief.subject.slice(0, 40)}`, now, ext);

export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
