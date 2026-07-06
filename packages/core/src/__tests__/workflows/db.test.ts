// packages/core/src/__tests__/workflows/db.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkflowDb } from '../../workflows/db.js';

describe('openWorkflowDb', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the db file with all tables and WAL mode', () => {
    dir = mkdtempSync(join(tmpdir(), 'wfdb-'));
    const db = openWorkflowDb(join(dir, 'workflows.db'));
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'workflow_defs',
        'workflow_runs',
        'step_runs',
        'run_values',
        'pending_interactions',
        'agent_waits',
        'trigger_state',
      ]),
    );
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
  });
});
