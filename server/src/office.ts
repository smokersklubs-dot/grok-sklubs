import { computerKind, workspaceOf } from "./computer.js";
import { linuxExec } from "./linux.js";
import type { BuiltinTool, ToolOutput } from "./agent/tools.js";
import { clip } from "./store.js";

/**
 * Office documents on the bot's Linux computer with LibreOffice (headless): convert, recalculate formulas, render a page
 * to a picture. Run inside the bot's own container (docker exec, through linuxExec: no shell on this server, every value
 * passed as an argument). The input is never changed: LibreOffice works on a copy in a temporary folder, with a throwaway
 * profile per call (so calls never share a lock), and the result goes to a NEW file (a number is added to its name when
 * one already exists).
 *
 * Options used, as printed by `soffice --help` of LibreOffice 7.4.7 (Debian bookworm, the desktop image's version):
 * `--headless`, `--norestore`, `--convert-to OutputFileExtension[:OutputFilterName]`, `--outdir output_dir`,
 * `-env:UserInstallation=file:///…`. The text filter "txt:Text (encoded):UTF8" is the example given there.
 * Recalculation: the profile sets org.openoffice.Office.Calc/Formula/Load OOXMLRecalcMode and ODFRecalcMode to 0
 * ("always recalculate on load"; schema in /usr/lib/libreoffice/share/registry/main.xcd, default 1 = never), then the
 * file is converted to its own format. Checked on a workbook whose stored value was stale: kept without the setting,
 * recalculated with it. Rendering: PDF by LibreOffice, then `pdftoppm -f N -l N -singlefile -png -scale-to 1600`
 * (poppler-utils 22.12, `pdftoppm -h`); `pdfinfo` gives the page count.
 */

/** Formats office_convert can produce, and what `--convert-to` gets for each. */
export const CONVERT_TARGETS: Record<string, string> = {
  pdf: "pdf", docx: "docx", xlsx: "xlsx", pptx: "pptx", odt: "odt", ods: "ods", odp: "odp", csv: "csv", html: "html", txt: "txt:Text (encoded):UTF8", rtf: "rtf",
};
/** Files that can be recalculated, and the format they are saved back in. */
export const RECALC_TARGETS: Record<string, string> = { xlsx: "xlsx", xls: "xls", ods: "ods", fods: "fods", csv: "csv" };

export const OFFICE_SCRIPT = `set -u
mode="$1"; in="$2"; target="$3"; out="$4"; page="$5"
command -v soffice >/dev/null 2>&1 || { echo "LibreOffice is not installed on this computer: the server's desktop image must be rebuilt (or install it yourself: apt-get install -y libreoffice-calc-nogui libreoffice-writer-nogui libreoffice-impress-nogui poppler-utils)." >&2; exit 20; }
case "$in" in "~/"*) in="/root/\${in#"~/"}";; /*) ;; *) in="/root/$in";; esac
case "$out" in "") ;; "~/"*) out="/root/\${out#"~/"}";; /*) ;; *) out="/root/$out";; esac
[ -f "$in" ] || { echo "There is no file at $in." >&2; exit 21; }
tmp=$(mktemp -d /tmp/sklubot-office.XXXXXX); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/profile/user" "$tmp/in" "$tmp/out"
if [ "$mode" = recalc ]; then cat > "$tmp/profile/user/registrymodifications.xcu" <<'XCU'
<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
XCU
fi
base=$(basename -- "$in"); stem="\${base%.*}"
cp -- "$in" "$tmp/in/$base"
conv="$target"; [ "$mode" = render ] && conv=pdf
if [ "$mode" = render ] && [ "\${base##*.}" = pdf ]; then cp -- "$tmp/in/$base" "$tmp/out/$stem.pdf"; else
  soffice "-env:UserInstallation=file://$tmp/profile" --headless --norestore --convert-to "$conv" --outdir "$tmp/out" "$tmp/in/$base" >"$tmp/log" 2>&1
fi
made=$(ls "$tmp/out" | head -n 1)
[ -n "$made" ] || { echo "LibreOffice could not convert it:" >&2; tail -c 600 "$tmp/log" >&2; exit 22; }
ext="\${made##*.}"
if [ "$mode" = render ]; then
  pages=$(pdfinfo "$tmp/out/$made" 2>/dev/null | sed -n 's/^Pages:[[:space:]]*//p'); pages=\${pages:-1}
  [ "$page" -ge 1 ] && [ "$page" -le "$pages" ] || { echo "There is no page $page: the document has $pages page(s)." >&2; exit 23; }
  pdftoppm -f "$page" -l "$page" -singlefile -png -scale-to 1600 "$tmp/out/$made" "$tmp/page" || exit 24
  made="page.png"; ext=png; src="$tmp/page.png"; echo "PAGES $pages"
else src="$tmp/out/$made"; fi
if [ -z "$out" ]; then
  dir=$(dirname -- "$in")
  case "$mode" in recalc) out="$dir/$stem-recalculated.$ext";; render) out="$dir/$stem-page$page.png";; *) out="$dir/$stem.$ext";; esac
fi
mkdir -p "$(dirname -- "$out")"
final="$out"; n=1
while [ -e "$final" ]; do final="\${out%.*}-$n.\${out##*.}"; n=$((n+1)); done
cp -- "$src" "$final" || exit 25
echo "SAVED $final"
echo "SIZE $(wc -c < "$final")"
`;

