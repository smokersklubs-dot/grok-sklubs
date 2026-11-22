/**
 * Fake data for « Équipe Sklubot (.md) » in the dev gallery (GalleryTeamMd.tsx): the review screen of a team file (a
 * name conflict, a team lead, a suggested brain, Bibliothèque and draft skills, a key-like skill, paused routines, a
 * routine without a schedule, a group, apps to connect later, removed and masked fields), the same file re-imported
 * (« Mettre à jour » / « Créer une copie »), and the share window's file. Never shipped: the gallery is development only.
 */
import { DEFAULT_CHARACTER } from "../types";
import type { TeamMdExport, TeamMdPreview, TeamMdReport } from "../types";
import type { FixtureOptions } from "./fixtures";

export function teamMdPreviewFixture(o: FixtureOptions, existing = false): TeamMdPreview {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const more = o.long ? L(" Elle tient aussi le calendrier éditorial de toute l'agence, prépare chaque vendredi un bilan des contenus publiés avec leurs chiffres et relance les clients qui n'ont pas validé leurs textes depuis plus de trois jours ouvrés.", " She also keeps the whole agency's editorial calendar, prepares every Friday a summary of the published content with its figures and follows up with clients who have not approved their texts for more than three working days.") : "";
  const ch = (x: Partial<typeof DEFAULT_CHARACTER>) => ({ ...DEFAULT_CHARACTER, ...x });
  return {
    previewId: "gallery-preview",
    source: { kind: "url", label: "raw.githubusercontent.com/agence-exemple/equipes/main/agence-contenu.md", url: "https://raw.githubusercontent.com/agence-exemple/equipes/main/agence-contenu.md" },
    meta: { id: "agence-contenu-7f3a", name: L("Agence de contenu", "Content agency"), description: L("Trois bots qui écrivent, relisent et publient les contenus d'une petite agence.", "Three bots that write, review and publish a small agency's content.") + (o.long ? L(" Pensée pour une équipe de deux à cinq personnes qui veut garder la main sur chaque publication.", " Made for a team of two to five people who want to keep a hand on every post.") : ""), version: "1.3", language: o.lang, author: "Agence Exemple", chief: "Léa" },
    bots: [
      {
        name: "Léa", role: L("Coordonne l'équipe et le calendrier éditorial", "Runs the team and the editorial calendar"), personality: L("Claire, posée, va droit au but.", "Clear, calm, gets to the point."),
        instructions: L("Tu reçois les demandes des clients, tu les découpes en tâches et tu les confies à Max ou à Zoé. Rien n'est publié sans mon accord.", "You take the clients' requests, split them into tasks and hand them to Max or Zoé. Nothing is published without my approval.") + more,
        look: { shape: "cat", color: "plum", character: ch({ type: "mascot", eyes: "visor", accessory: "cap" }) },
        model: "openrouter:anthropic/claude-sonnet-4.5", modelAvailable: true,
        skills: [
          { kind: "library", libraryId: "methode-de-travail", name: L("Méthode de travail", "Working method"), when: L("Découper un gros travail en étapes vérifiables.", "Split a big job into checkable steps."), body: "", known: true, mentionsKey: false },
          { kind: "inline", libraryId: "", name: L("Brief client", "Client brief"), when: L("Quand un client envoie une demande", "When a client sends a request"), body: "1. …", known: true, mentionsKey: false },
        ],
        routines: [{ name: L("Point du lundi", "Monday check-in"), cron: "0 9 * * 1", timezone: "Europe/Paris", task: "…", describe: L("chaque lundi à 09:00", "every Monday at 09:00") }],
        unscheduled: [], nameTaken: false, suggestedName: "Léa", existingId: existing ? "bot_lea" : null, chief: true,
      },
      {
        name: "Max", role: L("Rédige les articles et les newsletters", "Writes the articles and newsletters"), personality: "",
        instructions: L("Tu écris dans le ton de chaque client, avec des phrases courtes.", "You write in each client's tone, with short sentences."),
        look: { shape: "mochi", color: "teal", character: ch({ type: "mascot", eyes: "round" }) }, model: "", modelAvailable: false,
        skills: [
          { kind: "inline", libraryId: "", name: L("Newsletter mensuelle", "Monthly newsletter"), when: L("Le premier lundi du mois", "On the first Monday of the month"), body: "…", known: true, mentionsKey: true },
          { kind: "library", libraryId: "plume-ancienne", name: "plume-ancienne", when: "", body: "", known: false, mentionsKey: false },
        ],
        routines: [{ name: L("Idées de la semaine", "Ideas of the week"), cron: "30 8 * * 1-5", timezone: "Europe/Paris", task: "…", describe: L("du lundi au vendredi à 08:30", "Monday to Friday at 08:30") }],
        unscheduled: [L("Relecture du soir (tous les soirs)", "Evening review (every evening)")],
        nameTaken: !existing, suggestedName: existing ? "Max" : "Max (2)", existingId: existing ? "bot_max" : null, chief: false,
      },
      {
        name: "Zoé", role: L("Publie et répond aux commentaires", "Publishes and answers comments"), personality: "", instructions: "",
        look: { shape: "pebble", color: "amber", character: ch({ type: "dots" }) }, model: "openai:gpt-5", modelAvailable: false,
        skills: [], routines: [], unscheduled: [], nameTaken: false, suggestedName: "Zoé", existingId: null, chief: false,
      },
    ],
    groups: [{ name: L("Comité éditorial", "Editorial board"), members: ["Léa", "Max", "Zoé"], rule: "auto", lead: "Léa", missing: [], existingId: existing ? "bot_room" : null }],
    connectors: [
      { name: "Google Drive", inCatalog: true, for: ["Max"], why: L("lire les briefs des clients", "read the clients' briefs") },
      { name: "Notion", inCatalog: true, for: [], why: "" },
      { name: L("Outil maison", "In-house tool"), inCatalog: false, for: ["Zoé"], why: "" },
    ],
    playbook: L("# Agence de contenu\n\nTrois bots qui écrivent, relisent et publient.\n\n## L'équipe\n\n- **Léa** (chef d'équipe) — coordonne\n- **Max** — rédige\n- **Zoé** — publie", "# Content agency\n\nThree bots that write, review and publish.\n\n## The team\n\n- **Léa** (team lead) — coordinates\n- **Max** — writes\n- **Zoé** — publishes"),
    masked: [{ where: L("Max › compétence 1", "Max › skill 1"), kind: "key" }],
    removed: [
      { where: L("en-tête", "header"), field: "api_key", reason: "secret" },
      { where: "Léa", field: "autonomy", reason: "forbidden" },
      { where: "Zoé", field: "memory", reason: "forbidden" },
    ],
    warnings: [{ code: "key_like", n: 1 }, { code: "unknown_library", n: 1, detail: "plume-ancienne" }, { code: "routine_no_cron", n: 1 }],
    room: { bots: null, activeRoutines: null },
    existing: existing ? { name: L("Agence de contenu", "Content agency"), bots: 2, updatedAt: Date.now() - 86_400_000 * 3 } : null,
    hasPrimary: true,
  };
}

