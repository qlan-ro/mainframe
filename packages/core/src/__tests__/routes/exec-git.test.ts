import { describe, it, expect } from 'vitest';
import { execGit } from '../../server/routes/exec-git.js';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

describe('execGit', () => {
  it('returns stdout of a successful git command', async () => {
    const result = await execGit(['rev-parse', '--is-inside-work-tree'], repoRoot);
    expect(result.trim()).toBe('true');
  });

  it('throws on invalid git command', async () => {
    await expect(execGit(['not-a-real-command'], '/tmp')).rejects.toThrow();
  });
});
