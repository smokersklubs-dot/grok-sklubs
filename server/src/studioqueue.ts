import { randomUUID } from "node:crypto"; import { tr } from "./i18n.js";
import { q } from "./db.js";
import { attachmentAt } from "./computer.js";
import { bots, rows, type BotRecord } from "./store.js";
import type { Attachment } from "./shared.js";
import type { StudioStory } from "./videostudio.js";

type State = "queued" | "working" | "failed" | "ready";
interface RenderJob {
  id: string;
  bot: string;
  generation: number;
  project: string;
  version: number;
  thread: number;
  narration: number;
  language: string;
  locale: string;
  story: string;
  state: State;
  lease: string | null;
  attempts: number;
  file: string | null;
  error: string | null;
}
type Encoder = (
  bot: BotRecord,
  story: StudioStory,
  narration: boolean,
  locale: string,
  language: string,
  stillOwned: () => boolean,
) => Promise<Attachment>;
const leaseMs = 90_000;
const active = new Set<string>();
const get = (id: string) => q.get<RenderJob>("SELECT * FROM studio_exports WHERE id=?", id);
export function exportStatus(item: RenderJob) {
  const file = item.file ? (JSON.parse(item.file) as Attachment) : undefined;
  if (item.state === "ready" && file && !attachmentAt(item.bot, file.path)) {
    return {
      id: item.id,
      narration: !!item.narration,
      language: item.language,
      state: "failed" as const,
      file: undefined,
      error:
        tr(item.locale, "The file was removed. You can render it again."),
    };
  }
  return {
    id: item.id,
    narration: !!item.narration,
    language: item.language,
    state: item.state,
    file,
    error: item.error,
  };
}
export function latestExport(bot: BotRecord, project: string, version: number, thread: number) {
  return q.get<RenderJob>(
    "SELECT * FROM studio_exports WHERE bot=? AND generation=? AND project=? AND version=? AND thread=? ORDER BY updated DESC,rowid DESC LIMIT 1",
    bot.id,
    bot.generation,
    project,
    version,
    thread,
  );
}
export function findExport(
  bot: BotRecord,
  project: string,
  version: number,
  thread: number,
  voice: boolean,
  language: string,
) {
  return q.get<RenderJob>(
    `SELECT * FROM studio_exports WHERE bot=? AND generation=? AND project=? AND version=? AND thread=? AND narration=? AND language=?`,
    bot.id,
    bot.generation,
    project,
    version,
    thread,
    Number(voice),
    language,
  );
}
export function enqueueExport(
  bot: BotRecord,
  project: string,
  version: number,
  thread: number,
  voice: boolean,
  language: string,
  locale: string,
  story: StudioStory,
) {
  return q.tx(() => {
    const old = findExport(bot, project, version, thread, voice, language);
    if (
      old &&
      (old.state === "queued" ||
        old.state === "working" ||
        (old.state === "ready" && old.file && attachmentAt(bot.id, JSON.parse(old.file).path)))
    )
      return exportStatus(old);
    const count = q.get<{ n: number }>(
      "SELECT count(*) n FROM studio_exports WHERE bot=? AND state IN ('working','queued')",
      bot.id,
    )!.n;
    if (count >= 8)
      throw Error(
        tr(locale, "Eight renders are already waiting on this desktop."),
      );
    const id = old?.id ?? randomUUID();
    if (old)
      q.run(
        "UPDATE studio_exports SET state='queued', lease=NULL, expires=0, attempts=0, file=NULL, error=NULL, updated=? WHERE id=?",
        Date.now(),
        id,
      );
    else
      q.run(
        `INSERT INTO studio_exports(id,bot,generation,project,version,thread,narration,language,locale,story,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        bot.id,
        bot.generation,
        project,
        version,
        thread,
        Number(voice),
        language,
        locale,
        JSON.stringify(story),
        Date.now(),
      );
    return exportStatus(get(id)!);
  });
}
export function ownedExport(bot: BotRecord, id: string) {
  const job = get(id);
  return job?.bot === bot.id && job.generation === bot.generation ? exportStatus(job) : null;
}
export function claimExport(now = Date.now()) {
  return q.tx(() => {
    q.run("UPDATE studio_exports SET state='queued',lease=NULL WHERE state='working' AND expires<=?", now);
    const running = q.get<{ n: number }>("SELECT count(*) n FROM studio_exports WHERE state='working'")!.n;
    if (running >= 4) return;
    const next = q.get<RenderJob>(`SELECT * FROM studio_exports j WHERE state='queued'
      AND NOT EXISTS(SELECT 1 FROM studio_exports r WHERE r.bot=j.bot AND r.state='working')
      ORDER BY updated,rowid LIMIT 1`);
    if (!next) return;
    const lease = randomUUID();
    q.run(
      "UPDATE studio_exports SET state='working',attempts=attempts+1,lease=?,expires=? WHERE id=?",
      lease,
      now + leaseMs,
      next.id,
    );
    return get(next.id)!;
  });
}
function settle(job: RenderJob, file: Attachment | null, error: string | null) {
  if (get(job.id)?.lease !== job.lease) return;
  const persist = () => {
    const result = q.run(
      "UPDATE studio_exports SET state=?,file=?,error=?,updated=?,lease=NULL,expires=0 WHERE id=? AND lease=?",
      file ? "ready" : "failed",
      file ? JSON.stringify(file) : null,
      error,
      Date.now(),
      job.id,
      job.lease,
    );
    if (!result.changes) throw Error("Render lease expired");
  };
  const bot = bots.byId(job.bot);
  if (bot && bot.generation === job.generation) {
    const title = (JSON.parse(job.story) as StudioStory).title;
    rows.append(
      bot,
      {
        kind: "message",
        role: "assistant",
        text: file ? title : title + " — " + error,
        ...(file ? { attachments: [file] } : {}),
      },
      job.thread,
      persist,
    );
    if (file) bots.bumpUnread(bot.id);
  } else persist();
}
export function drainExports(encode: Encoder) {
  while (active.size < 4) {
    const job = claimExport();
    if (!job) return;
    active.add(job.id);
    const timer = setInterval(
      () =>
        q.run(
          "UPDATE studio_exports SET expires=? WHERE id=? AND lease=?",
          Date.now() + leaseMs,
          job.id,
          job.lease,
        ),
      20_000,
    );
    timer.unref();
    void (async () => {
      const bot = bots.byId(job.bot);
      if (!bot || bot.generation !== job.generation || bot.hidden || bot.kind !== "agent")
        throw Error("Montage indisponible.");
      if (job.attempts > 3)
        throw Error(
          tr(job.locale, "The server interrupted multiple attempts. You can retry this export."),
        );
      return encode(
        bot,
        JSON.parse(job.story),
        !!job.narration,
        job.locale,
        job.language,
        () => get(job.id)?.lease === job.lease && bots.byId(job.bot)?.generation === job.generation,
      );
    })()
      .then(
        (file) => settle(job, file, null),
        (e) => settle(job, null, e instanceof Error ? e.message : "Render failed"),
      )
      .catch((e) => console.error("[studio export]", job.id, String(e)))
      .finally(() => {
        clearInterval(timer);
        active.delete(job.id);
        drainExports(encode);
      });
  }
}
