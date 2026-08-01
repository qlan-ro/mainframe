//! Additive DDL for todo #286's GitHub sync tables, layered onto the todos
//! plugin's `data.db`. `CREATE TABLE IF NOT EXISTS` makes every run idempotent
//! (AC31), matching the pattern `todos::run_migrations` already uses.

use crate::PluginError;
use crate::context::PluginContext;

const MIGRATION: &str = "
CREATE TABLE IF NOT EXISTS github_links (
  project_id TEXT PRIMARY KEY, owner TEXT NOT NULL, repo TEXT NOT NULL,
  remote_name TEXT NOT NULL DEFAULT '', credential_label TEXT NOT NULL,
  last_synced_at TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS github_pairs (
  todo_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL, issue_url TEXT NOT NULL,
  pair_state TEXT NOT NULL DEFAULT 'clean', state_reason TEXT,
  base_title TEXT NOT NULL, base_body TEXT NOT NULL, base_state TEXT NOT NULL,
  base_labels TEXT NOT NULL DEFAULT '[]', base_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS github_pairs_issue
  ON github_pairs(project_id, owner, repo, issue_number);

CREATE TABLE IF NOT EXISTS github_touch (
  todo_id TEXT NOT NULL, field TEXT NOT NULL, changed_at TEXT NOT NULL,
  PRIMARY KEY (todo_id, field));

CREATE TABLE IF NOT EXISTS github_runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL,
  pairs_reconciled INTEGER NOT NULL DEFAULT 0, reached INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0, failure_kind TEXT, failure_message TEXT);

CREATE TABLE IF NOT EXISTS github_report_rows (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, todo_id TEXT NOT NULL, todo_number INTEGER NOT NULL,
  todo_title TEXT NOT NULL, issue_number INTEGER NOT NULL, field TEXT NOT NULL,
  winner TEXT NOT NULL, rule TEXT NOT NULL, local_at TEXT, remote_at TEXT,
  remote_coarse INTEGER NOT NULL DEFAULT 0, winning_value TEXT NOT NULL, replaced_value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS github_report_rows_run ON github_report_rows(run_id);
";

/// Called from `todos::run_migrations` alongside the base todos migration —
/// every activation keeps both surfaces on the same schema version.
pub async fn run_github_migrations(ctx: &PluginContext) -> Result<(), PluginError> {
    ctx.db.run_migration(MIGRATION.into()).await
}
