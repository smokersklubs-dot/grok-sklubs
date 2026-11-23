import { randomUUID } from "node:crypto";
import { q } from "./db.js";
import { bots, rows, type BotRecord } from "./store.js";
import { xSearchProvider } from "./xsearch.js";
import { browseSection, reportMessage } from "./researchsection.js";
import { changesBlock, previousReport, runDueWatches } from "./researchwatch.js";
import { briefFrom, type ResearchBrief, type ResearchSection } from "./researchevidence.js";

interface Job {
  id: string;
  bot: string;
  generation: number;
  thread: number;
  brief: string;
  sections: string;
  state: string;
  updated: number;
}
function unpack(row: Job) {
  return {
    id: row.id,
    brief: JSON.parse(row.brief) as ResearchBrief,
    sections: JSON.parse(row.sections) as ResearchSection[],
    state: row.state,
    updated: row.updated,
  };
}
export function listReports(bot: BotRecord) {
  return q
    .all<Job>(
      "SELECT * FROM research_reports WHERE bot=? AND generation=? ORDER BY updated DESC LIMIT 25",
      bot.id,
      bot.generation,
    )
    .map(unpack);
}
export function createReport(bot: BotRecord, raw: Partial<ResearchBrief>, request: string, thread = 0) {
  if (bot.kind !== "agent" || bot.hidden || bot.disabledTools.includes("web"))
    throw Error("La recherche web est désactivée.");
  if (!/^[a-z\d-]{8,100}$/i.test(request)) throw Error("Identifiant de demande invalide.");
  if (
    !Number.isSafeInteger(thread) ||
    thread < 0 ||
    (thread && rows.get(bot.id, bot.generation, thread)?.body.kind !== "message")
  )
    throw Error("Discussion introuvable.");
  const brief = briefFrom(raw);
  const old = q.get<Job>(
    "SELECT * FROM research_reports WHERE bot=? AND generation=? AND request_id=?",
    bot.id,
    bot.generation,
    request,
  );
  if (old) return unpack(old);
  if (brief.includeX && !xSearchProvider(bot.userId)) throw Error("Connecte d’abord une source X.");
  const active = q.get<{ n: number }>(
    "SELECT count(*) n FROM research_reports r JOIN bots b ON b.id=r.bot WHERE b.user_id=? AND r.state='queued' AND b.generation=r.generation",
    bot.userId,
  );
  if ((active?.n ?? 0) >= 3) throw Error("Trois recherches sont déjà en cours sur ce compte.");
  const id = randomUUID(),
    updated = Date.now();
  q.run(
    "INSERT INTO research_reports(id,bot,generation,thread,request_id,brief,updated) VALUES(?,?,?,?,?,?,?)",
    id,
    bot.id,
    bot.generation,
    thread,
    request,
    JSON.stringify(brief),
    updated,
  );
  return unpack(q.get<Job>("SELECT * FROM research_reports WHERE id=?", id)!);
}
/** One question (researchsection.ts, L87) and the final message: kept exported here for existing callers. */
export { browseSection } from "./researchsection.js";
const message = reportMessage;
/** Processes a single checkpoint, reclaiming expired leases after a process restart. */
export async function nextResearchSection(work = browseSection) {
  const now = Date.now(),
    token = randomUUID();
  const selected = q.tx(() => {
    const row = q.get<Job>(
      "SELECT * FROM research_reports WHERE state='queued' AND expires<=? ORDER BY updated, id LIMIT 1",
      now,
    );
    if (row)
      q.run("UPDATE research_reports SET lease=?,expires=? WHERE id=?", token, now + 300_000, row.id);
    return row;
  });
  if (!selected) return false;
  const bot = bots.byId(selected.bot),
    job = unpack(selected);
  const save = (sections: ResearchSection[], state: string) =>
    q.run(
      "UPDATE research_reports SET sections=?,state=?,lease=NULL,expires=0,updated=? WHERE id=? AND lease=? AND state='queued'",
      JSON.stringify(sections),
      state,
      Date.now(),
      job.id,
      token,
    ).changes;
  if (
    !bot ||
    bot.generation !== selected.generation ||
    bot.hidden ||
    bot.disabledTools.includes("web")
  ) {
    save(job.sections, "stopped");
    return true;
  }
  const heartbeat = setInterval(
    () =>
      q.run(
        "UPDATE research_reports SET expires=? WHERE id=? AND lease=? AND state='queued'",
        Date.now() + 300_000,
        job.id,
        token,
      ),
    30_000,
  ).unref();
  try {
    const question = job.brief.plan[job.sections.length];
    const result = await work(bot, job.brief, question);
    if (
      !q.get("SELECT id FROM research_reports WHERE id=? AND state='queued' AND lease=?", job.id, token)
    )
      return true;
    if (
      bots.byId(bot.id)?.generation !== selected.generation ||
      bots.byId(bot.id)?.disabledTools.includes("web")
    ) {
      save(job.sections, "stopped");
      return true;
    }
    const complete = [...job.sections, result];
    if (complete.length < job.brief.plan.length) save(complete, "queued");
    else
      rows.append(
        bot,
        { kind: "message", role: "assistant", text: message(job.brief, complete) + changesBlock(job.brief, complete, previousReport(bot.id, job.brief.subject, job.id)) }, // L87 « ce qui a changé » (researchwatch.ts)
        selected.thread,
        () => {
          if (!save(complete, "done")) throw Error("Lease expired.");
        },
      );
  } catch {
    save(job.sections, "interrupted");
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
export function resumeReport(bot: BotRecord, id: string) {
  return (
    q.run(
      "UPDATE research_reports SET state='queued',expires=0,lease=NULL,updated=? WHERE bot=? AND generation=? AND id=? AND state='interrupted'",
      Date.now(),
      bot.id,
      bot.generation,
      id,
    ).changes > 0
  );
}
export function startResearchWorker() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      runDueWatches(createReport); // L87 « Veille » (researchwatch.ts)
      while (await nextResearchSection()) {
        /* drain in checkpoint order */
      }
    } catch (err) {
      console.error("Research worker", err instanceof Error ? err.name : "error");
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(() => void tick(), 3000).unref();
}
