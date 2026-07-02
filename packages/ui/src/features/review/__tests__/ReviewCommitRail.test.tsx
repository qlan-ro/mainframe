/**
 * ReviewCommitRail tests.
 *
 * Behaviors covered:
 *  - Commit button disabled when message is empty or whitespace-only.
 *  - Commit button enabled when message is non-empty and committing=false and fileCount>0.
 *  - Commit button disabled while committing=true; label reads "Committing…".
 *  - Button label is "Commit 3 files" for fileCount=3 and "Commit 1 file" for fileCount=1.
 *  - Clicking the submit button calls onCommit once.
 *  - Clicking the cancel button calls onCancel once.
 *  - Typing in the textarea calls onMessageChange with the typed value.
 *  - Clicking a suggestion chip calls onMessageChange with the chip's prefix string.
 *  - unviewedCount>0 shows a warning containing the count and "files not yet reviewed.".
 *  - unviewedCount=0 hides the warning.
 *  - error string is rendered when provided.
 *  - committed=true: textarea and commit button absent; "Changes committed" shown;
 *    review-commit-done present and calls onCancel on click.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { ReviewCommitRail } = await import('../ReviewCommitRail');

// ---------------------------------------------------------------------------
// Base props — overridden per-test where needed
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  fileCount: 2,
  totalLines: 40,
  unviewedCount: 0,
  message: 'fix: correct typo',
  onMessageChange: vi.fn(),
  onCommit: vi.fn(),
  onCancel: vi.fn(),
  committing: false,
  committed: false,
  error: null as string | null,
};

function renderRail(overrides: Partial<typeof BASE_PROPS> = {}) {
  const props = { ...BASE_PROPS, ...overrides };
  // Fresh spies per call so we don't bleed between tests
  props.onMessageChange = overrides.onMessageChange ?? vi.fn();
  props.onCommit = overrides.onCommit ?? vi.fn();
  props.onCancel = overrides.onCancel ?? vi.fn();
  render(<ReviewCommitRail {...props} />);
  return props;
}

// ---------------------------------------------------------------------------
// Commit button enabled/disabled state
// ---------------------------------------------------------------------------

describe('ReviewCommitRail — commit button enabled state', () => {
  it('is disabled when message is an empty string', () => {
    renderRail({ message: '' });
    expect(screen.getByTestId('review-commit-submit')).toBeDisabled();
  });

  it('is disabled when message is whitespace only', () => {
    renderRail({ message: '   ' });
    expect(screen.getByTestId('review-commit-submit')).toBeDisabled();
  });

  it('is enabled when message is non-empty and committing=false and fileCount>0', () => {
    renderRail({ message: 'feat: add button', committing: false, fileCount: 2 });
    expect(screen.getByTestId('review-commit-submit')).not.toBeDisabled();
  });

  it('is disabled while committing=true even when message is non-empty', () => {
    renderRail({ message: 'feat: add button', committing: true, fileCount: 2 });
    expect(screen.getByTestId('review-commit-submit')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Commit button label
// ---------------------------------------------------------------------------

describe('ReviewCommitRail — commit button label', () => {
  it('reads "Commit 3 files" for fileCount=3', () => {
    renderRail({ fileCount: 3 });
    expect(screen.getByTestId('review-commit-submit')).toHaveTextContent('Commit 3 files');
  });

  it('reads "Commit 1 file" (singular) for fileCount=1', () => {
    renderRail({ fileCount: 1 });
    expect(screen.getByTestId('review-commit-submit')).toHaveTextContent('Commit 1 file');
  });

  it('reads "Committing…" while committing=true', () => {
    renderRail({ committing: true, fileCount: 2 });
    expect(screen.getByTestId('review-commit-submit')).toHaveTextContent('Committing…');
  });
});

// ---------------------------------------------------------------------------
// Commit and cancel click handlers
// ---------------------------------------------------------------------------

describe('ReviewCommitRail — button click handlers', () => {
  it('calls onCommit exactly once when the submit button is clicked', async () => {
    const onCommit = vi.fn();
    renderRail({ onCommit });
    await userEvent.click(screen.getByTestId('review-commit-submit'));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel exactly once when the cancel button is clicked', async () => {
    const onCancel = vi.fn();
    renderRail({ onCancel });
    await userEvent.click(screen.getByTestId('review-commit-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Textarea change
// ---------------------------------------------------------------------------

describe('ReviewCommitRail — textarea input', () => {
  it('calls onMessageChange with the typed value when the user types', async () => {
    const onMessageChange = vi.fn();
    renderRail({ message: '', onMessageChange });
    await userEvent.type(screen.getByTestId('review-commit-input'), 'x');
    // userEvent.type fires one change per keystroke
    expect(onMessageChange).toHaveBeenCalledWith('x');
  });
});

// ---------------------------------------------------------------------------
// Suggestion chips
// ---------------------------------------------------------------------------

describe('ReviewCommitRail — suggestion chips', () => {
  it('clicking the feat chip calls onMessageChange with "feat: "', async () => {
    const onMessageChange = vi.fn();
    renderRail({ onMessageChange });
    await userEvent.click(screen.getByTestId('review-commit-suggestion-feat'));
    expect(onMessageChange).toHaveBeenCalledWith('feat: ');
  });
});

// ---------------------------------------------------------------------------
// Unviewed warning
// ---------------------------------------------------------------------------

describe('ReviewCommitRail — unviewed warning', () => {
  it('shows "2 files not yet reviewed." when unviewedCount=2', () => {
    renderRail({ unviewedCount: 2 });
    expect(screen.getByText(/2 files not yet reviewed\./i)).toBeInTheDocument();
  });

  it('does not show the unviewed warning when unviewedCount=0', () => {
    renderRail({ unviewedCount: 0 });
    expect(screen.queryByText(/not yet reviewed/i)).not.toBeInTheDocument();
  });

  it('tags the unviewed warning with review-commit-unviewed-warning', () => {
    renderRail({ unviewedCount: 2 });
    expect(screen.getByTestId('review-commit-unviewed-warning')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

describe('ReviewCommitRail — error display', () => {
  it('renders the error string when error prop is a non-null string', () => {
    renderRail({ error: 'nothing to commit' });
    expect(screen.getByText('nothing to commit')).toBeInTheDocument();
  });

  it('does not render an error element when error is null', () => {
    renderRail({ error: null });
    expect(screen.queryByText('nothing to commit')).not.toBeInTheDocument();
  });

  it('tags the error text with review-commit-error', () => {
    renderRail({ error: 'nothing to commit' });
    expect(screen.getByTestId('review-commit-error')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Committed success state
// ---------------------------------------------------------------------------

describe('ReviewCommitRail — committed state', () => {
  it('does not show the textarea when committed=true', () => {
    renderRail({ committed: true });
    expect(screen.queryByTestId('review-commit-input')).not.toBeInTheDocument();
  });

  it('does not show the commit button when committed=true', () => {
    renderRail({ committed: true });
    expect(screen.queryByTestId('review-commit-submit')).not.toBeInTheDocument();
  });

  it('shows "Changes committed" text when committed=true', () => {
    renderRail({ committed: true });
    expect(screen.getByText('Changes committed')).toBeInTheDocument();
  });

  it('renders review-commit-done when committed=true', () => {
    renderRail({ committed: true });
    expect(screen.getByTestId('review-commit-done')).toBeInTheDocument();
  });

  it('clicking review-commit-done calls onCancel once', async () => {
    const onCancel = vi.fn();
    renderRail({ committed: true, onCancel });
    await userEvent.click(screen.getByTestId('review-commit-done'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
