// @vitest-environment node
/**
 * sync-format.test.ts
 *
 * Red-phase test for the pure formatting helpers (`../sync-format`, not yet
 * created — task 30 of the plan implements it against this file, per the
 * frozen module contract and the spec's "Report format" section).
 *
 * Behaviors covered:
 *  - statusLabel maps open|in_progress|done -> Open|In progress|Done, and the raw
 *    snake_case key never appears in the output (AC33).
 *  - syncedAgo(null) -> 'never synced'; a recent timestamp reads "synced ... ago".
 *  - ruleLine renders the three fixed rule strings (recency / tie / in-progress-close).
 *  - ruleLine appends "(issue timestamp, to the minute)" when the remote stamp is coarse.
 *  - ruleLine for a tie with an unresolvable remote stamp shows the local stamp alone,
 *    followed by "GitHub timestamp unavailable".
 *  - ruleLine for in-progress-close shows no timestamp at all (AC21) — exact string.
 *  - fieldLabel maps title|body|state -> Title|Body|State.
 *  - winnerLabel maps github|mainframe -> "GitHub won"|"Mainframe won".
 *  - nowLine renders the literal winning value for title/state, and "the body shown on
 *    task #N" for body.
 */
import { describe, it, expect } from 'vitest';
import { statusLabel, syncedAgo, ruleLine, fieldLabel, winnerLabel, nowLine } from '../sync-format';
import type { ReportRow } from '@/lib/api/todos-github';

const baseRow = (overrides: Partial<ReportRow>): ReportRow => ({
  id: 'row-1',
  todoNumber: 286,
  todoTitle: 'Sync GitHub issues',
  issueNumber: 42,
  field: 'title',
  winner: 'mainframe',
  rule: 'recency',
  localAt: '2026-07-31T13:58:02.000Z',
  remoteAt: '2026-07-31T14:04:11.000Z',
  remoteCoarse: false,
  winningValue: 'Fix the login bug',
  replacedValue: 'Fix login bug',
  ...overrides,
});

describe('statusLabel', () => {
  it.each([
    ['open', 'Open'],
    ['in_progress', 'In progress'],
    ['done', 'Done'],
  ] as const)('maps %s to %s', (status, label) => {
    const result = statusLabel(status);
    expect(result).toBe(label);
    expect(result).not.toContain(status);
  });
});

describe('syncedAgo', () => {
  it('renders "never synced" for null', () => {
    expect(syncedAgo(null)).toBe('never synced');
  });

  it('renders a "synced ... ago" phrase for a recent timestamp', () => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const result = syncedAgo(threeMinutesAgo);
    expect(result).toMatch(/^synced .+ ago$/);
  });
});

describe('ruleLine — the three fixed rule strings', () => {
  it('recency shows both stamps and the fixed phrase', () => {
    const line = ruleLine(baseRow({ rule: 'recency', winner: 'mainframe' }));
    expect(line).toContain('more recent change won');
  });

  it('tie with equal stamps shows the fixed phrase', () => {
    const line = ruleLine(
      baseRow({
        rule: 'tie',
        winner: 'github',
        localAt: '2026-07-31T13:58:02.000Z',
        remoteAt: '2026-07-31T13:58:02.000Z',
      }),
    );
    expect(line).toContain('tie — remote wins');
  });

  it('in-progress-close shows the fixed phrase and no timestamp at all (AC21)', () => {
    const line = ruleLine(
      baseRow({ rule: 'in-progress-close', winner: 'github', localAt: null, remoteAt: null, field: 'state' }),
    );
    expect(line).toBe('remote close applied to an in-progress todo');
  });
});

describe('ruleLine — coarse remote timestamp suffix', () => {
  it('appends "(issue timestamp, to the minute)" when remoteCoarse is true', () => {
    const line = ruleLine(baseRow({ rule: 'recency', field: 'body', remoteCoarse: true }));
    expect(line).toContain('(issue timestamp, to the minute)');
  });

  it('omits the suffix when remoteCoarse is false', () => {
    const line = ruleLine(baseRow({ rule: 'recency', field: 'body', remoteCoarse: false }));
    expect(line).not.toContain('(issue timestamp, to the minute)');
  });
});

describe('ruleLine — tie with an unresolvable remote stamp', () => {
  it('shows the local stamp alone, followed by "GitHub timestamp unavailable"', () => {
    const line = ruleLine(
      baseRow({ rule: 'tie', winner: 'github', localAt: '2026-07-31T13:58:02.000Z', remoteAt: null }),
    );
    expect(line).toContain('tie — remote wins');
    expect(line).toContain('GitHub timestamp unavailable');
  });
});

describe('fieldLabel', () => {
  it.each([
    ['title', 'Title'],
    ['body', 'Body'],
    ['state', 'State'],
  ] as const)('maps %s to %s', (field, label) => {
    expect(fieldLabel(field)).toBe(label);
  });
});

describe('winnerLabel', () => {
  it.each([
    ['github', 'GitHub won'],
    ['mainframe', 'Mainframe won'],
  ] as const)('maps %s to %s', (winner, label) => {
    expect(winnerLabel(winner)).toBe(label);
  });
});

describe('nowLine', () => {
  it('renders the literal winning value for a title row', () => {
    const row = baseRow({ field: 'title', winningValue: 'Fix the login bug' });
    expect(nowLine(row, 286)).toBe('Fix the login bug');
  });

  it('renders the literal winning value for a state row', () => {
    const row = baseRow({ field: 'state', winningValue: 'done' });
    expect(nowLine(row, 286)).toBe('done');
  });

  it('renders "the body shown on task #N" for a body row', () => {
    const row = baseRow({ field: 'body', winningValue: 'Full replacement body text' });
    expect(nowLine(row, 286)).toBe('the body shown on task #286');
  });
});
