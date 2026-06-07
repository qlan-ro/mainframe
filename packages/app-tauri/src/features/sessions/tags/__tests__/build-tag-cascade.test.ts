import { describe, it, expect } from 'vitest';
import { buildTagCascade, type TagCascadeUpdate, type ThreadTagSnapshot } from '../build-tag-cascade';

// ---------------------------------------------------------------------------
// buildTagCascade — rename
// ---------------------------------------------------------------------------

describe('buildTagCascade — renames a tag on threads that carry it, omits threads that do not', () => {
  it('returns one update for t1 (carries alpha), omits t2 (carries only gamma)', () => {
    const threads: ThreadTagSnapshot[] = [
      { id: 't1', custom: { tags: ['alpha', 'beta'] } },
      { id: 't2', custom: { tags: ['gamma'] } },
    ];
    const result: TagCascadeUpdate[] = buildTagCascade(threads, 'alpha', 'alpha2');
    expect(result).toEqual([{ id: 't1', newTags: ['alpha2', 'beta'] }]);
  });
});

// ---------------------------------------------------------------------------
// buildTagCascade — rename dedupes when target tag already present
// ---------------------------------------------------------------------------

describe('buildTagCascade — dedupes when renamed tag collides with an existing tag on the thread', () => {
  it('returns [{ id: "t1", newTags: ["alpha2"] }] when alpha is renamed to alpha2 but alpha2 already exists', () => {
    const threads: ThreadTagSnapshot[] = [{ id: 't1', custom: { tags: ['alpha', 'alpha2'] } }];
    const result = buildTagCascade(threads, 'alpha', 'alpha2');
    expect(result).toEqual([{ id: 't1', newTags: ['alpha2'] }]);
  });
});

// ---------------------------------------------------------------------------
// buildTagCascade — delete (to === null drops the tag)
// ---------------------------------------------------------------------------

describe('buildTagCascade — deletes a tag when to is null, leaving remaining tags intact', () => {
  it('returns [{ id: "t1", newTags: ["beta"] }] when alpha is deleted', () => {
    const threads: ThreadTagSnapshot[] = [{ id: 't1', custom: { tags: ['alpha', 'beta'] } }];
    const result = buildTagCascade(threads, 'alpha', null);
    expect(result).toEqual([{ id: 't1', newTags: ['beta'] }]);
  });
});

// ---------------------------------------------------------------------------
// buildTagCascade — no-op when no thread carries the tag
// ---------------------------------------------------------------------------

describe('buildTagCascade — returns empty array when no thread carries the from tag', () => {
  it('returns [] when the only thread carries gamma, not alpha', () => {
    const threads: ThreadTagSnapshot[] = [{ id: 't1', custom: { tags: ['gamma'] } }];
    const result = buildTagCascade(threads, 'alpha', 'alpha2');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildTagCascade — empty input
// ---------------------------------------------------------------------------

describe('buildTagCascade — returns empty array for empty thread list', () => {
  it('returns [] when threads is []', () => {
    const result = buildTagCascade([], 'alpha', null);
    expect(result).toEqual([]);
  });
});
