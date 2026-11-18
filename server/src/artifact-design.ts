import { readFileSync } from "node:fs";

const assets = new URL("../templates/artifacts/", import.meta.url);

// Only these two shipped assets are read. Neither path comes from a tool argument.
export const atelierTokens = () => {
  const css = readFileSync(new URL("atelier-zero.css", assets), "utf8");
  const license = readFileSync(new URL("OpenDesign-LICENSE", assets), "utf8");
  return css + "\n/*! OpenDesign, Atelier Zero — https://github.com/nexu-io/open-design\n" + license + "\n*/\n";
};
export function layoutExpression(reference: string) {
  const expected = new URL(reference);
  if (!["http:", "https:"].includes(expected.protocol) || expected.password || expected.username)
    throw new Error("Give a public web reference without credentials.");
  const script = readFileSync(new URL("craft-layout.js", assets), "utf8");
  // Check the reference inside the same evaluation as the measurement, even if the tab navigates.
  return `location.href.split("#")[0] === ${JSON.stringify(expected.href.split("#")[0])}
    ? (${script}) : {error:"Open the specified reference in the browser first."}`;
}
