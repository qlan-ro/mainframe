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

// ---------------------------------------------------------------------------
// 6. "Needs input" label renders when status='waiting'
// ---------------------------------------------------------------------------

describe('SessionRowMeta — Needs input label', () => {
  it('renders data-testid="sessions-row-meta-needs-input" with text "Needs input" when status="waiting"', () => {
    render(<SessionRowMeta adapterId="claude" worktreeMissing={false} detectedPrs={[]} status="waiting" />);
    const label = screen.getByTestId('sessions-row-meta-needs-input');
    expect(label.textContent).toBe('Needs input');
  });

  it('does not render sessions-row-meta-needs-input when status is not "waiting"', () => {
    render(<SessionRowMeta adapterId="claude" worktreeMissing={false} detectedPrs={[]} status="idle" />);
    expect(screen.queryByTestId('sessions-row-meta-needs-input')).toBeNull();
  });

  it('does not render sessions-row-meta-needs-input when status is undefined', () => {
    render(<SessionRowMeta adapterId="claude" worktreeMissing={false} detectedPrs={[]} />);
    expect(screen.queryByTestId('sessions-row-meta-needs-input')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Tag dots cluster renders for non-empty tags with a colorOf resolver
// ---------------------------------------------------------------------------

describe('SessionRowMeta — tag dots cluster', () => {
  const colorOf = (_name: string) => 'blue' as const;

  it('renders data-testid="sessions-row-meta-tag-dots" when tags=["alpha","beta"] and colorOf is provided', () => {
    render(
      <SessionRowMeta
        adapterId="claude"
        worktreeMissing={false}
        detectedPrs={[]}
        tags={['alpha', 'beta']}
        colorOf={colorOf}
      />,
    );
    expect(screen.getByTestId('sessions-row-meta-tag-dots')).toBeTruthy();
  });

  it('renders individual dot for each tag keyed by name', () => {
    render(
      <SessionRowMeta
        adapterId="claude"
        worktreeMissing={false}
        detectedPrs={[]}
        tags={['alpha', 'beta']}
        colorOf={colorOf}
      />,
    );
    expect(screen.getByTestId('sessions-row-meta-tag-dot-alpha')).toBeTruthy();
    expect(screen.getByTestId('sessions-row-meta-tag-dot-beta')).toBeTruthy();
  });

  it('slices to at most 4 dots when tags has more than 4 entries', () => {
    render(
      <SessionRowMeta
        adapterId="claude"
        worktreeMissing={false}
        detectedPrs={[]}
        tags={['a', 'b', 'c', 'd', 'e']}
        colorOf={colorOf}
      />,
    );
    const cluster = screen.getByTestId('sessions-row-meta-tag-dots');
    expect(cluster.children.length).toBe(4);
    expect(screen.queryByTestId('sessions-row-meta-tag-dot-e')).toBeNull();
  });

  it('does not render tag-dots when tags is empty', () => {
    render(<SessionRowMeta adapterId="claude" worktreeMissing={false} detectedPrs={[]} tags={[]} colorOf={colorOf} />);
    expect(screen.queryByTestId('sessions-row-meta-tag-dots')).toBeNull();
  });

  it('does not render tag-dots when colorOf is not provided', () => {
    render(<SessionRowMeta adapterId="claude" worktreeMissing={false} detectedPrs={[]} tags={['alpha']} />);
    expect(screen.queryByTestId('sessions-row-meta-tag-dots')).toBeNull();
  });
});
