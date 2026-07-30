/**
 * SessionRowMetaIcons — behavior tests.
 *
 * The row's purely decorative trailing glyph cluster (#285 rework): worktree
 * icon (if worktreePath set) + up to 3 small colored tag dots. No PR input
 * lives here — the PR chip/count indicator are a row-level sibling
 * (SessionRowPrRegion), never starved by this cluster. The cluster never
 * shrinks; each child yields independently at its own container-query
 * threshold, present at natural width or entirely absent.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionRowMetaIcons } from '../SessionRowMetaIcons';
import {
  SESSION_ROW_META_CLUSTER,
  SESSION_ROW_WORKTREE_YIELD_CLASS,
  SESSION_ROW_DOT_YIELD_CLASS,
} from '../session-row-layout';

it('renders nothing when worktree/tags are all absent', () => {
  const { container } = render(<SessionRowMetaIcons tags={[]} />);
  expect(container.firstChild).toBeNull();
});

describe('SessionRowMetaIcons — worktree glyph', () => {
  it('renders sessions-row-meta-icon-worktree when worktreePath is set', () => {
    render(<SessionRowMetaIcons worktreePath="/repos/mf/.git/worktrees/feat-x" tags={[]} />);
    expect(screen.getByTestId('sessions-row-meta-icon-worktree')).toBeTruthy();
  });

  it('does not render the worktree glyph when worktreePath is absent', () => {
    render(<SessionRowMetaIcons tags={[]} />);
    expect(screen.queryByTestId('sessions-row-meta-icon-worktree')).toBeNull();
  });

  it('turns the worktree glyph destructive-colored when worktreeMissing=true', () => {
    render(<SessionRowMetaIcons worktreePath="/repos/mf/.git/worktrees/feat-x" worktreeMissing tags={[]} />);
    expect(screen.getByTestId('sessions-row-meta-icon-worktree').className).toContain('text-destructive');
  });

  it('keeps the worktree glyph muted when worktreeMissing is not set', () => {
    render(<SessionRowMetaIcons worktreePath="/repos/mf/.git/worktrees/feat-x" tags={[]} />);
    expect(screen.getByTestId('sessions-row-meta-icon-worktree').className).not.toContain('text-destructive');
  });

  it('carries the worktree yield threshold class, so it hides before the row starves the title', () => {
    render(<SessionRowMetaIcons worktreePath="/repos/mf/.git/worktrees/feat-x" tags={[]} />);
    expect(screen.getByTestId('sessions-row-meta-icon-worktree').className).toContain(SESSION_ROW_WORKTREE_YIELD_CLASS);
  });
});

describe('SessionRowMetaIcons — the shared non-shrinking contract', () => {
  it('carries the imported SESSION_ROW_META_CLUSTER class list', () => {
    render(<SessionRowMetaIcons tags={['a']} colorOf={() => 'blue'} />);
    expect(screen.getByTestId('sessions-row-meta-icons').className).toBe(SESSION_ROW_META_CLUSTER);
  });

  it('never shrinks with the row (flex-shrink-0, no min-w-0)', () => {
    render(<SessionRowMetaIcons tags={['a']} colorOf={() => 'blue'} />);
    const cluster = screen.getByTestId('sessions-row-meta-icons');
    expect(cluster.className).toContain('flex-shrink-0');
    expect(cluster.className).not.toContain('min-w-0');
  });
});

describe('SessionRowMetaIcons — tag dots, capped at 3', () => {
  const colorOf = () => 'blue' as const;

  it('renders one dot per tag when 3 or fewer', () => {
    render(<SessionRowMetaIcons tags={['a', 'b']} colorOf={colorOf} />);
    const cluster = screen.getByTestId('sessions-row-meta-icon-tag-dots');
    expect(cluster.children.length).toBe(2);
  });

  it('caps at 3 dots when more than 3 tags are present', () => {
    render(<SessionRowMetaIcons tags={['a', 'b', 'c', 'd']} colorOf={colorOf} />);
    const cluster = screen.getByTestId('sessions-row-meta-icon-tag-dots');
    expect(cluster.children.length).toBe(3);
    expect(screen.queryByTestId('sessions-row-meta-icon-tag-dot-d')).toBeNull();
  });

  it('does not render tag dots when colorOf is not provided', () => {
    render(<SessionRowMetaIcons tags={['a']} />);
    expect(screen.queryByTestId('sessions-row-meta-icon-tag-dots')).toBeNull();
  });

  it('carries the dot yield threshold class, so dots hide before the worktree glyph does', () => {
    render(<SessionRowMetaIcons tags={['a']} colorOf={colorOf} />);
    expect(screen.getByTestId('sessions-row-meta-icon-tag-dots').className).toContain(SESSION_ROW_DOT_YIELD_CLASS);
  });
});
