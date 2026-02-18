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
});
