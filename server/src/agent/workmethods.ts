import { readFileSync } from "node:fs";
import type { Guide } from "../shared.js";

export interface ReadableGuide extends Guide { body: string }

export function guideKey(title: string): string {
  return title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// The portable manual doubles as the source for the bot's on-demand procedures.
const manual = readFileSync(new URL("../../templates/methodes/manuel.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const groups = manual.split(/^## /m).slice(1).map((section) => {
  const [content, references] = section.trim().split(/^Références · /m);
  const [intro, ...entries] = content.trim().split(/^### /m);
  const [name, ...summary] = intro.trim().split("\n");
  const description = summary.join("\n").trim();
  const sources = "Références · " + references.trim();
  const methods = entries.map((entry): ReadableGuide => {
    const [title, ...instructions] = entry.trim().split("\n");
    return { id: guideKey(title), name: title, description, body: instructions.join("\n").trim() + "\n\n" + sources };
  });
  const guide: ReadableGuide = { id: guideKey(name), name, description, body: entries.map((e) => "### " + e.trim()).join("\n\n") + "\n\n" + sources };
  return { guide, methods };
});

export const methodDirectory: ReadableGuide = {
  id: "methodes", name: "Répertoire des méthodes de travail",
  description: "Browse the working methods by topic, then read a family or an individual procedure by its title.",
  body: groups.map(({ guide, methods }) => "## " + guide.name + "\n" + methods.map((m) => "- " + m.name).join("\n")).join("\n\n"),
};

export const methodFamilies = groups.map(({ guide }) => guide);
export const individualMethods = groups.flatMap(({ methods }) => methods);

const catalogue = readFileSync(new URL("../../templates/methodes/opendesign.md", import.meta.url), "utf8");
const sourceGroups = catalogue.split(/^## /m).slice(1).map((section) => {
  const name = section.split("\n", 1)[0].trim();
  const entries = Array.from(section.matchAll(/^- \[([\w-]+)\]\((https:\/\/[^\s)]+)\)/gm), ([, slug, url]) => ({ slug, url }));
  return { name, entries };
});
export const designDirectory: ReadableGuide = {
  id: "opendesign", name: "Répertoire des ressources OpenDesign",
  description: "Browse source workflows and templates for visual design, video, ads, audio, Figma and presentations.",
  body: ["Utilise guide_read avec opendesign/ suivi de l’identifiant pour retrouver la procédure d’origine.",
    ...sourceGroups.map(({ name, entries }) => "## " + name + "\n" + entries.map((e) => e.slug).join(", "))].join("\n\n"),
};
export const designReferences: ReadableGuide[] = sourceGroups.flatMap(({ name, entries }) => entries.map(({ slug, url }) => ({
  id: "opendesign-" + slug, name: "opendesign/" + slug, description: name,
  body: "Consulte la source pour lire la procédure, ses exemples et ses prérequis. Choisis les étapes utiles avec les outils actifs du bot.\n\n[Source OpenDesign · " + slug + "](" + url + ")",
})));
