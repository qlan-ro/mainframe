import { describe, it, expect } from 'vitest';
import { encodePath, isUuidJsonl, cwdBelongsToProject } from '../external-session-paths.js';

describe('encodePath', () => {
  it('replaces every non-alphanumeric char with a dash (CLI parity)', () => {
    expect(encodePath('/Users/x/my_proj.v2')).toBe('-Users-x-my-proj-v2');
  });
});

describe('isUuidJsonl', () => {
  it('accepts a UUID-named jsonl', () => {
    expect(isUuidJsonl('3f2504e0-4f89-41d3-9a0c-0305e82c3301.jsonl')).toBe(true);
  });
  it('rejects non-UUID jsonl (progress, queue-operation)', () => {
    expect(isUuidJsonl('progress.jsonl')).toBe(false);
    expect(isUuidJsonl('queue-operation.jsonl')).toBe(false);
  });
  it('rejects non-jsonl', () => {
    expect(isUuidJsonl('3f2504e0-4f89-41d3-9a0c-0305e82c3301.json')).toBe(false);
  });
});

describe('cwdBelongsToProject', () => {
  it('true for exact match and nested, false for sibling prefix', () => {
    expect(cwdBelongsToProject('/a/proj', '/a/proj')).toBe(true);
    expect(cwdBelongsToProject('/a/proj/sub', '/a/proj')).toBe(true);
    expect(cwdBelongsToProject('/a/proj-web', '/a/proj')).toBe(false);
    expect(cwdBelongsToProject(undefined, '/a/proj')).toBe(false);
  });
});
