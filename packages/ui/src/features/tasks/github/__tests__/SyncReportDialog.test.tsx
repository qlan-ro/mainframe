// @vitest-environment jsdom
/**
 * SyncReportDialog.test.tsx
 *
 * Red-phase test for the sync report dialog (`../SyncReportDialog`, not yet
 * created — task 34 of the plan implements it against this file), per the
 * spec's "Report format" section. Reads `dialog`/`report` from the store (D5);
 * renders nothing unless `dialog?.kind === 'report'`.
 *
 * Behaviors covered:
 *  1. Renders nothing when the dialog isn't a report dialog.
 *  2. Header states the pair/overwrite counts (exact fixed phrase; the time-of-day
 *     portion is locale-formatted, so only the fixed wording is pinned).
 *  3. A failure sentence renders directly beneath the header when present, and is
 *     absent when `failure` is null.
 *  4. A collapsed row per overwrite shows the issue number, field family, truncated
 *     task title, and winner chip; `in_progress` (raw snake_case) never reaches the DOM (AC33).
 *  5. Expanding a row reveals exactly the rule line, the "Now" line, the amber
 *     replaced-value block, and a copy button (`tasks-github-report-copy-${id}`).
 *  6. Two rows expand independently of each other.
 *  7. An empty report (no rows) renders the three-line "Nothing was overwritten
 *     in this run." state instead of any row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Report, ReportRow } from '@/lib/api/todos-github';

const ROW_A: ReportRow = {
  id: 'row-1',
  todoNumber: 285,
  todoTitle: 'Fix the login bug that has been reported by several long-standing customers',
  issueNumber: 219,
  field: 'title',
  winner: 'github',
  rule: 'recency',
  localAt: '2026-07-31T13:58:02.000Z',
  remoteAt: '2026-07-31T14:04:11.000Z',
  remoteCoarse: false,
  winningValue: 'Fix login regression on Safari',
  replacedValue: 'Fix the login bug',
};

const ROW_B: ReportRow = {
  id: 'row-2',
  todoNumber: 286,
  todoTitle: 'Sync GitHub issues',
  issueNumber: 220,
  field: 'state',
  winner: 'github',
  rule: 'in-progress-close',
  localAt: null,
  remoteAt: null,
  remoteCoarse: false,
  winningValue: 'done',
  replacedValue: 'in_progress',
};

const REPORT_FIXTURE: Report = {
  runId: 'run-1',
  finishedAt: '2026-07-31T14:22:00.000Z',
  pairsReconciled: 5,
  failure: null,
  rows: [ROW_A, ROW_B],
};

let dialog: null | { kind: 'report' } | { kind: 'link' };
let report: Report | null;

vi.mock('../use-github-sync-store', () => ({
  useGitHubSyncStore: () => ({ dialog, report }),
}));

const { SyncReportDialog } = await import('../SyncReportDialog');

beforeEach(() => {
  vi.clearAllMocks();
  dialog = { kind: 'report' };
  report = REPORT_FIXTURE;
});

describe('SyncReportDialog — visibility', () => {
  it('renders nothing when the dialog is not a report dialog', () => {
    dialog = { kind: 'link' };
    const { container } = render(<SyncReportDialog />);
    expect(container.textContent).toBe('');
  });
});

describe('SyncReportDialog — header', () => {
  it('states the pair and overwrite counts', () => {
    render(<SyncReportDialog />);
    const dialogEl = screen.getByTestId('tasks-github-report-dialog');
    expect(dialogEl.textContent).toContain('5 pairs reconciled at');
    expect(dialogEl.textContent).toContain('2 fields were overwritten — the replaced values are below.');
  });

  it('shows the failure sentence directly beneath the header when present', () => {
    report = {
      ...REPORT_FIXTURE,
      failure: {
        kind: 'rate-limit',
        message: 'Rate limited by GitHub after 3 of 7 pairs. The 4 pairs not reached were left untouched.',
        reached: 3,
        total: 7,
      },
    };
    render(<SyncReportDialog />);
    expect(screen.getByTestId('tasks-github-report-dialog').textContent).toContain(
      'Rate limited by GitHub after 3 of 7 pairs. The 4 pairs not reached were left untouched.',
    );
  });

  it('shows no failure sentence when failure is null', () => {
    render(<SyncReportDialog />);
    expect(screen.getByTestId('tasks-github-report-dialog').textContent).not.toContain('Rate limited');
  });
});

describe('SyncReportDialog — collapsed rows', () => {
  it('shows the issue number, field family, truncated title, and winner chip', () => {
    render(<SyncReportDialog />);
    const row = screen.getByTestId('tasks-github-report-row-row-1');
    expect(row.textContent).toContain('219');
    expect(row.textContent).toContain('Title');
    expect(row.textContent).toContain('GitHub won');
  });

  it('never lets the raw snake_case field value reach the DOM (AC33)', () => {
    render(<SyncReportDialog />);
    const row = screen.getByTestId('tasks-github-report-row-row-2');
    expect(row.textContent).not.toContain('in_progress');
  });
});

describe('SyncReportDialog — expanded row', () => {
  it('reveals the rule line, the Now line, the replaced-value block, and the copy button', async () => {
    render(<SyncReportDialog />);
    await userEvent.click(screen.getByTestId('tasks-github-report-row-row-1'));

    const row = screen.getByTestId('tasks-github-report-row-row-1');
    expect(row.textContent).toContain('more recent change won');
    expect(row.textContent).toContain('Fix login regression on Safari');
    expect(row.textContent).toContain('Fix the login bug');
    expect(screen.getByTestId('tasks-github-report-copy-row-1')).toBeTruthy();
  });

  it('expands two rows independently', async () => {
    render(<SyncReportDialog />);
    await userEvent.click(screen.getByTestId('tasks-github-report-row-row-1'));
    await userEvent.click(screen.getByTestId('tasks-github-report-row-row-2'));

    expect(screen.getByTestId('tasks-github-report-copy-row-1')).toBeTruthy();
    expect(screen.getByTestId('tasks-github-report-copy-row-2')).toBeTruthy();
    expect(screen.getByTestId('tasks-github-report-row-row-2').textContent).toContain(
      'remote close applied to an in-progress todo',
    );
  });
});

describe('SyncReportDialog — empty report', () => {
  it('renders "Nothing was overwritten in this run." instead of any row', () => {
    report = { ...REPORT_FIXTURE, rows: [] };
    render(<SyncReportDialog />);
    const dialogEl = screen.getByTestId('tasks-github-report-dialog');
    expect(dialogEl.textContent).toContain('Nothing was overwritten in this run.');
    expect(screen.queryByTestId('tasks-github-report-row-row-1')).toBeNull();
  });
});
