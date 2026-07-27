/**
 * row-pr-chips — pure cap/prioritise logic (TDD red phase).
 *
 * A session's `detected_prs` list is unbounded, but the row can only afford
 * MAX_ROW_PR_CHIPS inline. `arrangeRowPrs` decides which PRs render inline
 * (session-owned "created" first), which spill to the overflow indicator,
 * and the single priority order the overflow panel lists.
 */
import { describe, it, expect } from 'vitest';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { MAX_ROW_PR_CHIPS, arrangeRowPrs } from '../row-pr-chips';

function pr(number: number, source: DetectedPr['source'], owner = 'org', repo = 'r'): DetectedPr {
  return { number, source, owner, repo, url: `https://github.com/${owner}/${repo}/pull/${number}` };
}

it('caps inline chips at 2', () => {
  expect(MAX_ROW_PR_CHIPS).toBe(2);
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
    expect(result.inline).toHaveLength(1);
    expect(result.overflow).toHaveLength(0);
    expect(result.ordered).toHaveLength(1);
  });

  it('keeps exactly 2 PRs inline with no overflow at the cap', () => {
    const result = arrangeRowPrs([pr(1, 'created'), pr(2, 'created')]);
    expect(result.inline).toHaveLength(2);
    expect(result.overflow).toHaveLength(0);
  });

  it('caps inline at 2 and spills the rest to overflow for 5 PRs', () => {
    const result = arrangeRowPrs([
      pr(1, 'created'),
      pr(2, 'created'),
      pr(3, 'created'),
      pr(4, 'created'),
      pr(5, 'created'),
    ]);
    expect(result.inline).toHaveLength(2);
    expect(result.overflow).toHaveLength(3);
    expect(result.ordered).toHaveLength(5);
  });

  it('ranks created PRs before mentioned ones, preserving order within each group', () => {
    const input = [pr(1, 'mentioned'), pr(2, 'created'), pr(3, 'mentioned'), pr(4, 'created')];
    const result = arrangeRowPrs(input);
    expect(result.ordered.map((p) => p.number)).toEqual([2, 4, 1, 3]);
    expect(result.inline.map((p) => p.number)).toEqual([2, 4]);
    expect(result.overflow.map((p) => p.number)).toEqual([1, 3]);
  });

  it('keeps original order when every PR is only mentioned', () => {
    const input = [pr(5, 'mentioned'), pr(3, 'mentioned'), pr(9, 'mentioned')];
    const result = arrangeRowPrs(input);
    expect(result.ordered.map((p) => p.number)).toEqual([5, 3, 9]);
  });

  it('keeps same-numbered PRs from different repos distinct', () => {
    const input = [pr(7, 'created', 'org', 'a'), pr(7, 'created', 'org', 'b')];
    const result = arrangeRowPrs(input);
    expect(result.ordered).toHaveLength(2);
    expect(new Set(result.ordered.map((p) => p.url)).size).toBe(2);
  });

  it('does not mutate the input array', () => {
    const input = [pr(3, 'mentioned'), pr(1, 'created'), pr(2, 'created')];
    const before = input.map((p) => p.number);
    arrangeRowPrs(input);
    expect(input.map((p) => p.number)).toEqual(before);
  });
});
