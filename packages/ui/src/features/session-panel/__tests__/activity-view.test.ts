import { describe, expect, it } from 'vitest';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';
import { runningCount, runningLabel } from '../activity-view';

const task = (id: string, kind: BackgroundActivityTask['kind'] = 'bash'): BackgroundActivityTask => ({
  id,
  kind,
  description: `task ${id}`,
  startedAt: 1_700_000_000_000,
});

describe('runningCount', () => {
  it('is zero for an empty list', () => {
    expect(runningCount([])).toBe(0);
  });

  it('counts every task the daemon reports — it only ships running work', () => {
    expect(runningCount([task('a', 'agent'), task('b'), task('c', 'workflow')])).toBe(3);
  });
});

describe('runningLabel', () => {
  it('names the empty state', () => {
    expect(runningLabel(0)).toBe('Nothing running');
  });

  it('is singular at one', () => {
    expect(runningLabel(1)).toBe('1 task running');
  });

  it('is plural above one', () => {
    expect(runningLabel(3)).toBe('3 tasks running');
  });
});
