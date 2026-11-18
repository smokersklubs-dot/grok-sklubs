import { readFileSync } from "node:fs";

const assets = new URL("../templates/artifacts/", import.meta.url);

// Only these two shipped assets are read. Neither path comes from a tool argument.
export const atelierTokens = () => {
  const css = readFileSync(new URL("atelier-zero.css", assets), "utf8");
  const license = readFileSync(new URL("OpenDesign-LICENSE", assets), "utf8");
  return css + "\n/*! OpenDesign, Atelier Zero — https://github.com/nexu-io/open-design\n" + license + "\n*/\n";
};
