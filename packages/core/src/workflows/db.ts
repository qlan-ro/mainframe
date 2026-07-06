// packages/core/src/workflows/db.ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type WorkflowDb = Database.Database;

const MIGRATION = `
CREATE TABLE IF NOT EXISTS workflow_defs (
  id TEXT PRIMARY KEY,              -- '{projectId|global}:{name}'
  name TEXT NOT NULL,
  project_id TEXT,                  -- NULL for global workflows
  file_path TEXT NOT NULL,
  definition TEXT NOT NULL,         -- parsed WorkflowDef as JSON
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  definition TEXT NOT NULL,         -- snapshot pinned at trigger time
  status TEXT NOT NULL,             -- running|waiting|succeeded|failed|cancelled
  trigger_kind TEXT NOT NULL,       -- manual|cron|event|call
  trigger_payload TEXT,             -- JSON
  inputs TEXT,                      -- JSON, validated against def inputs
  outputs TEXT,                     -- JSON, set on success
  parent_run_id TEXT,
  parent_step_path TEXT,
  wake_at INTEGER,                  -- epoch ms; swept, never setTimeout'd
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_wf ON workflow_runs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_resumable ON workflow_runs(status) WHERE status IN ('running','waiting');
CREATE TABLE IF NOT EXISTS step_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_path TEXT NOT NULL,          -- 'steps.1.steps.0#3' (#N = foreach iteration)
  step_id TEXT,
  kind TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,             -- running|waiting|succeeded|failed|skipped|ambiguous
  input_ref TEXT,                   -- run_values.id
  output_ref TEXT,                  -- run_values.id
  scratch TEXT,                     -- JSON, e.g. {"chatId":"..."}; survives restarts
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE (run_id, step_path, attempt)
);
CREATE INDEX IF NOT EXISTS idx_step_runs_run ON step_runs(run_id);
CREATE TABLE IF NOT EXISTS run_values (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  json TEXT NOT NULL                -- full value, never truncated (resume source)
);
CREATE TABLE IF NOT EXISTS pending_interactions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_path TEXT NOT NULL,
  title TEXT NOT NULL,
  form_schema TEXT NOT NULL,        -- JSON Schema snapshot; responses validate against THIS
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|answered|expired
  response_ref TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS agent_waits (
  chat_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_path TEXT NOT NULL,
  last_assistant_text TEXT          -- accumulated from message.added while waiting
);
CREATE TABLE IF NOT EXISTS trigger_state (
  workflow_id TEXT NOT NULL,
  trigger_index INTEGER NOT NULL,
  next_fire_at INTEGER NOT NULL,
  PRIMARY KEY (workflow_id, trigger_index)
);
`;

export function openWorkflowDb(filePath: string): WorkflowDb {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(MIGRATION);
  return db;
}