/** The argument list for one office operation (exported for tests): `sh -c OFFICE_SCRIPT sh mode input target output page`. */
export function officeArgs(mode: "convert" | "recalc" | "render", a: { input: string; format?: string; output?: string; page?: number }): string[] | { error: string } {
  const input = String(a.input ?? "").trim();
  if (!input) return { error: "Give the path of the document." };
  if (/[\0\n]/.test(input) || /[\0\n]/.test(a.output ?? "")) return { error: "A path must be one line." };
  let target = "";
  if (mode === "convert") {
    const f = String(a.format ?? "").toLowerCase().replace(/^\./, "");
    target = CONVERT_TARGETS[f] ?? "";
    if (!target) return { error: `Unknown format "${a.format}". Choose one of: ${Object.keys(CONVERT_TARGETS).join(", ")}.` };
  } else if (mode === "recalc") {
    const ext = input.split(".").pop()?.toLowerCase() ?? "";
    target = RECALC_TARGETS[ext] ?? "";
    if (!target) return { error: `Only spreadsheets can be recalculated (${Object.keys(RECALC_TARGETS).join(", ")}).` };
  }
  const page = mode === "render" ? Math.max(1, Math.floor(Number(a.page) || 1)) : 1;
  return ["sh", "-c", OFFICE_SCRIPT, "sh", mode, input, target, String(a.output ?? "").trim(), String(page)];
}

/** What the script printed: the file it saved, its size, and (render) the page count. */
export function parseOfficeOutput(stdout: string): { saved: string; size: number; pages: number | null } {
  const saved = /^SAVED (.+)$/m.exec(stdout)?.[1] ?? "";
  return { saved, size: Number(/^SIZE (\d+)$/m.exec(stdout)?.[1] ?? 0), pages: /^PAGES (\d+)$/m.exec(stdout) ? Number(/^PAGES (\d+)$/m.exec(stdout)![1]) : null };
}

