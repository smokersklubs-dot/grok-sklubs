import { ModelOutputLimit } from "./llm/types.js";

type Stage = "selection" | "patch" | "review";
const label: Record<Stage, string> = { selection: "sélection des fichiers", patch: "préparation du correctif", review: "relecture" };
function matches(stage: Stage, value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (stage === "selection") return Array.isArray(value.paths) && value.paths.every((p: unknown) => typeof p === "string");
  if (stage === "review")
    return ["approved", "changes", "inconclusive"].includes(value.verdict) && typeof value.reason === "string" && !!value.reason.trim();
  return Array.isArray(value.files) && value.files.every((f: any) => f && typeof f.path === "string" &&
    (typeof f.content === "string" || Array.isArray(f.edits) &&
      f.edits.every((e: any) => e && typeof e.oldText === "string" && typeof e.newText === "string")));
}
class FormatError extends Error {}
// Parse maximal objects only. Recover a complete answer surrounded by commentary, never a fragment of a cut-off patch.
function decode(stage: Stage, text: string) {
  const input = text.trim();
  if (!input) throw new FormatError("réponse vide");
  if (input.length > 160_000) throw new FormatError("réponse trop longue");
  const stack: string[] = [];
  let from = 0, quoted = false, escaped = false, result: any, objects = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === "{" || c === "[") {
      if (!stack.length) from = i;
      stack.push(c === "{" ? "}" : "]");
    } else if (stack.length && c === '"') quoted = true;
    else if (stack.length && (c === "}" || c === "]")) {
      if (c !== stack.pop()) throw new FormatError("JSON invalide");
      if (!stack.length) {
        let value;
        try { value = JSON.parse(input.slice(from, i + 1)); }
        catch { if (input[from] === "{") throw new FormatError("JSON invalide"); }
        if (value && typeof value === "object" && !Array.isArray(value)) {
          objects++;
          if (matches(stage, value)) result = value;
        }
      }
    }
  }
  if (stack.length) throw new FormatError("JSON interrompu");
  if (objects > 1) throw new FormatError("plusieurs réponses possibles");
  if (!result) throw new FormatError(objects ? "structure inattendue" : "objet JSON absent");
  return result;
}
export function structuredGithubReplies(call: (system: string, data: object) => Promise<string>) {
  let repairAvailable = true;
  return async (stage: Stage, system: string, data: object) => {
    for (;;) {
      try { return decode(stage, await call(system, data)); }
      catch (err) {
        if (!(err instanceof FormatError || err instanceof ModelOutputLimit)) throw err;
        if (!repairAvailable) throw Error("Réponse du modèle inutilisable pendant la " + label[stage] + " (" + err.message + "). Reprends la mission pour réessayer.");
        repairAvailable = false;
        system += " Your previous answer did not provide a single usable JSON object. Answer the original request afresh with exactly one complete object in the requested schema. Omit introductions, examples and Markdown fences. Keep the response short; prefer small exact replacements for existing files.";
      }
    }
  };
}
