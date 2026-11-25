import { describe, it, expect } from 'vitest';
import type { ActivityEntry } from '@/features/session-panel/activity-model';
import type { DelegatedTaskRow } from '@/features/sessions/view-model/agent-provenance';
import { stripItems, stripSummary } from '../activity-strip-model';

function entry(id: string, overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return { id, kind: 'subagent', title: id, detail: '', state: 'running', startedAt: 1000, ...overrides };
}

function delegated(overrides: Partial<DelegatedTaskRow> = {}): DelegatedTaskRow {
  return {
    taskId: 't1',
    itemId: 'i1',
    title: 'Task',
    status: 'running',
    waiting: false,
    updatedAt: 0,
    ...overrides,
  };
}

const NONE: ReadonlySet<string> = new Set();

describe('stripItems', () => {
  it('lists running work, oldest first', () => {
    const items = stripItems([entry('late', { startedAt: 3000 }), entry('early', { startedAt: 1000 })], NONE);

    expect(items.map((i) => i.entry.id)).toEqual(['early', 'late']);
  });

  it('puts what needs the user first, then running, each oldest first', () => {
    const items = stripItems(
      [
        entry('run-old', { startedAt: 1000 }),
        entry('wait-new', { startedAt: 4000, state: 'needs-you', delegated: delegated({ waiting: true }) }),
        entry('run-new', { startedAt: 3000 }),
        entry('wait-old', { startedAt: 2000, state: 'needs-you' }),
      ],
      NONE,
    );

    expect(items.map((i) => i.entry.id)).toEqual(['wait-old', 'wait-new', 'run-old', 'run-new']);
    expect(items.map((i) => i.needsYou)).toEqual([true, true, false, false]);
  });

  it('lists a sub-agent the panel already marks as needing you', () => {
    const items = stripItems([entry('busy'), entry('asking', { state: 'needs-you' })], NONE);

    expect(items.map((i) => [i.entry.id, i.needsYou])).toEqual([
      ['asking', true],
      ['busy', false],
    ]);
  });

  it('leaves out a finished task whose request flag has not cleared yet', () => {
    expect(stripItems([entry('over', { state: 'stopped', delegated: delegated({ waiting: true }) })], NONE)).toEqual(
      [],
    );
  });

  it('flags a running sub-agent whose Agent call has a pending request', () => {
    const items = stripItems(
      [
        entry('quiet', { source: { messageId: 'm1', toolCallId: 'call-a' } }),
        entry('asking', { source: { messageId: 'm1', toolCallId: 'call-b' } }),
      ],
      new Set(['call-b']),
    );

    expect(items.map((i) => [i.entry.id, i.needsYou])).toEqual([
      ['asking', true],
      ['quiet', false],
    ]);
  });

  it('keeps a queued delegated task, after the running ones, marked queued', () => {
    const items = stripItems(
      [entry('waiting-in-line', { state: 'queued', startedAt: 500 }), entry('running', { startedAt: 2000 })],
      NONE,
    );

    expect(items.map((i) => [i.entry.id, i.queued])).toEqual([
      ['waiting-in-line', true],
      ['running', false],
    ]);
  });

  it('leaves out scheduled wake-ups and finished work', () => {
    const items = stripItems(
      [
        entry('wake-up', { kind: 'scheduled', state: 'scheduled' }),
        entry('done', { state: 'completed' }),
        entry('failed', { state: 'failed' }),
        entry('stopped', { state: 'stopped' }),
        entry('removed', { state: 'removed' }),
        entry('live'),
      ],
      NONE,
    );

    expect(items.map((i) => i.entry.id)).toEqual(['live']);
  });

  it('is empty when nothing is ongoing', () => {
    expect(stripItems([], NONE)).toEqual([]);
  });
});

describe('stripSummary', () => {
  const item = (needsYou: boolean) => ({ entry: entry('x'), needsYou, queued: false });

  it('counts running items', () => {
    expect(stripSummary([item(false), item(false), item(false)])).toEqual({ running: '3 running', waiting: null });
  });

  it('says "1 more needs you" for one waiting item', () => {
    expect(stripSummary([item(true)])).toEqual({ running: null, waiting: '1 more needs you' });
  });

  it('says "2 more need you" for several, beside the running count', () => {
    expect(stripSummary([item(true), item(true), item(false)])).toEqual({
      running: '1 running',
      waiting: '2 more need you',
    });
  });

  it('is empty for no items', () => {
    expect(stripSummary([])).toEqual({ running: null, waiting: null });
  });
});