const home = (p: string) => p.replace(/^\/root\//, "~/");
type Runner = (botId: string, userId: string, argv: string[], timeoutSec: number, signal?: AbortSignal) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;
let runner: Runner = (botId, userId, argv, timeoutSec, signal) => linuxExec(botId, userId, workspaceOf(botId), argv, timeoutSec, { signal, maxBytes: 200_000 });
/** For tests: replace what runs the script (null puts the real one back). */
export const setOfficeRunner = (fn: Runner | null) => { runner = fn ?? ((botId, userId, argv, timeoutSec, signal) => linuxExec(botId, userId, workspaceOf(botId), argv, timeoutSec, { signal, maxBytes: 200_000 })); };
/** Reads a file of the bot's computer (the rendered picture). */
const readPng = (botId: string, userId: string, path: string, signal?: AbortSignal) =>
  linuxExec(botId, userId, workspaceOf(botId), ["cat", "--", path], 30, { signal, maxBytes: 12_000_000 }).then((r) => (r.code === 0 ? r.raw : null));

async function runOffice(mode: "convert" | "recalc" | "render", a: Record<string, any>, c: { bot: { id: string }; user: { id: string }; signal: AbortSignal }, timeoutSec: number) {
  const argv = officeArgs(mode, { input: a.input, format: a.format, output: a.output, page: a.page });
  if (!Array.isArray(argv)) return { error: argv.error };
  const r = await runner(c.bot.id, c.user.id, argv, timeoutSec, c.signal);
  if (r.timedOut) return { error: `LibreOffice took longer than ${timeoutSec} s and was stopped.` };
  if (r.code !== 0) return { error: clip(r.stderr.trim() || `failed (exit ${r.code})`, 800) };
  const out = parseOfficeOutput(r.stdout);
  return out.saved ? { ...out } : { error: "LibreOffice gave no file back." };
}

const str = (description: string) => ({ type: "string", description });
const PATH_HINT = "Path on your computer, e.g. ~/files/report.docx";

export const officeTools: BuiltinTool[] = [
  {
    spec: { name: "office_convert", description: "Convert an office document or spreadsheet with LibreOffice (on your computer) into another format: pdf, docx, xlsx, pptx, odt, ods, odp, csv, html, txt or rtf. The original is left as it is; the result is a new file (by default next to it, same name, new extension). csv takes the first sheet.", inputSchema: { type: "object", properties: { input: str(PATH_HINT), format: { type: "string", enum: Object.keys(CONVERT_TARGETS), description: "Format to produce" }, output: str("Optional path of the new file; a number is added if it exists") }, required: ["input", "format"] } },
    activity: "saving", label: "Converting a document", group: "files", detail: (a) => `${String(a.input ?? "").split("/").pop()} → ${a.format}`,
    run: async (a, c): Promise<ToolOutput> => {
      const r = await runOffice("convert", a, c, 180);
      if ("error" in r) return { content: r.error!, isError: true, summary: "not converted" };
      return { content: `Converted. Saved as ${home(r.saved)} (${r.size} bytes).`, summary: home(r.saved).split("/").pop() };
    },
  },
  {
    spec: { name: "office_recalculate", description: "Recalculate every formula of a spreadsheet (xlsx, xls, ods, fods, csv) with LibreOffice and save the result as a new file (by default <name>-recalculated.<ext> next to it). Use it after changing a spreadsheet with a script, before reading its computed values.", inputSchema: { type: "object", properties: { input: str("Path of the spreadsheet, e.g. ~/files/budget.xlsx"), output: str("Optional path of the new file; a number is added if it exists") }, required: ["input"] } },
    activity: "saving", label: "Recalculating a spreadsheet", group: "files", detail: (a) => String(a.input ?? "").split("/").pop(),
    run: async (a, c): Promise<ToolOutput> => {
      const r = await runOffice("recalc", a, c, 180);
      if ("error" in r) return { content: r.error!, isError: true, summary: "not recalculated" };
      return { content: `Recalculated and saved as ${home(r.saved)} (${r.size} bytes). To read the values, convert it to csv with office_convert.`, summary: home(r.saved).split("/").pop() };
    },
  },
  {
    spec: { name: "office_render", description: "See one page of a document, slide deck or spreadsheet (or a PDF) as a picture: LibreOffice prints it to PDF and the chosen page is rendered to PNG, saved next to it and shown to you. Slides are one page each; a spreadsheet's sheets are printed page after page.", inputSchema: { type: "object", properties: { input: str(PATH_HINT), page: { type: "integer", description: "Page (or slide) number, from 1 (default 1)" }, output: str("Optional path of the PNG; a number is added if it exists") }, required: ["input"] } },
    activity: "reading", label: "Looking at a document", group: "files", detail: (a) => `${String(a.input ?? "").split("/").pop()} p.${a.page ?? 1}`,
    run: async (a, c): Promise<ToolOutput> => {
      const r = await runOffice("render", a, c, 180);
      if ("error" in r) return { content: r.error!, isError: true, summary: "not rendered" };
      const png = await readPng(c.bot.id, c.user.id, r.saved, c.signal);
      const text = `Page ${Math.max(1, Math.floor(Number(a.page) || 1))} of ${r.pages ?? "?"}. Saved as ${home(r.saved)}.`;
      if (!png || png.length < 100) return { content: `${text} (The picture could not be read back.)`, summary: home(r.saved).split("/").pop() };
      return { content: [{ type: "text", text }, { type: "image", mediaType: "image/png", data: png.toString("base64") }], summary: `p.${a.page ?? 1}/${r.pages ?? "?"}` };
    },
  },
];

/** Office tools exist only where bots have a Linux computer. */
export const officeAvailable = () => computerKind() === "linux";
