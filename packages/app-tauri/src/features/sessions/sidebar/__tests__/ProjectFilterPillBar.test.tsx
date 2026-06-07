/**
 * ProjectFilterPillBar — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  - With filterProjectId=null, the "All" pill is active (aria-pressed="true");
 *    each project pill is inactive (aria-pressed="false").
 *  - With filterProjectId="p1", the "p1" pill is active and "All" is inactive.
 *  - A badge for project "p1" renders text "3" when attentionCounts.p1 === 3.
 *  - No badge for project "p2" when attentionCounts.p2 === 0.
 *  - Clicking an inactive project pill calls onSelect with that project's id.
 *  - Clicking the "All" pill calls onSelect(null).
 *  - Clicking the currently-active project pill calls onSelect(null) (deselect → All).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@qlan-ro/mainframe-types';
import { ProjectFilterPillBar } from '../ProjectFilterPillBar';

const PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'mainframe',
    path: '/projects/mainframe',
    createdAt: '2024-01-01T00:00:00Z',
    lastOpenedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'p2',
    name: 'glen-hub',
    path: '/projects/glen-hub',
    createdAt: '2024-01-01T00:00:00Z',
    lastOpenedAt: '2024-01-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// 1. filterProjectId=null → All pill active, project pills inactive
// ---------------------------------------------------------------------------

describe('ProjectFilterPillBar — filterProjectId=null: All pill active, projects inactive', () => {
  it('All pill has aria-pressed="true" when filterProjectId is null', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('sessions-filter-pill-all')).toHaveAttribute('aria-pressed', 'true');
  });

  it('p1 pill has aria-pressed="false" when filterProjectId is null', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('sessions-filter-pill-p1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('p2 pill has aria-pressed="false" when filterProjectId is null', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('sessions-filter-pill-p2')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ---------------------------------------------------------------------------
// 2. filterProjectId="p1" → p1 pill active, All pill inactive
// ---------------------------------------------------------------------------

describe('ProjectFilterPillBar — filterProjectId="p1": p1 active, All inactive', () => {
  it('p1 pill has aria-pressed="true" when filterProjectId is "p1"', () => {
    render(
      <ProjectFilterPillBar projects={PROJECTS} filterProjectId="p1" attentionCounts={{}} onSelect={() => undefined} />,
    );
    expect(screen.getByTestId('sessions-filter-pill-p1')).toHaveAttribute('aria-pressed', 'true');
  });

  it('All pill has aria-pressed="false" when filterProjectId is "p1"', () => {
    render(
      <ProjectFilterPillBar projects={PROJECTS} filterProjectId="p1" attentionCounts={{}} onSelect={() => undefined} />,
    );
    expect(screen.getByTestId('sessions-filter-pill-all')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ---------------------------------------------------------------------------
// 3. Attention badge shows "3" for p1 when attentionCounts.p1 === 3
// ---------------------------------------------------------------------------

describe('ProjectFilterPillBar — attention badge renders count text when > 0', () => {
  it('renders "3" in the badge for p1 when attentionCounts.p1 === 3', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{ p1: 3, p2: 0 }}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('sessions-filter-pill-attn-p1').textContent).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// 4. Attention badge absent for p2 when attentionCounts.p2 === 0
// ---------------------------------------------------------------------------

describe('ProjectFilterPillBar — attention badge absent when count is 0', () => {
  it('does not render badge for p2 when attentionCounts.p2 === 0', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{ p1: 3, p2: 0 }}
        onSelect={() => undefined}
      />,
    );
    expect(screen.queryByTestId('sessions-filter-pill-attn-p2')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Clicking an inactive project pill calls onSelect with that project's id
// ---------------------------------------------------------------------------

describe('ProjectFilterPillBar — clicking inactive project pill calls onSelect with its id', () => {
  it('calls onSelect("p2") when the p2 pill is clicked and filterProjectId is null', async () => {
    const handleSelect = vi.fn();
    render(
      <ProjectFilterPillBar projects={PROJECTS} filterProjectId={null} attentionCounts={{}} onSelect={handleSelect} />,
    );
    await userEvent.click(screen.getByTestId('sessions-filter-pill-p2'));
    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith('p2');
  });
});

// ---------------------------------------------------------------------------
// 6. Clicking the All pill calls onSelect(null)
// ---------------------------------------------------------------------------

describe('ProjectFilterPillBar — clicking All pill calls onSelect(null)', () => {
  it('calls onSelect(null) when the All pill is clicked', async () => {
    const handleSelect = vi.fn();
    render(
      <ProjectFilterPillBar projects={PROJECTS} filterProjectId="p1" attentionCounts={{}} onSelect={handleSelect} />,
    );
    await userEvent.click(screen.getByTestId('sessions-filter-pill-all'));
    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// 7. Clicking the active project pill calls onSelect(null) (deselect → All)
// ---------------------------------------------------------------------------

describe('ProjectFilterPillBar — clicking the active project pill deselects (calls onSelect(null))', () => {
  it('calls onSelect(null) when filterProjectId="p1" and p1 pill is clicked', async () => {
    const handleSelect = vi.fn();
    render(
      <ProjectFilterPillBar projects={PROJECTS} filterProjectId="p1" attentionCounts={{}} onSelect={handleSelect} />,
    );
    await userEvent.click(screen.getByTestId('sessions-filter-pill-p1'));
    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// 8. Collapse: with >2 projects, only the first 2 show + a "+N more" toggle that
//    expands/collapses the rest (artboard COLLAPSE_AT = 2).
// ---------------------------------------------------------------------------

const FOUR_PROJECTS: Project[] = [
  ...PROJECTS,
  {
    id: 'p3',
    name: 'football-tracker',
    path: '/projects/football-tracker',
    createdAt: '2024-01-01T00:00:00Z',
    lastOpenedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'p4',
    name: 'docs-site',
    path: '/projects/docs-site',
    createdAt: '2024-01-01T00:00:00Z',
    lastOpenedAt: '2024-01-01T00:00:00Z',
  },
];

describe('ProjectFilterPillBar — collapsible project pills', () => {
  it('shows only the first 2 project pills collapsed, hiding the rest behind "+N more"', () => {
    render(
      <ProjectFilterPillBar
        projects={FOUR_PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('sessions-filter-pill-p1')).toBeTruthy();
    expect(screen.getByTestId('sessions-filter-pill-p2')).toBeTruthy();
    expect(screen.queryByTestId('sessions-filter-pill-p3')).toBeNull();
    expect(screen.queryByTestId('sessions-filter-pill-p4')).toBeNull();
  });

  it('renders a "+2 more" toggle with data-testid="sessions-projects-more" when collapsed', () => {
    render(
      <ProjectFilterPillBar
        projects={FOUR_PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    const more = screen.getByTestId('sessions-projects-more');
    expect(more.textContent).toContain('+2 more');
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands to reveal all project pills and switches to "Less" when the toggle is clicked', async () => {
    render(
      <ProjectFilterPillBar
        projects={FOUR_PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    await userEvent.click(screen.getByTestId('sessions-projects-more'));
    expect(screen.getByTestId('sessions-filter-pill-p3')).toBeTruthy();
    expect(screen.getByTestId('sessions-filter-pill-p4')).toBeTruthy();
    const more = screen.getByTestId('sessions-projects-more');
    expect(more.textContent).toContain('Less');
    expect(more).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses again on a second click of the toggle', async () => {
    render(
      <ProjectFilterPillBar
        projects={FOUR_PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    const toggle = screen.getByTestId('sessions-projects-more');
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(screen.queryByTestId('sessions-filter-pill-p3')).toBeNull();
    expect(screen.getByTestId('sessions-projects-more').textContent).toContain('+2 more');
  });

  it('does not render the toggle when there are 2 or fewer projects', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(screen.queryByTestId('sessions-projects-more')).toBeNull();
  });
});
