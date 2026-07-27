/**
 * SessionRowMetaIcons — behavior tests (TDD red phase).
 *
 * The compact single-row trailing glyph cluster (2026-07 sidebar rebuild):
 * worktree icon (if worktreePath set) + up to MAX_ROW_PR_CHIPS inline PR
 * chips (session-owned first, via SessionRowPrChips/arrangeRowPrs) + up to
 * 3 small colored tag dots. Icon-only (no worktree basename text) — the
 * full text lives in the SessionMetaCard hover card instead. The cluster
 * itself is the row's shrinkable item (SESSION_ROW_META_CLUSTER); the PR
 * overflow indicator is a row-level sibling, not rendered here.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { SessionRowMetaIcons } from '../SessionRowMetaIcons';
import { SESSION_ROW_META_CLUSTER } from '../session-row-layout';

const NO_PRS: never[] = [];

it('renders nothing when worktree/PR/tags are all absent', () => {
  const { container } = render(<SessionRowMetaIcons detectedPrs={NO_PRS} tags={[]} />);
  expect(container.firstChild).toBeNull();
});

describe('SessionRowMetaIcons — worktree glyph', () => {
  it('renders sessions-row-meta-icon-worktree when worktreePath is set', () => {
    render(<SessionRowMetaIcons worktreePath="/repos/mf/.git/worktrees/feat-x" detectedPrs={NO_PRS} tags={[]} />);
    expect(screen.getByTestId('sessions-row-meta-icon-worktree')).toBeTruthy();
  });

  it('does not render the worktree glyph when worktreePath is absent', () => {
    render(<SessionRowMetaIcons detectedPrs={NO_PRS} tags={[]} />);
    expect(screen.queryByTestId('sessions-row-meta-icon-worktree')).toBeNull();
  });

  it('turns the worktree glyph destructive-colored when worktreeMissing=true', () => {
    render(
      <SessionRowMetaIcons
        worktreePath="/repos/mf/.git/worktrees/feat-x"
        worktreeMissing
        detectedPrs={NO_PRS}
        tags={[]}
      />,
    );
    expect(screen.getByTestId('sessions-row-meta-icon-worktree').className).toContain('text-destructive');
  });

  it('keeps the worktree glyph muted when worktreeMissing is not set', () => {
    render(<SessionRowMetaIcons worktreePath="/repos/mf/.git/worktrees/feat-x" detectedPrs={NO_PRS} tags={[]} />);
    expect(screen.getByTestId('sessions-row-meta-icon-worktree').className).not.toContain('text-destructive');
  });
});

describe('SessionRowMetaIcons — PR glyph', () => {
  it('renders sessions-row-meta-icon-pr-42 with text "#42" for one detected PR', () => {
    render(
      <SessionRowMetaIcons
        detectedPrs={[
          { number: 42, url: 'https://github.com/org/r/pull/42', owner: 'org', repo: 'r', source: 'created' },
        ]}
        tags={[]}
      />,
    );
    expect(screen.getByTestId('sessions-row-meta-icon-pr-42').textContent).toBe('#42');
  });

  it('does not render a PR glyph when detectedPrs is empty', () => {
    render(<SessionRowMetaIcons detectedPrs={NO_PRS} tags={[]} />);
    expect(screen.queryByTestId('sessions-row-meta-icon-pr-42')).toBeNull();
  });

  it('caps inline chips at 2 for 4 detected PRs and keeps the overflow indicator out of the cluster', () => {
    const fourPrs: DetectedPr[] = [
      { number: 1, url: 'https://github.com/org/r/pull/1', owner: 'org', repo: 'r', source: 'created' },
      { number: 2, url: 'https://github.com/org/r/pull/2', owner: 'org', repo: 'r', source: 'created' },
      { number: 3, url: 'https://github.com/org/r/pull/3', owner: 'org', repo: 'r', source: 'mentioned' },
      { number: 4, url: 'https://github.com/org/r/pull/4', owner: 'org', repo: 'r', source: 'mentioned' },
    ];
    render(<SessionRowMetaIcons detectedPrs={fourPrs} tags={[]} />);

    const cluster = screen.getByTestId('sessions-row-meta-icons');
    expect(cluster.querySelectorAll('[data-testid^="sessions-row-meta-icon-pr-"]')).toHaveLength(2);
    expect(cluster.querySelector('[data-testid="sessions-row-pr-overflow"]')).toBeNull();
  });
});

describe('SessionRowMetaIcons — the shared yield contract', () => {
  it('carries the imported SESSION_ROW_META_CLUSTER class list', () => {
    render(<SessionRowMetaIcons detectedPrs={NO_PRS} tags={['a']} colorOf={() => 'blue'} />);
    expect(screen.getByTestId('sessions-row-meta-icons').className).toBe(SESSION_ROW_META_CLUSTER);
  });

  it('shrinks with the row (min-w-0, no flex-shrink-0)', () => {
    render(<SessionRowMetaIcons detectedPrs={NO_PRS} tags={['a']} colorOf={() => 'blue'} />);
    const cluster = screen.getByTestId('sessions-row-meta-icons');
    expect(cluster.className).toContain('min-w-0');
    expect(cluster.className).not.toContain('flex-shrink-0');
  });
});

describe('SessionRowMetaIcons — tag dots, capped at 3', () => {
  const colorOf = () => 'blue' as const;

  it('renders one dot per tag when 3 or fewer', () => {
    render(<SessionRowMetaIcons detectedPrs={NO_PRS} tags={['a', 'b']} colorOf={colorOf} />);
    const cluster = screen.getByTestId('sessions-row-meta-icon-tag-dots');
    expect(cluster.children.length).toBe(2);
  });

  it('caps at 3 dots when more than 3 tags are present', () => {
    render(<SessionRowMetaIcons detectedPrs={NO_PRS} tags={['a', 'b', 'c', 'd']} colorOf={colorOf} />);
    const cluster = screen.getByTestId('sessions-row-meta-icon-tag-dots');
    expect(cluster.children.length).toBe(3);
    expect(screen.queryByTestId('sessions-row-meta-icon-tag-dot-d')).toBeNull();
  });

  it('does not render tag dots when colorOf is not provided', () => {
    render(<SessionRowMetaIcons detectedPrs={NO_PRS} tags={['a']} />);
    expect(screen.queryByTestId('sessions-row-meta-icon-tag-dots')).toBeNull();
  });
});
