/**
 * Texts for plain modules that node tests load without the app (lib/blockfold.ts…): they cannot import ./index (React,
 * the dictionaries), so they ask through this tiny registry, which ./index fills at start-up. Without it (in a node
 * test) the English text given by the caller is used. docs/LANGUES.md.
 */
type Lookup = (key: string, vars?: Record<string, string | number>) => string | undefined;
let lookup: Lookup | null = null;

export function setLookup(fn: Lookup): void {
  lookup = fn;
}

/** The text of `key` in the current language, else `english` (both with `{name}` filled from `vars`). */
export function text(key: string, english: string, vars: Record<string, string | number> = {}): string {
  const found = lookup?.(key, vars);
  if (found !== undefined && found !== key) return found;
  return english.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
