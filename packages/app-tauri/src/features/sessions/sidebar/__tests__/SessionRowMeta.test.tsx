/**
 * SessionRowMeta — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - adapterId="claude" with no worktreePath and detectedPrs=[] → adapter label
 *    data-testid="sessions-row-meta-adapter" renders text "claude".
 *  - worktreePath="/repos/mf/.git/worktrees/feat-x" and worktreeMissing=false →
 *    data-testid="sessions-row-meta-worktree" is present and contains text "feat-x".
 *  - worktreePath="/repos/mf/.git/worktrees/feat-x" and worktreeMissing=true →
 *    data-testid="sessions-row-meta-worktree-missing" is present in the DOM.
 *  - detectedPrs=[{ number: 42, url: "https://github.com/org/r/pull/42" }] →
 *    data-testid="sessions-row-meta-pr" renders text "#42".
 *  - detectedPrs=[] and no worktreePath → neither worktree nor PR elements appear.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionRowMeta } from '../SessionRowMeta';

// ---------------------------------------------------------------------------
// 1. Adapter label renders the adapterId text
// ---------------------------------------------------------------------------

describe('SessionRowMeta — adapter label', () => {
  it('renders "claude" in data-testid="sessions-row-meta-adapter"', () => {
    render(<SessionRowMeta adapterId="claude" worktreeMissing={false} detectedPrs={[]} />);
    expect(screen.getByTestId('sessions-row-meta-adapter').textContent).toBe('claude');
  });
});

// ---------------------------------------------------------------------------
// 2. Worktree pill renders the basename when worktreeMissing=false
// ---------------------------------------------------------------------------

describe('SessionRowMeta — worktree pill (not missing)', () => {
  it('renders data-testid="sessions-row-meta-worktree" containing "feat-x"', () => {
    render(
      <SessionRowMeta
        adapterId="claude"
        worktreePath="/repos/mf/.git/worktrees/feat-x"
        worktreeMissing={false}
        detectedPrs={[]}
      />,
    );
    const pill = screen.getByTestId('sessions-row-meta-worktree');
    expect(pill).toBeTruthy();
    expect(pill.textContent).toContain('feat-x');
  });
});

// ---------------------------------------------------------------------------
// 3. Worktree missing indicator is present when worktreeMissing=true
// ---------------------------------------------------------------------------

describe('SessionRowMeta — worktree missing indicator', () => {
  it('renders data-testid="sessions-row-meta-worktree-missing" when worktreeMissing=true', () => {
    render(
      <SessionRowMeta
        adapterId="claude"
        worktreePath="/repos/mf/.git/worktrees/feat-x"
        worktreeMissing={true}
        detectedPrs={[]}
      />,
    );
    expect(screen.getByTestId('sessions-row-meta-worktree')).toBeTruthy();
    expect(screen.getByTestId('sessions-row-meta-worktree-missing')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. PR chip renders "#42" for detectedPrs=[{ number: 42, url: "..." }]
// ---------------------------------------------------------------------------

describe('SessionRowMeta — PR chip', () => {
  it('renders data-testid="sessions-row-meta-pr" with text "#42"', () => {
    render(
      <SessionRowMeta
        adapterId="claude"
        worktreeMissing={false}
        detectedPrs={[
          { number: 42, url: 'https://github.com/org/r/pull/42', owner: 'org', repo: 'r', source: 'created' },
        ]}
      />,
    );
    expect(screen.getByTestId('sessions-row-meta-pr').textContent).toBe('#42');
  });
});

// ---------------------------------------------------------------------------
// 5. No worktree or PR elements when both are absent
// ---------------------------------------------------------------------------

describe('SessionRowMeta — empty state', () => {
  it('does not render worktree or PR elements when detectedPrs=[] and no worktreePath', () => {
    render(<SessionRowMeta adapterId="claude" worktreeMissing={false} detectedPrs={[]} />);
    expect(screen.queryByTestId('sessions-row-meta-worktree')).toBeNull();
    expect(screen.queryByTestId('sessions-row-meta-pr')).toBeNull();
  });
});
