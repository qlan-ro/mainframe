// packages/core/src/automations/db.ts
//
// Automations v2 storage — deliberately a SEPARATE file from mainframe.db
// (contract §3) so it stays out of the core migration lock-step. Only
// `automations`, `automation_runs`, and `automation_interactions` are
// contract tables shared with the Rust engine; `trigger_state` and
// `agent_waits` are engine-internal rebuildable caches (contract §3) — both
// engines ignore unknown tables in the file, so neither reads the other's.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type AutomationDb = Database.Database;

const MIGRATION = `
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL,              -- 'global'|'project'
  project_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  definition TEXT NOT NULL,         -- AutomationDefinition JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  status TEXT NOT NULL,             -- running|waiting|succeeded|failed|cancelled
  -- NULL for manual runs: SQLite treats every NULL as distinct in a UNIQUE
  -- index, so repeated manual runs never collide (contract §3, Decision 13).
  trigger_dedup_key TEXT,
  checkpoint TEXT NOT NULL,         -- {definition, trigger, steps, wakeAt, error} JSON (contract §2)
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_dedup ON automation_runs(automation_id, trigger_dedup_key);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_resumable ON automation_runs(status) WHERE status IN ('running','waiting');
CREATE TABLE IF NOT EXISTS automation_interactions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  step_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  fields TEXT NOT NULL,             -- AutomationFormField[] JSON snapshot
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|answered|cancelled
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_automation_interactions_run ON automation_interactions(run_id, step_ref);
CREATE INDEX IF NOT EXISTS idx_automation_interactions_pending ON automation_interactions(status) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS trigger_state (
  automation_id TEXT NOT NULL,
  trigger_id TEXT NOT NULL,
  next_fire_at INTEGER,
  last_payload TEXT,
  PRIMARY KEY (automation_id, trigger_id)
);
CREATE TABLE IF NOT EXISTS agent_waits (
  chat_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  step_ref TEXT NOT NULL,
  last_assistant_text TEXT,
  -- A2 (Task 19b): one corrective retry into the same chat when expects validation
  -- fails; a second failure fails the step loudly instead of looping forever.
  correction_sent INTEGER NOT NULL DEFAULT 0
);
`;

export function openAutomationDb(filePath: string): AutomationDb {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(MIGRATION);
  return db;
}
