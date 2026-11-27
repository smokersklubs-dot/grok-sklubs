// Types for the vendored KaTeX build (only what Sklubot calls). Options: https://katex.org/docs/options
export interface KatexOptions {
  displayMode?: boolean; output?: "html" | "mathml" | "htmlAndMathml"; throwOnError?: boolean; errorColor?: string;
  trust?: boolean; strict?: boolean | "ignore" | "warn" | "error"; maxSize?: number; maxExpand?: number;
}
export function renderToString(tex: string, options?: KatexOptions): string;
export const version: string;
declare const katex: { renderToString: typeof renderToString; version: string };
export default katex;
