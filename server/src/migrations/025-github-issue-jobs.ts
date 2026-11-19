import type { DatabaseSync } from "node:sqlite";

export function githubIssueJobs(db: DatabaseSync) {
  db.exec(`CREATE TABLE github_issue_jobs(
    id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, reviewer TEXT NOT NULL, generation INTEGER NOT NULL,
    repo TEXT NOT NULL COLLATE NOCASE, issue INTEGER NOT NULL, connector TEXT NOT NULL,
    thread INTEGER NOT NULL, branch TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'prepare',
    context TEXT NOT NULL DEFAULT '{}', patch TEXT NOT NULL DEFAULT '[]', review TEXT NOT NULL DEFAULT '',
    revision TEXT NOT NULL DEFAULT '', commit_sha TEXT NOT NULL DEFAULT '', pr INTEGER, ci_since INTEGER,
    note TEXT NOT NULL DEFAULT '', lease TEXT NOT NULL DEFAULT '', expires INTEGER NOT NULL DEFAULT 0,
    next INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, resume TEXT NOT NULL DEFAULT '',
    updated INTEGER NOT NULL, UNIQUE(bot,generation,repo,issue)
  ); CREATE INDEX github_issue_queue ON github_issue_jobs(phase,next,expires);`);
}
