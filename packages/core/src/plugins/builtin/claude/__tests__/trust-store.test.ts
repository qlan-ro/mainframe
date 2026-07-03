import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorkspaceTrust } from '../trust-store.js';

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
});
