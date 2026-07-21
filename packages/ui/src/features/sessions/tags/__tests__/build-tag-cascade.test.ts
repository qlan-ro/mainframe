import { it, expect } from 'vitest';
import { buildTagCascade, type TagCascadeUpdate, type ThreadTagSnapshot } from '../build-tag-cascade';

it('renames a tag on threads that carry it, omits threads that do not', () => {
  const threads: ThreadTagSnapshot[] = [
    { id: 't1', custom: { tags: ['alpha', 'beta'] } },
    { id: 't2', custom: { tags: ['gamma'] } },
  ];
  const result: TagCascadeUpdate[] = buildTagCascade(threads, 'alpha', 'alpha2');
  expect(result).toEqual([{ id: 't1', newTags: ['alpha2', 'beta'] }]);
});

it('dedupes when the renamed tag collides with an existing tag on the thread', () => {
  const threads: ThreadTagSnapshot[] = [{ id: 't1', custom: { tags: ['alpha', 'alpha2'] } }];
  const result = buildTagCascade(threads, 'alpha', 'alpha2');
  expect(result).toEqual([{ id: 't1', newTags: ['alpha2'] }]);
});

it('deletes a tag when to is null, leaving remaining tags intact', () => {
  const threads: ThreadTagSnapshot[] = [{ id: 't1', custom: { tags: ['alpha', 'beta'] } }];
  const result = buildTagCascade(threads, 'alpha', null);
  expect(result).toEqual([{ id: 't1', newTags: ['beta'] }]);
});

it('returns an empty array when no thread carries the from tag', () => {
  const threads: ThreadTagSnapshot[] = [{ id: 't1', custom: { tags: ['gamma'] } }];
  const result = buildTagCascade(threads, 'alpha', 'alpha2');
  expect(result).toEqual([]);
});

it('returns an empty array for an empty thread list', () => {
  const result = buildTagCascade([], 'alpha', null);
  expect(result).toEqual([]);
});
