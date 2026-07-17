/**
 * SessionMetaCard — behavior tests (TDD red phase).
 *
 * The floating hover-detail card for a compact session row (2026-07 sidebar
 * rebuild): title + time, project (colored dot + name), worktree/branch
 * (monospace), PR number(s), full tag pill list, and a branch-safety warning.
 * Portalled to document.body and positioned from the row's DOMRect.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionMetaCard } from '../SessionMetaCard';

const RECT = { top: 100, left: 50, right: 250, bottom: 120, width: 200, height: 20 } as DOMRect;
const NOW = new Date('2025-06-07T15:00:00Z').getTime();

function baseProps() {
  return {
    anchorRect: RECT,
    title: 'Build the sidebar',
    updatedAt: NOW - 5 * 60_000,
    now: NOW,
    worktreeMissing: false,
    transcriptMissing: false,
    detectedPrs: [],
    tags: [],
  };
}

it('renders the title and a non-empty relative time', () => {
  render(<SessionMetaCard {...baseProps()} />);
  expect(screen.getByTestId('sessions-meta-card-title').textContent).toBe('Build the sidebar');
  expect(screen.getByTestId('sessions-meta-card-time').textContent?.length).toBeGreaterThan(0);
});

describe('SessionMetaCard — project', () => {
  it('renders a "Project" field label and a plain-colored (not tinted) name, with an avatar', () => {
    render(<SessionMetaCard {...baseProps()} projectId="p1" projectName="mainframe" />);
    const project = screen.getByTestId('sessions-meta-card-project');
    expect(project.textContent).toContain('Project');
    expect(project.textContent).toContain('mainframe');
    expect(project.querySelector('[data-testid="project-avatar"]')).not.toBeNull();
    const name = screen.getByText('mainframe');
    expect(name.style.color).toBe('');
    expect(name.className).toContain('text-foreground');
  });

  it('omits the project row when projectName is absent', () => {
    render(<SessionMetaCard {...baseProps()} />);
    expect(screen.queryByTestId('sessions-meta-card-project')).toBeNull();
  });
});

describe('SessionMetaCard — worktree / branch', () => {
  it('renders the worktree basename in monospace when worktreePath is set', () => {
    render(<SessionMetaCard {...baseProps()} worktreePath="/repos/mf/.git/worktrees/feat-x" />);
    const el = screen.getByTestId('sessions-meta-card-worktree');
    expect(el.textContent).toContain('feat-x');
    // The value (not the field label) carries the monospace treatment — the
    // label stays in the regular UI font.
    expect(screen.getByText('feat-x').className).toContain('font-mono');
  });

  it('falls back to branchName when there is no worktreePath', () => {
    render(<SessionMetaCard {...baseProps()} branchName="feat/thing" />);
    expect(screen.getByTestId('sessions-meta-card-worktree').textContent).toContain('feat/thing');
  });

  it('omits the worktree/branch row when neither is set', () => {
    render(<SessionMetaCard {...baseProps()} />);
    expect(screen.queryByTestId('sessions-meta-card-worktree')).toBeNull();
  });
});

it('renders "#42" for a detected PR', () => {
  render(
    <SessionMetaCard
      {...baseProps()}
      detectedPrs={[
        { number: 42, url: 'https://github.com/org/r/pull/42', owner: 'org', repo: 'r', source: 'created' },
      ]}
    />,
  );
  expect(screen.getByTestId('sessions-meta-card-pr').textContent).toContain('#42');
});

describe('SessionMetaCard — tags', () => {
  it('renders a full pill per tag, not just dots', () => {
    render(<SessionMetaCard {...baseProps()} tags={['alpha', 'beta']} colorOf={() => 'blue'} />);
    const wrap = screen.getByTestId('sessions-meta-card-tags');
    expect(wrap.textContent).toContain('Tags');
    expect(wrap.textContent).toContain('alpha');
    expect(wrap.textContent).toContain('beta');
    // Each tag is a solid-colored chip (tinted background + matching text
    // color), not a neutral chip with a separate color dot.
    const chip = screen.getByText('alpha');
    expect(chip.style.backgroundColor).not.toBe('');
    expect(chip.style.color).not.toBe('');
  });

  it('omits the tags row when tags is empty', () => {
    render(<SessionMetaCard {...baseProps()} />);
    expect(screen.queryByTestId('sessions-meta-card-tags')).toBeNull();
  });
});

describe('SessionMetaCard — branch-safety warning', () => {
  it('renders a warning naming the cause when worktreeMissing=true', () => {
    render(<SessionMetaCard {...baseProps()} worktreeMissing={true} />);
    expect(screen.getByTestId('sessions-meta-card-warning').textContent).toContain('Worktree missing');
  });

  it('renders a warning naming the cause when transcriptMissing=true', () => {
    render(<SessionMetaCard {...baseProps()} transcriptMissing={true} />);
    expect(screen.getByTestId('sessions-meta-card-warning').textContent).toContain('Transcript missing');
  });

  it('omits the warning when neither is set', () => {
    render(<SessionMetaCard {...baseProps()} />);
    expect(screen.queryByTestId('sessions-meta-card-warning')).toBeNull();
  });
});

describe('SessionMetaCard — portal + positioning', () => {
  it('renders into document.body (portalled), not the local render container', () => {
    const { container } = render(<SessionMetaCard {...baseProps()} />);
    expect(container.querySelector('[data-testid="sessions-meta-card"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="sessions-meta-card"]')).not.toBeNull();
  });

  it('positions using the anchor rect (fixed, right of the row)', () => {
    render(<SessionMetaCard {...baseProps()} />);
    const card = screen.getByTestId('sessions-meta-card');
    expect(card.style.position).toBe('fixed');
    expect(card.style.top).toBe(`${RECT.top}px`);
  });
});
