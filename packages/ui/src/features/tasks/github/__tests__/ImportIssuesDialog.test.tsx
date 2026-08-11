// @vitest-environment jsdom
/**
 * ImportIssuesDialog.test.tsx
 *
 * Red-phase test for the import dialog (`../ImportIssuesDialog`, not yet created
 * — task 40 of the plan implements it against this file), per the spec's
 * "Importing issues" paragraph. Reads `issues` (RemoteIssue[]) from the store,
 * populated via `loadIssues()` (D5); confirming calls `importIssues(numbers)`
 * with the selected, importable issue numbers.
 *
 * Behaviors covered:
 *  1. Renders nothing when the dialog isn't `{ kind: 'import' }`.
 *  2. One row per issue, keyed by issue number (`tasks-github-import-issue-${n}`),
 *     showing its title.
 *  3. An already-paired issue's row is disabled and reads
 *     "Already paired with task #{pairedTodoNumber}".
 *  4. `tasks-github-import-all` selects every importable (unpaired) row, and
 *     toggling it back off clears the selection.
 *  5. The footer reads "Import {n} issues" for the current selection count.
 *  6. `tasks-github-import-confirm` calls `importIssues` with exactly the
 *     selected, importable issue numbers (never a paired one).
 *  7. A rejected credential (`errorAuth`) offers `tasks-github-import-update-token`,
 *     which opens the token dialog with `returnTo: 'import'`; any other failure
 *     offers no such button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RemoteIssue } from '@/lib/api/todos-github';

const ISSUES: RemoteIssue[] = [
  { number: 101, title: 'Crash on startup', labels: ['bug'], pairedTodoNumber: null },
  { number: 102, title: 'Improve onboarding copy', labels: [], pairedTodoNumber: null },
  { number: 103, title: 'Flaky upload test', labels: ['bug', 'flaky'], pairedTodoNumber: 219 },
];

const importIssues = vi.fn();
const closeDialog = vi.fn();
const openDialog = vi.fn();

let dialog: null | { kind: 'import' } | { kind: 'link' };
let issues: RemoteIssue[];
let error: string | null;
let errorAuth: boolean;

vi.mock('../use-github-sync-store', () => ({
  useGitHubSyncStore: () => ({ dialog, issues, error, errorAuth, importIssues, openDialog, closeDialog }),
}));

const { ImportIssuesDialog } = await import('../ImportIssuesDialog');

beforeEach(() => {
  vi.clearAllMocks();
  dialog = { kind: 'import' };
  issues = ISSUES;
  error = null;
  errorAuth = false;
});

describe('ImportIssuesDialog — visibility', () => {
  it('renders nothing when the dialog is not an import dialog', () => {
    dialog = { kind: 'link' };
    const { container } = render(<ImportIssuesDialog />);
    expect(container.textContent).toBe('');
  });
});

describe('ImportIssuesDialog — rows', () => {
  it('renders one row per issue keyed by issue number, showing its title', () => {
    render(<ImportIssuesDialog />);
    expect(screen.getByTestId('tasks-github-import-issue-101').textContent).toContain('Crash on startup');
    expect(screen.getByTestId('tasks-github-import-issue-102').textContent).toContain('Improve onboarding copy');
    expect(screen.getByTestId('tasks-github-import-issue-103').textContent).toContain('Flaky upload test');
  });

  it('disables the already-paired row and names the paired task', () => {
    render(<ImportIssuesDialog />);
    const pairedRow = screen.getByTestId('tasks-github-import-issue-103');
    expect(pairedRow.textContent).toContain('Already paired with task #219');
    expect(pairedRow.querySelector('input,button')).toBeDisabled();
  });
});

describe('ImportIssuesDialog — load failure', () => {
  it('shows the load error instead of the empty-state message when the fetch failed', () => {
    issues = [];
    error = "No GitHub credential is stored for 'github'. Link the repository again to connect one.";
    render(<ImportIssuesDialog />);
    expect(screen.getByTestId('tasks-github-import-error').textContent).toBe(error);
    expect(screen.queryByText('No open issues to import.')).toBeNull();
  });

  it('still shows the empty-state message when there genuinely are no open issues', () => {
    issues = [];
    error = null;
    render(<ImportIssuesDialog />);
    expect(screen.getByText('No open issues to import.')).toBeTruthy();
    expect(screen.queryByTestId('tasks-github-import-error')).toBeNull();
  });
});

describe('ImportIssuesDialog — rejected credential', () => {
  const AUTH_ERROR = 'GitHub rejected the stored credential — the token is missing, expired, or revoked.';

  it('offers the token fix when GitHub refused the stored credential', () => {
    issues = [];
    error = AUTH_ERROR;
    errorAuth = true;
    render(<ImportIssuesDialog />);
    expect(screen.getByTestId('tasks-github-import-error').textContent).toBe(AUTH_ERROR);
    expect(screen.getByTestId('tasks-github-import-update-token').textContent).toContain('Update GitHub token…');
  });

  it('offers no token fix for a failure that is not a credential problem', () => {
    issues = [];
    error = 'daemon unreachable';
    errorAuth = false;
    render(<ImportIssuesDialog />);
    expect(screen.getByTestId('tasks-github-import-error').textContent).toBe('daemon unreachable');
    expect(screen.queryByTestId('tasks-github-import-update-token')).toBeNull();
  });

  it('opens the token dialog set to return to the import dialog', async () => {
    issues = [];
    error = AUTH_ERROR;
    errorAuth = true;
    render(<ImportIssuesDialog />);

    await userEvent.click(screen.getByTestId('tasks-github-import-update-token'));

    expect(openDialog).toHaveBeenCalledWith({ kind: 'token', returnTo: 'import' });
  });
});

describe('ImportIssuesDialog — select all', () => {
  it('selects every importable row and updates the footer count', async () => {
    render(<ImportIssuesDialog />);
    await userEvent.click(screen.getByTestId('tasks-github-import-all'));
    expect(screen.getByText('Import 2 issues')).toBeTruthy();
  });

  it('clears the selection when toggled back off', async () => {
    render(<ImportIssuesDialog />);
    const selectAll = screen.getByTestId('tasks-github-import-all');
    await userEvent.click(selectAll);
    await userEvent.click(selectAll);
    expect(screen.getByText('Import 0 issues')).toBeTruthy();
  });
});

describe('ImportIssuesDialog — confirm', () => {
  it('imports exactly the selected, importable issue numbers', async () => {
    render(<ImportIssuesDialog />);
    await userEvent.click(screen.getByTestId('tasks-github-import-issue-101'));
    await userEvent.click(screen.getByTestId('tasks-github-import-confirm'));
    expect(importIssues).toHaveBeenCalledWith([101]);
  });

  it('never includes an already-paired issue, even via select-all', async () => {
    render(<ImportIssuesDialog />);
    await userEvent.click(screen.getByTestId('tasks-github-import-all'));
    await userEvent.click(screen.getByTestId('tasks-github-import-confirm'));
    expect(importIssues).toHaveBeenCalledWith([101, 102]);
  });
});
