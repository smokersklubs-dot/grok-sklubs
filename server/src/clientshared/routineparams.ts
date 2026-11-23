/**
 * L143 — a routine's parameters (Spec Kit's "inputs asked at launch", written from the idea only). A routine's
 * instruction may hold `{{city}}` or `{{city=Paris}}`. « Lancer maintenant » then shows a small form with one field per
 * parameter (filled with its default); a scheduled run uses the defaults. A parameter with no default and no value stays
 * written as it is, so the bot sees it was not given. Shared by the server (scheduler) and the web form.
 */
export interface RoutineParam { name: string; fallback: string }

export const MAX_PARAMS = 10;
export const MAX_PARAM_VALUE = 500;
const PLACEHOLDER = /\{\{\s*([\p{L}\p{N}_][\p{L}\p{N}_ -]{0,39}?)\s*(?:=([^{}\n]{0,200}))?\}\}/gu;

/** The parameters of an instruction, in order of first appearance; the first default given wins. */
export function routineParams(prompt: string): RoutineParam[] {
  const out: RoutineParam[] = [];
  for (const m of prompt.matchAll(PLACEHOLDER)) {
    const name = m[1].trim();
    const known = out.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (known) { if (!known.fallback && m[2]) known.fallback = m[2].trim(); continue; }
    if (out.length >= MAX_PARAMS) break;
    out.push({ name, fallback: (m[2] ?? "").trim() });
  }
  return out;
}

/** Values as received (any JSON): at most MAX_PARAMS strings of at most MAX_PARAM_VALUE characters, on one line. */
export function cleanParamValues(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_PARAMS)) {
    if (typeof v !== "string" && typeof v !== "number") continue;
    const key = k.trim().slice(0, 40);
    const value = String(v).replace(/[\r\n]+/g, " ").replace(/\{\{|\}\}/g, "").trim().slice(0, MAX_PARAM_VALUE);
    if (key) out[key.toLowerCase()] = value;
  }
  return out;
}

/** The instruction with its parameters filled: the value given, else the default, else the placeholder as written. */
export function fillParams(prompt: string, values: Record<string, string> = {}): string {
  const params = routineParams(prompt);
  if (!params.length) return prompt;
  const given = cleanParamValues(values);
  return prompt.replace(PLACEHOLDER, (all, rawName: string) => {
    const p = params.find((x) => x.name.toLowerCase() === rawName.trim().toLowerCase());
    if (!p) return all;
    const v = given[p.name.toLowerCase()];
    return v ? v : p.fallback ? p.fallback : all;
  });
}
