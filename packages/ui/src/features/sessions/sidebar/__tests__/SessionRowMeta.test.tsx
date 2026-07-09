/**
 * SessionRowMeta — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - The adapter (claude/codex) label is NOT rendered — the artboard meta row
 *    omits it; data-testid="sessions-row-meta-adapter" must be absent.
 *  - projectId + projectName → a colored project chip renders (only in "All" view).
 *  - worktreePath="/repos/mf/.git/worktrees/feat-x" and worktreeMissing=false →
 *    data-testid="sessions-row-meta-worktree" is present and contains text "feat-x".
 *  - worktreeMissing/transcriptMissing → the unified
 *    data-testid="sessions-row-meta-degraded" marker, aria-label naming the cause(s).
 *  - detectedPrs=[{ number: 42, url: "https://github.com/org/r/pull/42" }] →
 *    data-testid="sessions-row-meta-pr" renders text "#42".
 *  - detectedPrs=[] and no worktreePath → neither worktree nor PR elements appear.
 *  - the `badge` prop is REMOVED — SessionRowMeta never renders an answer pill;
 *    status is now conveyed solely by SessionRow's StatusDot + its Hint tooltip.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionRowMeta } from '../SessionRowMeta';

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

  it('tints the chip background at 10% alpha, not 12% (finding 1.14)', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} projectId="p1" projectName="mainframe" />);
    const chip = screen.getByTestId('sessions-row-meta-project') as HTMLElement;
    expect(chip.style.backgroundColor).toContain('10%');
    expect(chip.style.backgroundColor).not.toContain('12%');
  });

  it('uses asymmetric horizontal padding with 0 vertical padding, not px-1.5 py-px (finding 1.14)', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} projectId="p1" projectName="mainframe" />);
    const chip = screen.getByTestId('sessions-row-meta-project') as HTMLElement;
    expect(chip.className).toContain('pl-[5px]');
    expect(chip.className).toContain('pr-[6px]');
    expect(chip.className).not.toContain('py-px');
    expect(chip.className).not.toContain('px-1.5');
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
// 3. Unified degraded marker (cause-agnostic, aria-label names the cause)
// ---------------------------------------------------------------------------

describe('SessionRowMeta — unified degraded marker', () => {
  it('renders sessions-row-meta-degraded labelled "Worktree missing" when worktreeMissing=true', () => {
    render(<SessionRowMeta worktreePath="/repos/mf/.git/worktrees/feat-x" worktreeMissing={true} detectedPrs={[]} />);
    expect(screen.getByTestId('sessions-row-meta-worktree')).toBeTruthy();
    const marker = screen.getByTestId('sessions-row-meta-degraded');
    expect(marker.getAttribute('aria-label')).toBe('Worktree missing');
  });

  it('renders the marker labelled "Transcript missing" when transcriptMissing=true', () => {
    render(<SessionRowMeta worktreeMissing={false} transcriptMissing={true} detectedPrs={[]} />);
    const marker = screen.getByTestId('sessions-row-meta-degraded');
    expect(marker.getAttribute('aria-label')).toBe('Transcript missing');
  });

  it('names both causes when both flags are set', () => {
    render(
      <SessionRowMeta
        worktreePath="/repos/mf/.git/worktrees/feat-x"
        worktreeMissing={true}
        transcriptMissing={true}
        detectedPrs={[]}
      />,
    );
    const marker = screen.getByTestId('sessions-row-meta-degraded');
    expect(marker.getAttribute('aria-label')).toBe('Worktree missing · Transcript missing');
  });

  it('renders no marker (and never the old worktree-missing testid) when healthy', () => {
    render(<SessionRowMeta worktreePath="/repos/mf/.git/worktrees/feat-x" worktreeMissing={false} detectedPrs={[]} />);
    expect(screen.queryByTestId('sessions-row-meta-degraded')).toBeNull();
    expect(screen.queryByTestId('sessions-row-meta-worktree-missing')).toBeNull();
  });

  it('the old sessions-row-meta-worktree-missing testid is gone even when degraded', () => {
    render(<SessionRowMeta worktreePath="/repos/mf/.git/worktrees/feat-x" worktreeMissing={true} detectedPrs={[]} />);
    expect(screen.queryByTestId('sessions-row-meta-worktree-missing')).toBeNull();
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
// 6. Answer pill is fully removed — the `badge` prop no longer exists on
// SessionRowMeta, so no answer pill is ever rendered by this component.
// ---------------------------------------------------------------------------

describe('SessionRowMeta — answer pill removed', () => {
  it('does not render sessions-row-answer-pill (badge prop no longer accepted)', () => {
    render(<SessionRowMeta worktreeMissing={false} detectedPrs={[]} />);
    expect(screen.queryByTestId('sessions-row-answer-pill')).toBeNull();
  });

  it('still renders worktree/PR/tags/project chip content without a badge prop', () => {
    render(
      <SessionRowMeta
        worktreePath="/repos/mf/.git/worktrees/feat-x"
        worktreeMissing={false}
        detectedPrs={[
          { number: 42, url: 'https://github.com/org/r/pull/42', owner: 'org', repo: 'r', source: 'created' },
        ]}
        tags={['alpha']}
        colorOf={() => 'blue'}
        projectId="p1"
        projectName="mainframe"
      />,
    );
    expect(screen.getByTestId('sessions-row-meta-worktree')).toBeTruthy();
    expect(screen.getByTestId('sessions-row-meta-pr')).toBeTruthy();
    expect(screen.getByTestId('sessions-row-meta-tag-dots')).toBeTruthy();
    expect(screen.getByTestId('sessions-row-meta-project')).toBeTruthy();
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
