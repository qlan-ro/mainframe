import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { openWorkflowDb, type WorkflowDb } from '../../workflows/db.js';
import { WorkflowLoader } from '../../workflows/loader.js';

const VALID = `
version: 1
name: good
steps:
  - id: a
    set: { v: 1 }
`;

const BROKEN = `
version: 1
name: bad
steps:
  - id: a
    set: { v: "\${ ghost.output }" }
`;

describe('WorkflowLoader', () => {
  let dir: string;
  let db: WorkflowDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfl-'));
    db = openWorkflowDb(join(dir, 'w.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads valid files, skips broken ones with a recorded error', async () => {
    const wfDir = join(dir, 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'good.yml'), VALID);
    writeFileSync(join(wfDir, 'bad.yml'), BROKEN);
    const loader = new WorkflowLoader(db, pino({ level: 'silent' }));
    const result = await loader.scanDir(wfDir, null);
    expect(result.loaded.map((w) => w.name)).toEqual(['good']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toContain('bad.yml');
    const defs = loader.list();
    expect(defs).toHaveLength(1);
    expect(defs[0]?.id).toBe('global:good');
  });

  it('findByName resolves project-scoped before global', async () => {
    const globalDir = join(dir, 'g');
    const projDir = join(dir, 'p');
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(globalDir, 'w.yml'), VALID);
    writeFileSync(join(projDir, 'w.yml'), VALID);
    const loader = new WorkflowLoader(db, pino({ level: 'silent' }));
    await loader.scanDir(globalDir, null);
    await loader.scanDir(projDir, 'proj1');
    expect(loader.findByName('good', 'proj1')?.id).toBe('proj1:good');
    expect(loader.findByName('good', null)?.id).toBe('global:good');
  });
});
