// packages/core/src/__tests__/automations/db.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAutomationDb } from '../../automations/db.js';

describe('openAutomationDb', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the contract tables plus internal caches, in WAL mode with FK + busy_timeout', () => {
    dir = mkdtempSync(join(tmpdir(), 'automations-db-'));
    const db = openAutomationDb(join(dir, 'automations.db'));
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'automations',
        'automation_runs',
        'automation_interactions',
        'trigger_state',
        'agent_waits',
      ]),
    );
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    db.close();
  });

  it('enforces trigger dedup via a unique index on (automation_id, trigger_dedup_key), NULL exempt for manual runs', () => {
    dir = mkdtempSync(join(tmpdir(), 'automations-db-'));
    const db = openAutomationDb(join(dir, 'automations.db'));
    db.prepare(
      `INSERT INTO automations (id, name, scope, enabled, definition, created_at, updated_at)
       VALUES ('a1', 'A', 'global', 1, '{}', 0, 0)`,
    ).run();
    const insertRun = db.prepare(
      `INSERT INTO automation_runs (id, automation_id, status, trigger_dedup_key, checkpoint, started_at)
       VALUES (?, 'a1', 'running', ?, '{}', 0)`,
    );

    insertRun.run('r1', 'trigger-1|2026-07-12T09:00:00');
    let caught: unknown;
    try {
      insertRun.run('r2', 'trigger-1|2026-07-12T09:00:00');
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string } | undefined)?.code).toMatch(/^SQLITE_CONSTRAINT/);

    // Manual runs carry a NULL dedup key; SQLite treats every NULL as distinct,
    // so repeated manual runs never collide on the unique index.
    expect(() => insertRun.run('r3', null)).not.toThrow();
    expect(() => insertRun.run('r4', null)).not.toThrow();

    db.close();
  });
});
