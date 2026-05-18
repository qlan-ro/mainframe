import { describe, it, expect } from 'vitest';
import { computeSessionFilePath } from '../event-handler.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('computeSessionFilePath', () => {
  it('encodes cwd the Claude way and points at the jsonl', () => {
    const p = computeSessionFilePath('/Users/x/proj', 'sess-abc');
    expect(p).toBe(join(homedir(), '.claude', 'projects', '-Users-x-proj', 'sess-abc.jsonl'));
  });

  it('encodes non-alphanumerics (dots, slashes) to dashes', () => {
    const p = computeSessionFilePath('/a/b.c/worktrees/x', 'sid');
    expect(p).toBe(join(homedir(), '.claude', 'projects', '-a-b-c-worktrees-x', 'sid.jsonl'));
  });

  it('sanitizes a malicious session id so it cannot traverse', () => {
    const p = computeSessionFilePath('/proj', '../../etc/passwd');
    expect(p).not.toContain('..');
    expect(p.endsWith('.jsonl')).toBe(true);
  });
});
