/**
 * row-pr-chips — pure cap/prioritise logic (TDD red phase).
 *
 * A session's `detected_prs` list is unbounded, but the row can only afford
 * MAX_ROW_PR_CHIPS inline. `arrangeRowPrs` decides which single PR renders
 * inline (the most recent session-created one, falling back to the most
 * recent merely-mentioned one), which PRs spill to the count indicator, and
 * the priority order the indicator's popover lists.
 */
import { describe, it, expect } from 'vitest';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { MAX_ROW_PR_CHIPS, arrangeRowPrs } from '../row-pr-chips';

function pr(number: number, source: DetectedPr['source'], owner = 'org', repo = 'r'): DetectedPr {
  return { number, source, owner, repo, url: `https://github.com/${owner}/${repo}/pull/${number}` };
}

it('caps inline chips at 1', () => {
  expect(MAX_ROW_PR_CHIPS).toBe(1);
});

describe('arrangeRowPrs', () => {
  it('returns empty inline/overflow/ordered for an empty list', () => {
    const result = arrangeRowPrs([]);
    expect(result.inline).toEqual([]);
    expect(result.overflow).toEqual([]);
    expect(result.ordered).toEqual([]);
  });

  it('puts a single created PR inline with no overflow', () => {
    const result = arrangeRowPrs([pr(1, 'created')]);
    expect(result.inline.map((p) => p.number)).toEqual([1]);
    expect(result.overflow).toHaveLength(0);
    expect(result.ordered).toHaveLength(1);
  });

  it('picks the last-appended created PR inline for 2 created PRs, spilling the other', () => {
    const result = arrangeRowPrs([pr(1, 'created'), pr(2, 'created')]);
    expect(result.inline.map((p) => p.number)).toEqual([2]);
    expect(result.overflow.map((p) => p.number)).toEqual([1]);
  });

  it('caps inline at 1 and spills the rest to overflow for 5 created PRs, newest first is not assumed', () => {
    const result = arrangeRowPrs([
      pr(1, 'created'),
      pr(2, 'created'),
      pr(3, 'created'),
      pr(4, 'created'),
      pr(5, 'created'),
    ]);
    expect(result.inline.map((p) => p.number)).toEqual([5]);
    expect(result.overflow).toHaveLength(4);
    expect(result.ordered).toHaveLength(5);
  });

  it('prefers the last-appended created PR over any mentioned PR, regardless of append order', () => {
    const input = [pr(1, 'mentioned'), pr(2, 'created'), pr(3, 'mentioned'), pr(4, 'created')];
    const result = arrangeRowPrs(input);
    expect(result.inline.map((p) => p.number)).toEqual([4]);
    expect(result.overflow.map((p) => p.number).sort()).toEqual([1, 2, 3]);
  });

  it('falls back to the last-appended mentioned PR when the session created none', () => {
    const input = [pr(5, 'mentioned'), pr(3, 'mentioned'), pr(9, 'mentioned')];
    const result = arrangeRowPrs(input);
    expect(result.inline.map((p) => p.number)).toEqual([9]);
    expect(result.overflow.map((p) => p.number)).toEqual([5, 3]);
  });

  it('ranks created PRs before mentioned ones in the ordered list, preserving append order within each group', () => {
    const input = [pr(1, 'mentioned'), pr(2, 'created'), pr(3, 'mentioned'), pr(4, 'created')];
    const result = arrangeRowPrs(input);
    expect(result.ordered.map((p) => p.number)).toEqual([2, 4, 1, 3]);
  });

  it('keeps same-numbered PRs from different repos distinct', () => {
    const input = [pr(7, 'created', 'org', 'a'), pr(7, 'created', 'org', 'b')];
    const result = arrangeRowPrs(input);
    expect(result.ordered).toHaveLength(2);
    expect(new Set(result.ordered.map((p) => p.url)).size).toBe(2);
    expect(result.inline[0]?.url).toBe('https://github.com/org/b/pull/7');
  });

  it('does not mutate the input array', () => {
    const input = [pr(3, 'mentioned'), pr(1, 'created'), pr(2, 'created')];
    const before = input.map((p) => p.number);
    arrangeRowPrs(input);
    expect(input.map((p) => p.number)).toEqual(before);
  });
});
