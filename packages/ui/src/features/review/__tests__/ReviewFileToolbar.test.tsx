/**
 * ReviewFileToolbar tests.
 *
 * Behaviors covered:
 *  - Renders the basename of the file path.
 *  - Renders the directory portion with a trailing slash.
 *  - Shows +<additions> and −<deletions> (U+2212 minus sign).
 *  - Clicking review-open-in-workspace calls onOpenInWorkspace once.
 *  - Clicking review-viewed-toggle calls onToggleViewed once.
 *  - The viewed toggle's aria-pressed reflects the viewed prop (true / false).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { ReviewFileToolbar } = await import('../ReviewFileToolbar');

// ---------------------------------------------------------------------------
// Filename / directory rendering
// ---------------------------------------------------------------------------

describe('ReviewFileToolbar — filename display', () => {
  it('renders the basename of a nested path', () => {
    render(
      <ReviewFileToolbar
        file="src/components/Layout.tsx"
        additions={18}
        deletions={7}
        viewed={false}
        onToggleViewed={vi.fn()}
        onOpenInWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByText('Layout.tsx')).toBeInTheDocument();
  });

  it('renders the directory portion with a trailing slash', () => {
    render(
      <ReviewFileToolbar
        file="src/components/Layout.tsx"
        additions={18}
        deletions={7}
        viewed={false}
        onToggleViewed={vi.fn()}
        onOpenInWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByText('src/components/')).toBeInTheDocument();
  });

  it('does not render a directory span for a root-level file', () => {
    render(
      <ReviewFileToolbar
        file="README.md"
        additions={5}
        deletions={2}
        viewed={false}
        onToggleViewed={vi.fn()}
        onOpenInWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByText('README.md')).toBeInTheDocument();
    // No trailing-slash element should appear
    expect(screen.queryByText(/\/$/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Addition / deletion counts
// ---------------------------------------------------------------------------

describe('ReviewFileToolbar — diff stat display', () => {
  it('shows +18 for additions=18 and the U+2212 minus sign for deletions=7', () => {
    render(
      <ReviewFileToolbar
        file="src/components/Layout.tsx"
        additions={18}
        deletions={7}
        viewed={false}
        onToggleViewed={vi.fn()}
        onOpenInWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByText('+18')).toBeInTheDocument();
    // U+2212 "−" (not ASCII hyphen) as used by the component
    expect(screen.getByText('−7')).toBeInTheDocument();
  });

  it('shows +0 and −0 when additions and deletions are both zero', () => {
    render(
      <ReviewFileToolbar
        file="src/index.ts"
        additions={0}
        deletions={0}
        viewed={false}
        onToggleViewed={vi.fn()}
        onOpenInWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByText('+0')).toBeInTheDocument();
    expect(screen.getByText('−0')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Button click handlers
// ---------------------------------------------------------------------------

describe('ReviewFileToolbar — button click handlers', () => {
  it('calls onOpenInWorkspace exactly once when review-open-in-workspace is clicked', async () => {
    const onOpenInWorkspace = vi.fn();
    render(
      <ReviewFileToolbar
        file="src/components/Layout.tsx"
        additions={18}
        deletions={7}
        viewed={false}
        onToggleViewed={vi.fn()}
        onOpenInWorkspace={onOpenInWorkspace}
      />,
    );
    await userEvent.click(screen.getByTestId('review-open-in-workspace'));
    expect(onOpenInWorkspace).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleViewed exactly once when review-viewed-toggle is clicked', async () => {
    const onToggleViewed = vi.fn();
    render(
      <ReviewFileToolbar
        file="src/components/Layout.tsx"
        additions={18}
        deletions={7}
        viewed={false}
        onToggleViewed={onToggleViewed}
        onOpenInWorkspace={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId('review-viewed-toggle'));
    expect(onToggleViewed).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Viewed toggle aria-pressed
// ---------------------------------------------------------------------------

describe('ReviewFileToolbar — viewed toggle aria-pressed', () => {
  it('has aria-pressed=true when viewed=true', () => {
    render(
      <ReviewFileToolbar
        file="src/components/Layout.tsx"
        additions={18}
        deletions={7}
        viewed={true}
        onToggleViewed={vi.fn()}
        onOpenInWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByTestId('review-viewed-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('has aria-pressed=false when viewed=false', () => {
    render(
      <ReviewFileToolbar
        file="src/components/Layout.tsx"
        additions={18}
        deletions={7}
        viewed={false}
        onToggleViewed={vi.fn()}
        onOpenInWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByTestId('review-viewed-toggle')).toHaveAttribute('aria-pressed', 'false');
  });
});
