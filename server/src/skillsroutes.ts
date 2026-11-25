import type { Context, Hono } from "hono"; import { localize } from "./lang/index.js";
import { RateWindow } from "./hardening.js";
import type { Locale } from "./shared.js";
import { commitGithub, githubImportAllowed, GithubError, previewGithub } from "./skillsgithub.js";
import { registerSkillScanRoutes } from "./skillscanroutes.js";
import { registerSkillHealthRoutes } from "./skillhealthroutes.js";
import { addFromLibrary, LibraryError, libraryFor } from "./skillslibrary.js";
import type { UserRecord } from "./store.js";

/**
 * « Bibliothèque de compétences » (skillslibrary.ts, skillsgithub.ts, docs/COMPETENCES.md), registered after the
 * session check. Everything acts on the signed-in account's own bots only.
 *   GET  /skills-library                       the bundled skills, in the account's language, and whether GitHub import is allowed
 *   POST /skills-library/:id/add               { target: "all" | botId } adds it (idempotent)
 *   POST /skills-library/github/preview        { url } the SKILL.md files of a public github.com repository (nothing saved)
 *   POST /skills-library/github/commit         { previewId, paths, target } imports the chosen ones as drafts
 */
const FR: Record<string, string> = {
  "That skill is not in the library.": "Cette compétence n'est pas dans la bibliothèque.",
  "That bot does not exist.": "Ce bot n'existe pas.",
  "Create a bot first.": "Crée d'abord un bot.",
  "Paste the address of a GitHub repository, like https://github.com/owner/repository.": "Colle l'adresse d'un dépôt GitHub, comme https://github.com/proprietaire/depot.",
  "Only public repositories on github.com can be imported.": "Seuls les dépôts publics de github.com peuvent être importés.",
  "That GitHub address is not a repository or one of its folders.": "Cette adresse GitHub n'est pas un dépôt ni un de ses dossiers.",
  "This repository is too large to import (15 MB at most). Point to the folder of the skills you want.": "Ce dépôt est trop gros pour être importé (15 Mo au plus). Donne l'adresse du dossier des compétences voulues.",
  "GitHub sent the download somewhere else: it was refused.": "GitHub a renvoyé le téléchargement ailleurs : il a été refusé.",
  "GitHub could not be reached. Try again in a moment.": "GitHub ne répond pas. Réessaie dans un moment.",
  "GitHub is limiting downloads right now. Try again in a few minutes.": "GitHub limite les téléchargements en ce moment. Réessaie dans quelques minutes.",
  "GitHub answered with an error (status {status}).": "GitHub a répondu par une erreur (code {status}).",
  "This repository was not found, or it is private. Only public repositories can be imported.": "Ce dépôt est introuvable ou privé. Seuls les dépôts publics peuvent être importés.",
  "This download is not a readable archive: {detail}": "Ce téléchargement n'est pas une archive lisible : {detail}",
  "No SKILL.md file was found at this address.": "Aucun fichier SKILL.md n'a été trouvé à cette adresse.",
  "This preview has expired. Look the repository up again.": "Cet aperçu a expiré. Relance la recherche du dépôt.",
  "Importing skills from GitHub is not included in your plan.": "L'import de compétences depuis GitHub n'est pas compris dans ton offre.",
  "Too many lookups. Wait a little and try again.": "Trop de recherches. Attends un peu et réessaie.",
  "Choose at least one skill.": "Choisis au moins une compétence.",
};
const say = (loc: Locale | undefined, en: string, vars: Record<string, string | number> = {}) =>
  localize(loc, en, FR).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));

const previews = new RateWindow(10, 3_600_000);
const writes = new RateWindow(60, 60_000);

export function registerSkillsLibraryRoutes(api: Hono<any>) {
  registerSkillScanRoutes(api); // « Contrôle de sécurité des compétences » (skillscanroutes.ts)
  registerSkillHealthRoutes(api); // « Santé des compétences », « Catalogue de l'équipe », banc d'essai (skillhealthroutes.ts)
  const handle = (fn: (c: Context, user: UserRecord, b: Record<string, any>) => Promise<Response> | Response) => async (c: Context) => {
    const user = c.get("user") as UserRecord;
    try {
      let b: Record<string, any> = {};
      if (c.req.method !== "GET") {
        if (writes.over(user.id)) throw new GithubError(429, "Too many lookups. Wait a little and try again.");
        const parsed = await c.req.json().catch(() => ({}));
        b = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      }
      return await fn(c, user, b);
    } catch (err) {
      if (err instanceof GithubError) return c.json({ error: say(user.locale, err.message, err.vars) }, err.status);
      if (err instanceof LibraryError) return c.json({ error: say(user.locale, err.message) }, err.status);
      throw err;
    }
  };
  const target = (b: Record<string, any>) => (typeof b.target === "string" && b.target ? b.target : "all");

  api.get("/skills-library", handle((c, user) => c.json({ skills: libraryFor(user.id, user.locale), github: githubImportAllowed(user.id) })));
  api.post("/skills-library/:id/add", handle((c, user, b) => c.json({ report: addFromLibrary(user.id, c.req.param("id")!, target(b), user.locale) })));
  api.post("/skills-library/github/preview", handle(async (c, user, b) => {
    if (previews.over(user.id)) throw new GithubError(429, "Too many lookups. Wait a little and try again.");
    return c.json({ preview: await previewGithub(user.id, String(b.url ?? ""), AbortSignal.timeout(60_000)) });
  }));
  api.post("/skills-library/github/commit", handle((c, user, b) => {
    const paths = Array.isArray(b.paths) ? b.paths.filter((p: unknown): p is string => typeof p === "string").slice(0, 100) : [];
    if (!paths.length) throw new GithubError(400, "Choose at least one skill.");
    return c.json({ report: commitGithub(user.id, String(b.previewId ?? ""), paths, target(b)) });
  }));
}
