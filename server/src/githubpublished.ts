import { materializeGithubChange, validFile, type GitRequest, type Context, type Change } from "./githubissuegit.js";
import { gitBlobSha } from "./githubprotected.js";

const objectId = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{40}$/.test(s);
const mismatch = () => new Error("Les fichiers ou les modes de la PR diffèrent du correctif relu.");
type Entry = { path: string; type: string; mode: string; sha: string };

export function draftNumber(repo: string, value: unknown) {
  const text = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  const link = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)\/?$/i.exec(text);
  const number = link?.[1].toLowerCase() === repo.toLowerCase() ? Number(link[2]) : /^#?[1-9]\d*$/.test(text) ? Number(text.replace("#", "")) : 0;
  if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647)
    throw Error("Indique le numéro de la PR ou son lien dans ce dépôt.");
  return number;
}

/** Prove the complete tree delta. An unchanged subtree is verified by its Git object ID. */
async function verifyTrees(get: GitRequest, ctx: Context, headTree: string, changes: Change[]) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 5) throw mismatch();
  const expected = new Map<string, { sha: string; mode: string; before: string | null }>();
  for (const change of changes) {
    if (!validFile(change.path) || !["100644", "100755"].includes(change.mode) || expected.has(change.path))
      throw mismatch();
    const content = await materializeGithubChange(get, ctx, change);
    const before = change.protectedLines?.blob ?? (change.before === null ? null : gitBlobSha(change.before));
    expected.set(change.path, { sha: gitBlobSha(content), mode: change.mode, before });
  }
  const paths = [...expected.keys()];
  const verified = new Set<string>();
  const read = async (id: string | undefined) => {
    const map = new Map<string, Entry>();
    if (id === undefined) return map;
    if (!objectId(id)) throw mismatch();
    const tree = await get("/git/trees/" + id);
    if (tree.sha !== id || tree.truncated !== false || !Array.isArray(tree.tree)) throw mismatch();
    for (const item of tree.tree) {
      if (!item || typeof item.path !== "string" || !item.path || item.path.includes("/") ||
          map.has(item.path) || !objectId(item.sha) || typeof item.mode !== "string" || typeof item.type !== "string")
        throw mismatch();
      map.set(item.path, item);
    }
    return map;
  };
  async function compare(prefix: string, base: string | undefined, head: string) {
    const [old, next] = await Promise.all([read(base), read(head)]);
    for (const name of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(name), b = next.get(name);
      if (a && b && a.sha === b.sha && a.mode === b.mode && a.type === b.type) continue;
      const path = prefix + name, want = expected.get(path);
      if (want) {
        if (!b || b.type !== "blob" || b.mode !== want.mode || b.sha !== want.sha ||
            (a?.sha ?? null) !== want.before || (a && (a.type !== "blob" || a.mode !== want.mode))) throw mismatch();
        verified.add(path);
      } else {
        if (!b || b.type !== "tree" || b.mode !== "040000" ||
            (a && (a.type !== "tree" || a.mode !== b.mode)) ||
            !paths.some(p => p.startsWith(path + "/"))) throw mismatch();
        await compare(path + "/", a?.sha, b.sha);
      }
    }
  }
  await compare("", ctx.tree, headTree);
  if (verified.size !== expected.size) throw mismatch();
}

export async function verifyPublishedDraft(get: GitRequest, repo: string, branch: string, number: number,
  ctx: Context, patch: Change[]) {
  const sameRepo = (name: unknown) => typeof name === "string" && name.toLowerCase() === repo.toLowerCase();
  const repository = await get("");
  if (repository.private !== false || !sameRepo(repository.full_name) || !Number.isSafeInteger(repository.id) || repository.id < 1)
    throw Error("Cette action nécessite un dépôt GitHub public.");
  if (!objectId(ctx.sha) || !objectId(ctx.tree)) throw mismatch();
  const getHead = async () => {
    const pr = await get("/pulls/" + number);
    if (pr.number !== number || pr.state !== "open" || pr.draft !== true || pr.merged !== false || pr.commits !== 1 ||
        pr.base?.repo?.id !== repository.id || pr.head?.repo?.id !== repository.id ||
        !sameRepo(pr.base.repo.full_name) || !sameRepo(pr.head.repo.full_name) ||
        pr.base.ref !== ctx.base || pr.base.sha !== ctx.sha || pr.head.ref !== branch || !objectId(pr.head.sha))
      throw Error("Vérifie le dépôt, la branche, la base et le commit unique de cette PR brouillon ouverte.");
    return pr.head.sha as string;
  };
  const head = await getHead();
  const commit = await get("/git/commits/" + head);
  if (commit.sha !== head || !Array.isArray(commit.parents) || commit.parents.length !== 1 ||
      commit.parents[0]?.sha !== ctx.sha || !objectId(commit.tree?.sha)) throw mismatch();
  await verifyTrees(get, ctx, commit.tree.sha, patch);
  if (await getHead() !== head) throw Error("La PR a changé pendant la vérification.");
  return head;
}
