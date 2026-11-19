import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// The offline export opens the timeline as a data URL in Chromium. Relative ESM imports
// need an absolute URL there. Read only these two shipped modules, never a project path.
export function studioCanvasSource() {
  const read = (name: string) =>
    stripTypeScriptTypes(
      readFileSync(
        new URL("../../web/src/lib/" + name, import.meta.url),
        "utf8",
      ),
    );
  const effects = Buffer.from(read("studioTechniques.ts"), "utf8").toString(
    "base64",
  );
  const timeline = read("studioStory.ts");
  const specifier = /\bfrom\s*["']\.\/studioTechniques\.ts["']/;
  if (!specifier.test(timeline))
    throw Error("Studio canvas module unavailable");
  return timeline.replace(
    specifier,
    'from "data:text/javascript;base64,' + effects + '"',
  );
}
