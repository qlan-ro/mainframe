/**
 * automation-row-view — unit tests.
 *
 * D23: one row per definition, with its trigger kind, status (needs-you >
 * running > idle > disabled) and compact last-run time; sorted needs-you
 * first.
 */
import { describe, expect, it } from 'vitest';
import type { AutomationRunSummary, AutomationSummary } from '../../contract';
import { deriveAutomationRows, formatLastRun } from '../automation-row-view';

function definition(id: string, over: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    id,
    name: id,
    scope: 'global',
    projectId: null,
    enabled: true,
    definition: { triggers: [], steps: [] },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function run(id: string, automationId: string, over: Partial<AutomationRunSummary> = {}): AutomationRunSummary {
  return {
    id,
    automationId,
    status: 'succeeded',
    trigger: { kind: 'manual' },
    startedAt: 1000,
    finishedAt: 2000,
    error: null,
    ...over,
  };
}

describe('deriveAutomationRows — trigger kind', () => {
  it("reads the first trigger's kind", () => {
    const rows = deriveAutomationRows(
      [
        definition('a', {
          definition: {
            triggers: [{ id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '09:00' }, onMissed: 'skip' }],
            steps: [],
          },
        }),
      ],
      [],
      [],
    );
    expect(rows[0]).toMatchObject({ trigger: 'schedule' });
  });

  it('falls back to manual when there are no triggers', () => {
    const rows = deriveAutomationRows([definition('a', { definition: { triggers: [], steps: [] } })], [], []);
    expect(rows[0]).toMatchObject({ trigger: 'manual' });
  });
});

describe('deriveAutomationRows — status', () => {
  it('is needs-you when a run is waiting', () => {
    const rows = deriveAutomationRows([definition('a')], [run('r1', 'a', { status: 'waiting' })], []);
    expect(rows[0]).toMatchObject({ status: 'needs-you' });
  });

  it('is needs-you when a run has a pending interaction, even if the run itself is "running"', () => {
    const rows = deriveAutomationRows(
      [definition('a')],
      [run('r1', 'a', { status: 'running' })],
      [
        {
          id: 'i1',
          runId: 'r1',
          stepRef: 's1',
          title: 'Approve?',
          fields: [],
          status: 'pending',
          createdAt: 1,
          resolvedAt: null,
        },
      ],
    );
    expect(rows[0]).toMatchObject({ status: 'needs-you' });
  });

  it('is running when a run is running with no pending interaction', () => {
    const rows = deriveAutomationRows([definition('a')], [run('r1', 'a', { status: 'running' })], []);
    expect(rows[0]).toMatchObject({ status: 'running' });
  });

  it('is disabled when the definition is disabled and nothing is live', () => {
    const rows = deriveAutomationRows([definition('a', { enabled: false })], [], []);
    expect(rows[0]).toMatchObject({ status: 'disabled' });
  });

  it('is idle when enabled with no live run', () => {
    const rows = deriveAutomationRows([definition('a')], [], []);
    expect(rows[0]).toMatchObject({ status: 'idle' });
  });
});

describe('deriveAutomationRows — sort order', () => {
  it('sorts needs-you first, then running, then idle, then disabled', () => {
    const rows = deriveAutomationRows(
      [definition('disabled', { enabled: false }), definition('idle'), definition('running'), definition('needs-you')],
      [run('r1', 'running', { status: 'running' }), run('r2', 'needs-you', { status: 'waiting' })],
      [],
    );
    expect(rows.map((r) => r.id)).toEqual(['needs-you', 'running', 'idle', 'disabled']);
  });

  it('keeps the library order within a tie', () => {
    const rows = deriveAutomationRows([definition('b'), definition('a')], [], []);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('deriveAutomationRows — last run', () => {
  it('reports the most recent run’s startedAt among the automation’s own runs', () => {
    const rows = deriveAutomationRows(
      [definition('a')],
      [run('r1', 'a', { startedAt: 1000 }), run('r2', 'a', { startedAt: 5000 }), run('r3', 'b', { startedAt: 9000 })],
      [],
    );
    expect(rows[0]).toMatchObject({ lastRunAt: 5000 });
  });

  it('is null when the automation never ran', () => {
    const rows = deriveAutomationRows([definition('a')], [], []);
    expect(rows[0]).toMatchObject({ lastRunAt: null });
  });
});

describe('formatLastRun', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('is null when it never ran', () => {
    expect(formatLastRun(null, Date.now())).toBeNull();
  });

  it('reads "now" under a minute', () => {
    expect(formatLastRun(1000, 1000 + 30_000)).toBe('now');
  });

  it('reads minutes under an hour', () => {
    expect(formatLastRun(0, 5 * MIN)).toBe('5m');
  });

  it('reads hours under a day', () => {
    expect(formatLastRun(0, 3 * HOUR)).toBe('3h');
  });

  it('reads days past a day', () => {
    expect(formatLastRun(0, 2 * DAY)).toBe('2d');
  });
});
