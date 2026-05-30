import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { resolveAndValidatePath } from '../../server/routes/path-utils.js';

describe('resolveAndValidatePath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-utils-test-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '// hello');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns full path for valid sub-path', () => {
    const result = resolveAndValidatePath(tmpDir, 'src/index.ts');
    expect(result).toBe(path.join(fs.realpathSync(tmpDir), 'src', 'index.ts'));
  });

  it('returns full path for directory sub-path', () => {
    const result = resolveAndValidatePath(tmpDir, 'src');
    expect(result).toBe(path.join(fs.realpathSync(tmpDir), 'src'));
  });

  it('returns null for path traversal attempts', () => {
    const result = resolveAndValidatePath(tmpDir, '../../etc/passwd');
    expect(result).toBeNull();
  });

  it('returns null for absolute paths outside base', () => {
    const result = resolveAndValidatePath(tmpDir, '/etc/passwd');
    expect(result).toBeNull();
  });

  it('returns null for non-existent paths', () => {
    const result = resolveAndValidatePath(tmpDir, 'does-not-exist.txt');
    expect(result).toBeNull();
  });

  it('returns null when base path itself does not exist', () => {
    const result = resolveAndValidatePath('/nonexistent-base-path-12345', 'file.txt');
    expect(result).toBeNull();
  });

  it('returns full path for current directory reference', () => {
    const result = resolveAndValidatePath(tmpDir, '.');
    expect(result).toBe(fs.realpathSync(tmpDir));
  });

  it('treats a filesystem root base as containing everything (no double-separator)', () => {
    // isWithinBase('/', '/tmp') must be true — '/' already ends in the separator.
    const root = path.parse(tmpDir).root;
    const target = fs.realpathSync(tmpDir);
    const result = resolveAndValidatePath(root, path.relative(root, target));
    expect(result).toBe(target);
  });

  it('returns null for a sibling directory sharing the base name prefix', () => {
    // Boundary bug: base "<tmp>/proj" must NOT admit "<tmp>/proj-evil"
    // (a naive startsWith(realBase) check would accept it).
    const base = path.join(tmpDir, 'proj');
    const sibling = path.join(tmpDir, 'proj-evil');
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, 'secret.txt'), 'top secret');

    const result = resolveAndValidatePath(base, '../proj-evil/secret.txt');
    expect(result).toBeNull();
  });
});
