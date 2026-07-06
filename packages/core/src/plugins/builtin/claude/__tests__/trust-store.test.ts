import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorkspaceTrust } from '../trust-store.js';

// Partial mock that delegates to the real implementation by default; individual
// tests override `writeFile`/`rename` to observe tmp-path uniqueness and cleanup.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename),
  };
});

describe('writeWorkspaceTrust', () => {
  it('creates the file and marks the project trusted when it is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const p = join(dir, '.claude.json');
    await writeWorkspaceTrust('/home/me/proj', p);
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.projects['/home/me/proj'].hasTrustDialogAccepted).toBe(true);
  });

  it('merges without clobbering existing keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const p = join(dir, '.claude.json');
    writeFileSync(p, JSON.stringify({ authSecret: 'keep', projects: { '/other': { x: 1 } } }));
    await writeWorkspaceTrust('/home/me/proj', p);
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.authSecret).toBe('keep');
    expect(cfg.projects['/other']).toEqual({ x: 1 });
    expect(cfg.projects['/home/me/proj'].hasTrustDialogAccepted).toBe(true);
  });

  it('is idempotent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const p = join(dir, '.claude.json');
    await writeWorkspaceTrust('/home/me/proj', p);
    await writeWorkspaceTrust('/home/me/proj', p);
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    expect(cfg.projects['/home/me/proj'].hasTrustDialogAccepted).toBe(true);
  });

  it('rejects and leaves the file unchanged when the existing file is corrupt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const p = join(dir, '.claude.json');
    writeFileSync(p, '{ not json');
    await expect(writeWorkspaceTrust('/home/me/proj', p)).rejects.toThrow();
    expect(readFileSync(p, 'utf8')).toBe('{ not json');
  });

  it('uses a unique tmp path for every call, so concurrent writes cannot collide', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const p = join(dir, '.claude.json');
    const writeFileMock = vi.mocked(fsPromises.writeFile);
    writeFileMock.mockClear();

    await Promise.all([writeWorkspaceTrust('/proj-a', p), writeWorkspaceTrust('/proj-b', p)]);

    const tmpPaths = writeFileMock.mock.calls.map(([path]) => String(path));
    expect(tmpPaths).toHaveLength(2);
    expect(new Set(tmpPaths).size).toBe(2);
  });

  it('removes the orphaned tmp file when the write fails partway through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trust-'));
    const p = join(dir, '.claude.json');
    const renameMock = vi.mocked(fsPromises.rename);
    renameMock.mockRejectedValueOnce(new Error('boom'));

    await expect(writeWorkspaceTrust('/home/me/proj', p)).rejects.toThrow('boom');

    const leftoverTmp = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftoverTmp).toEqual([]);
  });
});
