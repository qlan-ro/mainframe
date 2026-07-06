/**
 * ConflictView.test.tsx — lists conflict files + Abort fires + testids.
 *
 * Behaviors covered:
 *  1. Renders data-testid="git-conflict-view".
 *  2. Lists each conflicting file path in the view.
 *  3. Shows "Merge / Rebase Conflicts" header when conflictFiles.length > 0.
 *  4. Clicking Abort fires onAbort.
 *  5. Abort button (git-conflict-abort) is disabled when aborting=true.
 *  6. Abort button shows "Aborting..." text when aborting=true.
 *  7. Abort button shows "Abort" text when aborting=false.
 *  8. Shows "Merge in Progress" header when conflictFiles is empty + activeOperation='merge'.
 *  9. Shows "Rebase in Progress" header when conflictFiles is empty + activeOperation='rebase'.
 * 10. No file list rendered when operationInProgress (no conflicts).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConflictView, type ConflictViewProps } from '../ConflictView';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<ConflictViewProps> = {}): ConflictViewProps {
  return {
    conflictFiles: [
      { path: 'src/a.ts', status: 'UU' },
      { path: 'src/b.ts', status: 'AA' },
    ],
    activeOperation: undefined,
    onAbort: vi.fn(),
    aborting: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Renders root testid
// ---------------------------------------------------------------------------

describe('ConflictView — renders root testid', () => {
  it('renders data-testid="git-conflict-view"', () => {
    render(<ConflictView {...makeProps()} />);
    expect(screen.getByTestId('git-conflict-view')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Lists conflict file paths
// ---------------------------------------------------------------------------

describe('ConflictView — lists conflict file paths', () => {
  it('renders each conflicting file path in the view', () => {
    render(<ConflictView {...makeProps()} />);
    expect(screen.getByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('src/b.ts')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Header when conflicts present
// ---------------------------------------------------------------------------

describe('ConflictView — header text with conflicts', () => {
  it('shows "Merge / Rebase Conflicts" when conflictFiles is non-empty', () => {
    render(<ConflictView {...makeProps()} />);
    expect(screen.getByText('Merge / Rebase Conflicts')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Clicking Abort fires onAbort
// ---------------------------------------------------------------------------

describe('ConflictView — Abort fires onAbort', () => {
  it('calls onAbort once when git-conflict-abort is clicked', async () => {
    const props = makeProps();
    render(<ConflictView {...props} />);
    await userEvent.click(screen.getByTestId('git-conflict-abort'));
    expect(props.onAbort).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Abort disabled when aborting=true
// ---------------------------------------------------------------------------

describe('ConflictView — Abort button disabled while aborting', () => {
  it('has git-conflict-abort disabled when aborting=true', () => {
    render(<ConflictView {...makeProps({ aborting: true })} />);
    expect(screen.getByTestId('git-conflict-abort')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 6–7. Abort button label
// ---------------------------------------------------------------------------

describe('ConflictView — Abort button label', () => {
  it('shows "Aborting..." text when aborting=true', () => {
    render(<ConflictView {...makeProps({ aborting: true })} />);
    expect(screen.getByTestId('git-conflict-abort').textContent).toContain('Aborting...');
  });

  it('shows "Abort" text when aborting=false', () => {
    render(<ConflictView {...makeProps({ aborting: false })} />);
    expect(screen.getByTestId('git-conflict-abort').textContent).toContain('Abort');
  });
});

// ---------------------------------------------------------------------------
// 8–9. Operation-in-progress headers (no conflict files)
// ---------------------------------------------------------------------------

describe('ConflictView — operation-in-progress headers', () => {
  it('shows "Merge in Progress" when conflictFiles is empty and activeOperation is "merge"', () => {
    render(<ConflictView {...makeProps({ conflictFiles: [], activeOperation: 'merge' })} />);
    expect(screen.getByText('Merge in Progress')).toBeTruthy();
  });

  it('shows "Rebase in Progress" when conflictFiles is empty and activeOperation is "rebase"', () => {
    render(<ConflictView {...makeProps({ conflictFiles: [], activeOperation: 'rebase' })} />);
    expect(screen.getByText('Rebase in Progress')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 10. No file list when operationInProgress
// ---------------------------------------------------------------------------

describe('ConflictView — no file list during operation-in-progress', () => {
  it('does not render file paths when conflictFiles is empty and activeOperation is set', () => {
    render(<ConflictView {...makeProps({ conflictFiles: [], activeOperation: 'rebase' })} />);
    expect(screen.queryByText('src/a.ts')).toBeNull();
  });
});
