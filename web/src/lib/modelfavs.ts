/**
 * L150 « favoris » and « modèle retiré grisé » (pure, tested in scripts/model-favs.test.mjs) for the model menu above the
 * composer (ComposerMeta.tsx): starred models first (in the order they were starred), then the rest as the server lists
 * them; a model the conversation or the bot still names but that the server no longer offers is « retiré » — shown
 * greyed, never picked again from the menu.
 */
export const FAVS_MAX = 12;

export function orderModels<T extends { ref: string }>(models: T[], favs: string[]): T[] {
  const rank = new Map(favs.map((r, i) => [r, i]));
  const fav = models.filter((m) => rank.has(m.ref)).sort((a, b) => rank.get(a.ref)! - rank.get(b.ref)!);
  return [...fav, ...models.filter((m) => !rank.has(m.ref))];
}

/** Adds or removes a star; at most FAVS_MAX (the oldest star goes first). */
export function toggleFav(favs: string[], ref: string): string[] {
  if (favs.includes(ref)) return favs.filter((r) => r !== ref);
  return [...favs, ref].slice(-FAVS_MAX);
}

/** The refs named by the conversation or the bot that the server no longer lists (only once the list is loaded). */
export function retiredRefs(models: { ref: string }[] | null, named: (string | null | undefined)[]): string[] {
  if (!models) return [];
  const known = new Set(models.map((m) => m.ref));
  return [...new Set(named.filter((r): r is string => !!r && r.includes(":") && !r.endsWith(":default") && !known.has(r)))];
}

export function parseFavs(raw: string | null): string[] {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-FAVS_MAX) : []; } catch { return []; }
}
