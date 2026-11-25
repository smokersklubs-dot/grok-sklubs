import { q } from "./db.js";
import { now } from "./store.js";

/**
 * L150 « Préréglages par projet » (backlog A-FAIRE; idea from the Agent Zero audit, "model presets selectable per project",
 * behaviour only, our own code). A project is a sidebar section (store.ts sections, « Projet · {name} »). Its preset is a
 * model and/or a reasoning level that the bots filed in it use for the owner's own conversations, when that conversation
 * has no choice of its own (convs.ts). Order of choice: the conversation's own choice, then the project's preset, then the
 * bot's own settings (agent/workmodel.ts). Routines and background work keep their own models (unchanged).
 *
 * A preset never makes a model run that could not run anyway: the same checks as a conversation's model apply (a model
 * whose provider is not set up, or a subscription engine the bot is not set up for, is ignored).
 */
q.run(`CREATE TABLE IF NOT EXISTS section_model_presets (
  section_id TEXT PRIMARY KEY REFERENCES bot_sections(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`);

export const PRESET_EFFORTS = ["", "low", "medium", "high", "xhigh"] as const;
export interface ProjectPreset { model: string; effort: string }
export class PresetError extends Error { constructor(public status: 400 | 404, message: string) { super(message); } }

const MODEL_REF = /^[A-Za-z0-9._:/@+-]{1,120}$/;

export function projectPreset(userId: string, sectionId: string | null | undefined): ProjectPreset {
  if (!sectionId) return { model: "", effort: "" };
  const r = q.get<{ model: string; effort: string }>("SELECT model, effort FROM section_model_presets WHERE section_id = ? AND user_id = ?", sectionId, userId);
  return { model: r?.model ?? "", effort: r?.effort ?? "" };
}

/** Saves a project's preset (empty model and level: removes it). `modelOk` says whether a model ref is offered to this account. */
export function setProjectPreset(userId: string, sectionId: string, raw: { model?: unknown; effort?: unknown }, modelOk: (ref: string) => boolean): ProjectPreset {
  if (!q.get("SELECT 1 FROM bot_sections WHERE id = ? AND user_id = ?", sectionId, userId)) throw new PresetError(404, "That section does not exist.");
  const cur = projectPreset(userId, sectionId);
  const model = raw.model === undefined ? cur.model : String(raw.model ?? "").trim();
  const effort = raw.effort === undefined ? cur.effort : String(raw.effort ?? "").trim();
  if (model && (!MODEL_REF.test(model) || !modelOk(model))) throw new PresetError(400, "Choose an available model.");
  if (!(PRESET_EFFORTS as readonly string[]).includes(effort)) throw new PresetError(400, "Choose a reasoning level: light, normal, deep or maximum.");
  if (!model && !effort) q.run("DELETE FROM section_model_presets WHERE section_id = ? AND user_id = ?", sectionId, userId);
  else q.run(`INSERT INTO section_model_presets (section_id, user_id, model, effort, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (section_id) DO UPDATE SET model = excluded.model, effort = excluded.effort, updated_at = excluded.updated_at`, sectionId, userId, model, effort, now());
  return projectPreset(userId, sectionId);
}
