import type { PluginContext } from '@qlan-ro/mainframe-types';

export const MIGRATION = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL DEFAULT 0,
  project_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium',
  labels TEXT NOT NULL DEFAULT '[]',
  assignees TEXT NOT NULL DEFAULT '[]',
  milestone TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  order_index REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  state_reason TEXT,
  author TEXT DEFAULT '',
  remote_repo TEXT,
  remote_number INTEGER,
  remote_url TEXT,
  synced_at TEXT
);`;

/** column -> ADD COLUMN clause, applied to legacy DBs that predate each field. */
const ADDITIVE_COLUMNS: Record<string, string> = {
  number: 'ALTER TABLE todos ADD COLUMN number INTEGER NOT NULL DEFAULT 0',
  project_id: "ALTER TABLE todos ADD COLUMN project_id TEXT NOT NULL DEFAULT ''",
  dependencies: "ALTER TABLE todos ADD COLUMN dependencies TEXT NOT NULL DEFAULT '[]'",
  closed_at: 'ALTER TABLE todos ADD COLUMN closed_at TEXT',
  state_reason: 'ALTER TABLE todos ADD COLUMN state_reason TEXT',
  author: "ALTER TABLE todos ADD COLUMN author TEXT DEFAULT ''",
  remote_repo: 'ALTER TABLE todos ADD COLUMN remote_repo TEXT',
  remote_number: 'ALTER TABLE todos ADD COLUMN remote_number INTEGER',
  remote_url: 'ALTER TABLE todos ADD COLUMN remote_url TEXT',
  synced_at: 'ALTER TABLE todos ADD COLUMN synced_at TEXT',
};

export function runMigrations(ctx: PluginContext): void {
  ctx.db.runMigration(MIGRATION);
  const cols = ctx.db.prepare<{ name: string }>('PRAGMA table_info(todos)').all();
  const colNames = new Set(cols.map((c) => c.name));

  for (const [column, ddl] of Object.entries(ADDITIVE_COLUMNS)) {
    if (!colNames.has(column)) {
      ctx.db.runMigration(ddl);
    }
  }

  if (!colNames.has('number')) {
    const rows = ctx.db.prepare<{ id: string }>('SELECT id FROM todos ORDER BY created_at').all();
    rows.forEach((row, i) => {
      ctx.db.prepare('UPDATE todos SET number = ? WHERE id = ?').run(i + 1, row.id);
    });
  }
}
