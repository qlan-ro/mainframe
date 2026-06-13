/**
 * SessionRowMeta — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - The adapter (claude/codex) label is NOT rendered — the artboard meta row
 *    omits it; data-testid="sessions-row-meta-adapter" must be absent.
 *  - projectId + projectName → a colored project chip renders (only in "All" view).
 *  - worktreePath="/repos/mf/.git/worktrees/feat-x" and worktreeMissing=false →
 *    data-testid="sessions-row-meta-worktree" is present and contains text "feat-x".
 *  - worktreePath="/repos/mf/.git/worktrees/feat-x" and worktreeMissing=true →
 *    data-testid="sessions-row-meta-worktree-missing" is present in the DOM.
 *  - detectedPrs=[{ number: 42, url: "https://github.com/org/r/pull/42" }] →
 *    data-testid="sessions-row-meta-pr" renders text "#42".
 *  - detectedPrs=[] and no worktreePath → neither worktree nor PR elements appear.
 *  - badge.base='waiting' + unread → AnswerPill "Answer ready"; seen → "Your turn".
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionRowMeta } from '../SessionRowMeta';
import type { SessionBadge } from '../../view-model/session-status';

// ---------------------------------------------------------------------------
// 1. Adapter label is removed (artboard meta row omits it)
// ---------------------------------------------------------------------------

describe('SessionRowMeta — adapter label removed', () => {
  it('does not render data-testid="sessions-row-meta-adapter"', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} />);
    expect(screen.queryByTestId('sessions-row-meta-adapter')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 1b. Per-project colored chip renders for projectId + projectName ("All" view)
// ---------------------------------------------------------------------------

describe('SessionRowMeta — per-project colored chip', () => {
  it('renders data-testid="sessions-row-meta-project" with the project name when projectId + projectName given', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} projectId="p1" projectName="mainframe" />);
    const chip = screen.getByTestId('sessions-row-meta-project');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('mainframe');
  });

  it('tints the chip via an inline color (a deterministic per-project color is applied)', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} projectId="p1" projectName="mainframe" />);
    const chip = screen.getByTestId('sessions-row-meta-project') as HTMLElement;
    // The chip carries an inline color + background (color-mix) — proves the
    // neutral-gray default was replaced by a per-project identity color.
    expect(chip.style.color).not.toBe('');
    expect(chip.style.backgroundColor).not.toBe('');
  });

  it('does not render the project chip when projectName is omitted (project filter active)', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} projectId="p1" />);
    expect(screen.queryByTestId('sessions-row-meta-project')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Worktree pill renders the basename when worktreeMissing=false
// ---------------------------------------------------------------------------

describe('SessionRowMeta — worktree pill (not missing)', () => {
  it('renders data-testid="sessions-row-meta-worktree" containing "feat-x"', () => {
    render(<SessionRowMeta worktreePath="/repos/mf/.git/worktrees/feat-x" worktreeMissing={false} detectedPrs={[]} />);
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
    render(<SessionRowMeta worktreePath="/repos/mf/.git/worktrees/feat-x" worktreeMissing={true} detectedPrs={[]} />);
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
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} />);
    expect(screen.queryByTestId('sessions-row-meta-worktree')).toBeNull();
    expect(screen.queryByTestId('sessions-row-meta-pr')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. AnswerPill renders via badge prop (replaces old "Needs input" label)
// ---------------------------------------------------------------------------

describe('SessionRowMeta — AnswerPill via badge prop', () => {
  const waitingUnread: SessionBadge = { base: 'waiting', unread: true };
  const waitingSeen: SessionBadge = { base: 'waiting', unread: false };
  const idleBadge: SessionBadge = { base: 'idle', unread: false };

  it('renders sessions-row-answer-pill with "Answer ready" when badge.base=waiting and unread=true', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} badge={waitingUnread} />);
    const pill = screen.getByTestId('sessions-row-answer-pill');
    expect(pill.textContent).toBe('Answer ready');
  });

  it('renders sessions-row-answer-pill with "Your turn" when badge.base=waiting and unread=false', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} badge={waitingSeen} />);
    const pill = screen.getByTestId('sessions-row-answer-pill');
    expect(pill.textContent).toBe('Your turn');
  });

  it('does not render sessions-row-answer-pill when badge.base is idle', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} badge={idleBadge} />);
    expect(screen.queryByTestId('sessions-row-answer-pill')).toBeNull();
  });

  it('does not render sessions-row-answer-pill when badge is omitted', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} />);
    expect(screen.queryByTestId('sessions-row-answer-pill')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Tag dots cluster renders for non-empty tags with a colorOf resolver
// ---------------------------------------------------------------------------

describe('SessionRowMeta — tag dots cluster', () => {
  const colorOf = (_name: string) => 'blue' as const;

  it('renders data-testid="sessions-row-meta-tag-dots" when tags=["alpha","beta"] and colorOf is provided', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} tags={['alpha', 'beta']} colorOf={colorOf} />);
    expect(screen.getByTestId('sessions-row-meta-tag-dots')).toBeTruthy();
  });

  it('renders individual dot for each tag keyed by name', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} tags={['alpha', 'beta']} colorOf={colorOf} />);
    expect(screen.getByTestId('sessions-row-meta-tag-dot-alpha')).toBeTruthy();
    expect(screen.getByTestId('sessions-row-meta-tag-dot-beta')).toBeTruthy();
  });

  it('slices to at most 4 dots when tags has more than 4 entries', () => {
    render(
      <SessionRowMeta worktreeMissing={false} detectedPrs={[]} tags={['a', 'b', 'c', 'd', 'e']} colorOf={colorOf} />,
    );
    const cluster = screen.getByTestId('sessions-row-meta-tag-dots');
    expect(cluster.children.length).toBe(4);
    expect(screen.queryByTestId('sessions-row-meta-tag-dot-e')).toBeNull();
  });

  it('does not render tag-dots when tags is empty', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} tags={[]} colorOf={colorOf} />);
    expect(screen.queryByTestId('sessions-row-meta-tag-dots')).toBeNull();
  });

  it('does not render tag-dots when colorOf is not provided', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} tags={['alpha']} />);
    expect(screen.queryByTestId('sessions-row-meta-tag-dots')).toBeNull();
  });
});