export function teamMdReportFixture(): TeamMdReport {
  return { mode: "create", created: [{ id: "a", name: "Léa" }, { id: "b", name: "Max (2)" }, { id: "c", name: "Zoé" }], updated: [], skills: 3, routines: 2, groups: [{ id: "r", name: "Comité éditorial" }], section: { id: "s", name: "Agence de contenu" }, connectors: ["Google Drive", "Notion"], unscheduled: [] };
}

export function teamMdExportFixture(o: FixtureOptions): TeamMdExport {
  const fr = o.lang === "fr";
  const text = `---
format: sklubot-team/1
id: agence-contenu-7f3a
name: "${fr ? "Agence de contenu" : "Content agency"}"
version: "1"
language: ${o.lang}
chief: "Léa"
bots:
  - name: "Léa"
    role: "${fr ? "Coordonne l'équipe et le calendrier éditorial" : "Runs the team and the editorial calendar"}"
    look:
      shape: cat
      color: plum
      type: mascot
    instructions: |-
      ${fr ? "Tu reçois les demandes des clients et tu les confies à Max." : "You take the clients' requests and hand them to Max."}
    skills:
      - library: methode-de-travail
    routines:
      - name: "${fr ? "Point du lundi" : "Monday check-in"}"
        cron: "0 9 * * 1"
        timezone: Europe/Paris
        task: "${fr ? "Fais le point de la semaine." : "Review the week."}"
  - name: "Max"
    role: "${fr ? "Rédige les articles" : "Writes the articles"}"
groups:
  - name: "${fr ? "Comité éditorial" : "Editorial board"}"
    members: ["Léa", "Max"]
    rule: lead
    lead: "Léa"
connectors:
  - name: "Google Drive"
---

# ${fr ? "Agence de contenu" : "Content agency"}
`;
  return { filename: "agence-de-contenu.md", text, bots: 2, groups: 1, connectors: 1, masked: o.long ? 1 : 0 };
}
