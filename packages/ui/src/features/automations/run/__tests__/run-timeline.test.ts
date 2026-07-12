/**
 * run-timeline — pure helpers RunView/RunStepRow/RunRepeatGroup share:
 * duration formatting, grouping a Repeat block's flat `<stepId>#<iteration>`
 * fan-out entries (contract §2), the "Kept going" derivation (a timeline
 * entry carries no such flag on the wire — it's `status==='failed'` matched
 * against that step's own `keepGoing` in the definition), and a display
 * label fallback when the frozen step definition isn't found.
 * TDD: test written first, implementation after.
 */
import { describe, expect, it } from 'vitest';
import type { ActionCatalogEntry, AutomationStep, AutomationTimelineEntry, RepeatBlock } from '../../contract';
import { entryLabel, formatDuration, groupRepeatIterations, isKeptGoing } from '../run-timeline';

function askAgent(id: string, extra: Partial<AutomationStep> = {}): AutomationStep {
  return { id, kind: 'ask_agent', prompt: [], ...extra } as AutomationStep;
}

function entry(overrides: Partial<AutomationTimelineEntry>): AutomationTimelineEntry {
  return { stepRef: 's1', stepId: 's1', kind: 'ask_agent', status: 'succeeded', ...overrides };
}

describe('formatDuration', () => {
  it('renders sub-second durations with one decimal', () => {
    expect(formatDuration(1000, 1600)).toBe('0.6s');
    expect(formatDuration(1000, 1100)).toBe('0.1s');
  });

  it('renders whole seconds under a minute', () => {
    expect(formatDuration(0, 12000)).toBe('12s');
    expect(formatDuration(0, 22000)).toBe('22s');
  });

  it('renders minutes and seconds at or above a minute', () => {
    expect(formatDuration(0, 100000)).toBe('1m 40s');
  });

  it('returns null when startedAt or finishedAt is missing (still running/waiting)', () => {
    expect(formatDuration(undefined, 1000)).toBeNull();
    expect(formatDuration(1000, undefined)).toBeNull();
    expect(formatDuration(undefined, undefined)).toBeNull();
  });
});

describe('isKeptGoing', () => {
  it('is true for a failed entry whose step definition has keepGoing: true', () => {
    const steps = [askAgent('a', { keepGoing: true })];
    expect(isKeptGoing(entry({ stepId: 'a', status: 'failed' }), steps)).toBe(true);
  });

  it('is false for a failed entry whose step has no keepGoing flag', () => {
    const steps = [askAgent('a')];
    expect(isKeptGoing(entry({ stepId: 'a', status: 'failed' }), steps)).toBe(false);
  });

  it('is false for a succeeded entry even if keepGoing is true', () => {
    const steps = [askAgent('a', { keepGoing: true })];
    expect(isKeptGoing(entry({ stepId: 'a', status: 'succeeded' }), steps)).toBe(false);
  });

  it('is false when the step definition cannot be found', () => {
    expect(isKeptGoing(entry({ stepId: 'missing', status: 'failed' }), [])).toBe(false);
  });
});

describe('entryLabel', () => {
  const catalog: ActionCatalogEntry[] = [
    {
      id: 'notion.add_row',
      title: 'Add a database row',
      group: 'connector',
      auth: 'token',
      paramsSchema: {},
      outputs: [],
    },
  ];

  it("uses the matched step's display label (ask_me title, run_action catalog title, …)", () => {
    const steps: AutomationStep[] = [{ id: 'q', kind: 'ask_me', title: 'Health check-in', fields: [] }];
    expect(entryLabel(entry({ stepId: 'q', kind: 'ask_me' }), steps, catalog)).toBe('Health check-in');
  });

  it('falls back to the verb label when the step definition is missing (e.g. a deleted step)', () => {
    expect(entryLabel(entry({ stepId: 'gone', kind: 'notify' }), [], catalog)).toBe('Notify me');
  });
});

describe('groupRepeatIterations', () => {
  const repeatStep: RepeatBlock = {
    id: 'repeat-prs',
    kind: 'repeat',
    items: { stepId: 'list-open-prs', output: 'prs' },
    steps: [askAgent('ask-review-pr')],
  };

  it('groups fan-out entries by iteration number, in order, ignoring unrelated top-level entries', () => {
    const timeline: AutomationTimelineEntry[] = [
      entry({ stepRef: 'list-open-prs', stepId: 'list-open-prs', kind: 'run_action' }),
      entry({ stepRef: 'repeat-prs', stepId: 'repeat-prs', kind: 'repeat', status: 'running' }),
      entry({ stepRef: 'ask-review-pr#1', stepId: 'ask-review-pr', status: 'succeeded' }),
      entry({ stepRef: 'ask-review-pr#2', stepId: 'ask-review-pr', status: 'failed' }),
      entry({ stepRef: 'ask-review-pr#3', stepId: 'ask-review-pr', status: 'running' }),
    ];
    const groups = groupRepeatIterations(timeline, repeatStep);
    expect(groups.map((g) => g.iteration)).toEqual([1, 2, 3]);
    expect(groups.map((g) => g.entries.map((e) => e.stepRef))).toEqual([
      ['ask-review-pr#1'],
      ['ask-review-pr#2'],
      ['ask-review-pr#3'],
    ]);
  });

  it('returns an empty array when the repeat has not produced any iterations yet', () => {
    expect(groupRepeatIterations([], repeatStep)).toEqual([]);
  });

  it('multiple inner steps in one iteration land in the same group, in timeline order', () => {
    const twoStepRepeat: RepeatBlock = { ...repeatStep, steps: [askAgent('review'), askAgent('comment')] };
    const timeline: AutomationTimelineEntry[] = [
      entry({ stepRef: 'review#1', stepId: 'review' }),
      entry({ stepRef: 'comment#1', stepId: 'comment' }),
    ];
    const groups = groupRepeatIterations(timeline, twoStepRepeat);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map((e) => e.stepRef)).toEqual(['review#1', 'comment#1']);
  });
});
