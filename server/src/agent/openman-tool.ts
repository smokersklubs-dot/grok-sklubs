import { readFileSync } from "node:fs";
import { workspaceOf } from "../computer.js";
import { linuxExec } from "../linux.js";
import { openmanProject, projectSchema } from "../openman-project.js";
import type { BuiltinTool } from "./tools.js";

const createProject = readFileSync(new URL("../../templates/openman/create-project.py", import.meta.url), "utf8");

export const openmanWorkspace: BuiltinTool = {
  spec: {
    name: "openman_workspace",
    description: "Start a new OpenMan-compatible project on this bot's own Sklubot Linux desktop. For a requested slide deck, supply the slide titles and points to produce an editable Impress document and a private HTML preview. Other kinds prepare folders for the bot's existing tools; they do not generate or deliver media. For revisions, read and edit the existing files.",
    inputSchema: projectSchema,
  },
  group: "shell", activity: "saving", audited: true, label: "Creating a project on the bot’s desktop",
  run: async (a, c) => {
    let project: ReturnType<typeof openmanProject>;
    try { project = openmanProject(a, c.user.locale); }
    catch (error) { return { content: (error as Error).message, isError: true }; }
    const r = await linuxExec(c.bot.id, c.user.id, workspaceOf(c.bot.id), ["python3", "-c", createProject], 30,
      { signal: c.signal, maxBytes: 2048, input: JSON.stringify(project) });
    const name = r.stdout.trim();
    if (r.code !== 0 || !/^openman-[a-f0-9]{32}$/.test(name))
      return { isError: true, content: "Could not save the project on this bot's desktop. " + r.stderr.slice(-400) };
    const root = "~/files/" + name;
    const next = project.rendered
      ? `Deliver the existing preview with artifact_from_file (file: ${name}/slides/exports/presentation.html). The editable source is ${root}/slides/exports/presentation.fodp. For a requested PDF or PowerPoint use office_convert on that source with format pdf or pptx, then deliver the returned file.`
      : `Project folders are ready. Create the requested output with your available tools and write its manifest at ${root}/${project.manifest}. Only deliver verified files.`;
    return { content: `Created ${root} on this bot's desktop. Check saved output with python3 ${root}/openman.py state. For a slide bundle run the same command with bundle. ${next}`, summary: String(a.title) };
  },
};
