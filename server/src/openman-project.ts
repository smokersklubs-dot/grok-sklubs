import { readFileSync } from "node:fs"; import type { Locale } from "./shared.js";
import { SLIDE_THEMES, themeById, themeCss, type SlideTheme } from "./openman-themes.js";

// OpenMan 12ea5bdd: src/lib/generators/registry.ts and types.ts define these portable project paths.
// A manifest belongs to the producer of the actual output. Never fabricate one for an empty project.
const manifests = {
  slides: "slides/deck.json", data: "analysis/analysis.json", research: "research/research.json",
  audio: "audio/audio.json", image: "images/images.json", video: "video/video.json",
} as const;
type Kind = keyof typeof manifests;
const kinds = Object.keys(manifests) as Kind[];
const themes = SLIDE_THEMES.map(t => t.id);
const asset = (file: string) => readFileSync(new URL(`../templates/openman/${file}`, import.meta.url), "utf8");
const licence = asset("LICENSE");
const notice = asset("NOTICE");
const projectCli = asset("project-cli.py");

export const projectSchema = {
  type: "object" as const, required: ["kind", "title"],
  properties: {
    kind: { type: "string", enum: kinds }, title: { type: "string", maxLength: 140 },
    theme: { type: "string", enum: themes, description: "Slide palette. Defaults to graphite." },
    slides: { type: "array", minItems: 1, maxItems: 40, description: "Supply the complete content to render an editable presentation immediately.",
      items: { type: "object", required: ["title"], properties: {
        title: { type: "string", maxLength: 100 }, points: { type: "array", maxItems: 5, items: { type: "string", maxLength: 120 } },
      } } },
  },
};

function field(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value))
    throw new Error(`Invalid ${label} (1 to ${max} characters).`);
  return value.trim();
}
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
type Slide = { title: string; points: string[] };
function readSlide(item: unknown): Slide {
  const value = item as Partial<Slide> | null;
  const title = field(value?.title, 100, "slide title");
  const points = value?.points ?? [];
  if (!Array.isArray(points) || points.length > 5) throw new Error("Use up to five points per slide.");
  return { title, points: points.map(p => field(p, 120, "slide point")) };
}

function impress(slides: Slide[], theme: SlideTheme) {
  const box = (y: number, height: number, style: string, lines: string[]) =>
    `<draw:frame draw:style-name="TextBox" svg:x="1.8cm" svg:y="${y}cm" svg:width="24.4cm" svg:height="${height}cm"><draw:text-box>${lines.map(t => `<text:p text:style-name="${style}">${escape(t)}</text:p>`).join("")}</draw:text-box></draw:frame>`;
  const { text, bg, accent } = theme.vars;
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation">
<office:automatic-styles><style:page-layout style:name="Wide"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm" style:print-orientation="landscape"/></style:page-layout>
<style:style style:name="Background" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="${bg}"/></style:style>
<style:style style:name="TextBox" style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="none" fo:padding="0cm"/></style:style>
<style:style style:name="Title" style:family="paragraph"><style:text-properties fo:font-size="26pt" fo:font-weight="bold" fo:color="${accent}"/></style:style>
<style:style style:name="Point" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.2cm"/><style:text-properties fo:font-size="18pt" fo:color="${text}"/></style:style></office:automatic-styles>
<office:master-styles><style:master-page style:name="Default" style:page-layout-name="Wide"/></office:master-styles><office:body><office:presentation>
${slides.map((s, i) => `<draw:page draw:name="${i + 1}" draw:style-name="Background" draw:master-page-name="Default">${box(1, 3, "Title", [s.title])}${box(4.5, 10, "Point", s.points.map(p => "• " + p))}</draw:page>`).join("\n")}
</office:presentation></office:body></office:document>`;
}

function deckFiles(title: string, slides: Slide[], theme: SlideTheme, locale: Locale) {
  const files: Record<string, string> = {};
  const css = themeCss(theme) + "\n/*!\n" + licence + "\n*/";
  const section = (s: Slide) => `<section class="slide center"><h2>${escape(s.title)}</h2>${s.points.length ? `<ul class="bullets">${s.points.map(p => `<li>${escape(p)}</li>`).join("")}</ul>` : ""}</section>`;
  const header = (label: string) => `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(label)}</title>`;
  const entries = slides.map((s, i) => {
    const file = `${String(i + 1).padStart(2, "0")}.html`;
    files[`slides/${file}`] = header(s.title) + '<link rel="stylesheet" href="theme.css"></head><body>' + section(s) + "</body></html>";
    return { file, title: s.title };
  });
  files["slides/theme.css"] = css;
  files["slides/deck.json"] = JSON.stringify({ version: 1, title, theme: theme.id, width: 1280, height: 720, slides: entries });
  files["slides/exports/presentation.fodp"] = impress(slides, theme);
  files["slides/exports/presentation.html"] = header(title) + `<style>${css}
html,body{width:100%;height:auto;overflow:visible}main{max-width:80rem;margin:auto}.slide{width:100%;min-height:70vh;height:auto;padding:clamp(1rem,6vw,5rem);overflow-wrap:anywhere;border-bottom:1px solid var(--rule)}h2{font-size:clamp(1.6rem,4vw,3rem)}li{font-size:clamp(1rem,2.2vw,1.65rem)}@page{size:landscape;margin:0}@media print{.slide{break-after:page;min-height:90vh;print-color-adjust:exact}.slide:last-child{break-after:auto}}</style></head><body><main>${slides.map(section).join("")}</main></body></html>`;
  return files;
}

export function openmanProject(a: Record<string, unknown>, locale: Locale) {
  if (!kinds.includes(a.kind as Kind)) throw new Error("Choose one of the listed project kinds.");
  const kind = a.kind as Kind;
  const title = field(a.title, 140, "project title");
  if (a.theme !== undefined && (kind !== "slides" || !themes.includes(String(a.theme)))) throw new Error("Choose a listed theme for a slide project.");
  const theme = themeById(typeof a.theme === "string" ? a.theme : undefined);
  const files: Record<string, string> = {
    ".openman/generator.json": JSON.stringify({ version: 1, kind, ...(kind === "slides" ? { theme: theme.id } : {}), createdAt: new Date().toISOString() }),
    "project.json": JSON.stringify({ title, manifest: manifests[kind] }), "openman.py": projectCli,
    "LICENSE-OpenMan.txt": licence, "NOTICE-OpenMan.txt": notice,
  };
  if (a.slides !== undefined) {
    if (kind !== "slides" || !Array.isArray(a.slides) || !a.slides.length || a.slides.length > 40) throw new Error("Use 1 to 40 slides in a slide project.");
    Object.assign(files, deckFiles(title, a.slides.map(readSlide), theme, locale));
  } else if (kind === "slides") files["slides/theme.css"] = themeCss(theme) + "\n/*!\n" + licence + "\n*/";
  return { files, manifest: manifests[kind], directory: manifests[kind].split("/")[0]!, rendered: a.slides !== undefined };
}
