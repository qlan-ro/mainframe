/**
 * ReviewCommitRail tests.
 *
 * Behaviors covered:
 *  - Commit button disabled/enabled matrix (empty, whitespace, committing).
 *  - Commit button label (pluralization, "Committing…").
 *  - Clicking the submit/cancel buttons calls onCommit/onCancel once.
 *  - Typing in the textarea calls onMessageChange with the typed value.
 *  - Clicking a suggestion chip calls onMessageChange with the chip's prefix string.
 *  - unviewedCount>0 shows a warning containing the count; unviewedCount=0 hides it.
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

describe('ReviewCommitRail — commit button enabled state', () => {
  it.each([
    ['message is an empty string', { message: '' }, true],
    ['message is whitespace only', { message: '   ' }, true],
    [
      'message is non-empty, committing=false, fileCount>0',
      { message: 'feat: add button', committing: false, fileCount: 2 },
      false,
    ],
    [
      'committing=true even when message is non-empty',
      { message: 'feat: add button', committing: true, fileCount: 2 },
      true,
    ],
  ] as const)('when %s', (_name, overrides, disabled) => {
    renderRail(overrides);
    const btn = screen.getByTestId('review-commit-submit');
    if (disabled) expect(btn).toBeDisabled();
    else expect(btn).not.toBeDisabled();
  });
});

describe('ReviewCommitRail — commit button label', () => {
  it.each([
    ['Commit 3 files', { fileCount: 3 }],
    ['Commit 1 file', { fileCount: 1 }],
    ['Committing…', { committing: true, fileCount: 2 }],
  ] as const)('reads "%s"', (label, overrides) => {
    renderRail(overrides);
    expect(screen.getByTestId('review-commit-submit')).toHaveTextContent(label);
  });
});

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

describe('ReviewCommitRail — textarea input', () => {
  it('calls onMessageChange with the typed value when the user types', async () => {
    const onMessageChange = vi.fn();
    renderRail({ message: '', onMessageChange });
    await userEvent.type(screen.getByTestId('review-commit-input'), 'x');
    // userEvent.type fires one change per keystroke
    expect(onMessageChange).toHaveBeenCalledWith('x');
  });
});

describe('ReviewCommitRail — suggestion chips', () => {
  it('clicking the feat chip calls onMessageChange with "feat: "', async () => {
    const onMessageChange = vi.fn();
    renderRail({ onMessageChange });
    await userEvent.click(screen.getByTestId('review-commit-suggestion-feat'));
    expect(onMessageChange).toHaveBeenCalledWith('feat: ');
  });
});

describe('ReviewCommitRail — unviewed warning', () => {
  it('shows "2 files not yet reviewed." tagged review-commit-unviewed-warning when unviewedCount=2', () => {
    renderRail({ unviewedCount: 2 });
    expect(screen.getByTestId('review-commit-unviewed-warning')).toHaveTextContent(/2 files not yet reviewed\./i);
  });

  it('does not show the unviewed warning when unviewedCount=0', () => {
    renderRail({ unviewedCount: 0 });
    expect(screen.queryByText(/not yet reviewed/i)).not.toBeInTheDocument();
  });
});

describe('ReviewCommitRail — error display', () => {
  it('renders the error string tagged review-commit-error when error is a non-null string', () => {
    renderRail({ error: 'nothing to commit' });
    expect(screen.getByTestId('review-commit-error')).toHaveTextContent('nothing to commit');
  });

  it('does not render an error element when error is null', () => {
    renderRail({ error: null });
    expect(screen.queryByText('nothing to commit')).not.toBeInTheDocument();
  });
});

describe('ReviewCommitRail — committed state', () => {
  it('replaces the textarea and commit button with the "Changes committed" done state', () => {
    renderRail({ committed: true });
    expect(screen.queryByTestId('review-commit-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-commit-submit')).not.toBeInTheDocument();
    expect(screen.getByText('Changes committed')).toBeInTheDocument();
    expect(screen.getByTestId('review-commit-done')).toBeInTheDocument();
  });

  it('clicking review-commit-done calls onCancel once', async () => {
    const onCancel = vi.fn();
    renderRail({ committed: true, onCancel });
    await userEvent.click(screen.getByTestId('review-commit-done'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
