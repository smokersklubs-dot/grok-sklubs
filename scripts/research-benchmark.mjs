import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const phase = process.argv[2];
if (!phase) {
  const data = mkdtempSync(join(tmpdir(), "sklubot-research-benchmark-"));
  const env = {...process.env, DATA_DIR:data, DB_PATH:join(data,"benchmark.db"), NO_SCHEDULER:"1", HOSTED_MODE:"0", ALLOW_PRIVATE_FETCH:"0", X_BEARER_TOKEN:"", XAI_API_KEY:"", SESSION_SECRET:"research-benchmark-local-only-secret"};
  const start = Date.now();
  for (const step of ["start","reopen"]) {
    const child = spawnSync(process.execPath,["--import","tsx",fileURLToPath(import.meta.url),step],{env,stdio:"inherit"});
    assert.equal(child.status,0);
  }
  console.log(JSON.stringify({elapsedSeconds:(Date.now()-start)/1000,temporaryDatabase:data}));
} else {
  const {users,bots} = await import("../server/src/store.ts");
  const {q}=await import("../server/src/db.ts");
  const {createReport,listReports,nextResearchSection}=await import("../server/src/researchreports.ts");
  const {readPublicPage}=await import("../server/src/webreading.ts");
  const subject="SQLite transactions and integrity";
  const plan=["Can SQLite support multiple simultaneous read transactions and write transactions?","Are foreign key constraints disabled by default in SQLite?","What is the lunar surface temperature?"];
  const seeds=["https://www.sqlite.org/lang_transaction.html","https://www.sqlite.org/foreignkeys.html"];
  if (phase==="start") {
    const bot=bots.create(users.create("report@example.invalid","Research benchmark","unused","en").id,{name:"Test"});
    createReport(bot,{subject,plan,seeds,discover:false,model:false,includeX:false,locale:"en"},"benchmark-sqlite");
    await nextResearchSection();
    const saved=listReports(bot)[0];
    assert.equal(saved.sections.length,1);
    console.log(JSON.stringify({phase:"before process exit",questionsSaved:saved.sections.length,report:saved.id}));
  } else {
    const bot=bots.byId(q.get("SELECT bot FROM research_reports").bot);
    assert.equal(listReports(bot)[0].sections.length,1);
    while(await nextResearchSection()) { /* resume only pending questions */ }
    const report=listReports(bot)[0];
    assert.equal(report.state,"done");
    const refetched=new Map(await Promise.all(seeds.map(async url=>[url,(await readPublicPage(url,AbortSignal.timeout(20_000))).text.replace(/\s+/g," ")])));
    const findings=report.sections.flatMap(s=>s.findings);
    const attested=findings.filter(f=>refetched.get(f.url)?.includes(f.quote));
    const score=report.sections.map(s=>({question:s.question,quotes:s.findings.map(f=>({url:f.url,quote:f.quote})),notes:s.notes}));
    console.log(JSON.stringify({phase:"after fresh process",subject,plan,seedSources:seeds,covered:score.filter(s=>s.quotes.length).length,unanswered:score.filter(s=>!s.quotes.length).length,attested:attested.length,quotes:findings.length,score},null,2));
    assert.equal(attested.length,findings.length);
    assert.ok(report.sections[0].findings.some(f=>f.url===seeds[0]));
    assert.ok(report.sections[1].findings.some(f=>f.url===seeds[1]));
    assert.equal(report.sections[2].findings.length,0);
  }
}

