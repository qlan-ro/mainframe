import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../schema.js';
import { runMigrations, MIGRATIONS, LATEST_VERSION } from '../migrations.js';

function userVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

// Every table's CREATE statement, in a stable order — the on-disk schema identity.
function schemaSql(db: Database.Database): string {
  const rows = db
    .prepare('SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name')
    .all() as { type: string; name: string; sql: string }[];
  return rows.map((r) => r.sql).join('\n');
}

const ALL_CHATS_COLUMNS = [
  'id',
  'adapter_id',
  'project_id',
  'title',
  'claude_session_id',
  'model',
  'status',
  'created_at',
  'updated_at',
  'total_cost',
  'total_tokens_input',
  'total_tokens_output',
  'mentions',
  'modified_files',
  'plan_files',
  'skill_files',
  'permission_mode',
  'worktree_path',
  'branch_name',
  'process_state',
  'last_context_tokens_input',
  'todos',
  'pinned',
  'effort',
  'fast',
  'ultracode',
  'adaptive_thinking',
  'detected_prs',
  'plan_mode',
  'session_file_path',
];

describe('migrations', () => {
  it('LATEST_VERSION is the highest migration version, contiguous from 1', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(Array.from({ length: versions.length }, (_, i) => i + 1));
    expect(LATEST_VERSION).toBe(versions[versions.length - 1]);
  });

  it('fresh DB fast-paths to the final schema and stamps user_version = LATEST_VERSION', () => {
    const db = new Database(':memory:');
    initializeSchema(db);

    expect(userVersion(db)).toBe(LATEST_VERSION);
    const cols = columnNames(db, 'chats');
    for (const name of ALL_CHATS_COLUMNS) expect(cols).toContain(name);
    expect(columnNames(db, 'projects')).toContain('parent_project_id');
    expect(columnNames(db, 'devices')).toContain('auth_epoch');
    db.close();
  });

  it('is idempotent — re-running applies nothing and keeps user_version stable', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    const sqlBefore = schemaSql(db);
    initializeSchema(db);
    expect(userVersion(db)).toBe(LATEST_VERSION);
    expect(schemaSql(db)).toBe(sqlBefore);
    db.close();
  });

  it('detects a legacy DB (all columns present, user_version=0) and stamps it without re-breaking', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    const sqlBefore = schemaSql(db);

    // Simulate a DB written by the old ad-hoc code: fully migrated but never stamped.
    db.pragma('user_version = 0');
    expect(userVersion(db)).toBe(0);

    initializeSchema(db);
    expect(userVersion(db)).toBe(LATEST_VERSION);
    expect(schemaSql(db)).toBe(sqlBefore);
    db.close();
  });

  // Builds an intermediate historical DB by replaying the real migration chain up to
  // a point *before* the backfills, then resets user_version to 0 (as the old code left
  // it) and seeds rows that exercise every data backfill.
  function buildLegacyIntermediate(): Database.Database {
    const db = new Database(':memory:');
    // Stop before migration 19 (plan_mode) so permission_mode='plan' survives to be backfilled.
    runMigrations(db, 18);

    const now = '2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)').run(
      'p1',
      'proj',
      '/tmp/p1',
      now,
      now,
    );
    // claude-sdk row (exercises the claude rename) with permission_mode='plan' (exercises plan_mode).
    db.prepare(
      'INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at, permission_mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('c1', 'claude-sdk', 'p1', 'active', now, now, 'plan');
    db.prepare(
      'INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at, permission_mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('c2', 'codex', 'p1', 'active', now, now, 'default');
    // provider defaultMode='plan' (exercises the settings backfill).
    db.prepare('INSERT INTO settings (id, category, key, value, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      's1',
      'provider',
      'claude.defaultMode',
      'plan',
      now,
    );

    // The old code never wrote user_version, so a real legacy DB reports 0.
    db.pragma('user_version = 0');
    return db;
  }

  it('applies every data backfill when upgrading a legacy intermediate DB', () => {
    const db = buildLegacyIntermediate();
    initializeSchema(db);

    expect(userVersion(db)).toBe(LATEST_VERSION);

    // claude-sdk → claude rename
    const adapters = db.prepare('SELECT id, adapter_id FROM chats ORDER BY id').all() as {
      id: string;
      adapter_id: string;
    }[];
    expect(adapters).toEqual([
      { id: 'c1', adapter_id: 'claude' },
      { id: 'c2', adapter_id: 'codex' },
    ]);

    // plan permission-mode → plan_mode
    const planRows = db.prepare('SELECT id, permission_mode, plan_mode FROM chats ORDER BY id').all() as {
      id: string;
      permission_mode: string | null;
      plan_mode: number;
    }[];
    expect(planRows[0]).toEqual({ id: 'c1', permission_mode: 'default', plan_mode: 1 });
    expect(planRows[1]).toEqual({ id: 'c2', permission_mode: 'default', plan_mode: 0 });

    // provider defaultMode → defaultPlanMode
    const mode = db
      .prepare("SELECT value FROM settings WHERE category='provider' AND key='claude.defaultMode'")
      .get() as { value: string };
    expect(mode.value).toBe('default');
    const planMode = db
      .prepare("SELECT value FROM settings WHERE category='provider' AND key='claude.defaultPlanMode'")
      .get() as { value: string } | undefined;
    expect(planMode?.value).toBe('true');
    db.close();
  });

  it('produces a byte-identical final schema for fresh-path and migrated-path DBs', () => {
    const fresh = new Database(':memory:');
    initializeSchema(fresh);

    const migrated = buildLegacyIntermediate();
    initializeSchema(migrated);

    expect(schemaSql(migrated)).toBe(schemaSql(fresh));
    expect(userVersion(migrated)).toBe(userVersion(fresh));
    fresh.close();
    migrated.close();
  });
});
