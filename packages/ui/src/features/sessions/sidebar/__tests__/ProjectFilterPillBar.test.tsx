/**
 * ProjectFilterPillBar — behavior tests (TDD red phase, 2026-07 rebuild).
 *
 * The horizontal pill-cloud became a vertical one-click switcher list: "All
 * projects" row at top (clears the filter), then one row per project
 * (colored avatar + name + attention badge), collapsible past
 * DEFAULT_VISIBLE_PROJECTS (3) via a "Show N more"/"Show less" toggle, and
 * the "Add project" affordance as a trailing row action. Selecting a project
 * row is a plain single-select switch now — clicking the ALREADY-active row
 * does NOT deselect it (that toggle-to-"All" behavior belonged to the old
 * pill-cloud bar); only the "All projects" row clears the filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@qlan-ro/mainframe-types';
import { useUiPrefs } from '@/store/ui-prefs';
import { ProjectFilterPillBar } from '../ProjectFilterPillBar';

beforeEach(() => {
  useUiPrefs.setState({ collapsedSidebarSections: {} });
});

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

function project(id: string, name: string): Project {
  return { id, name, path: `/projects/${id}`, createdAt: '2024-01-01T00:00:00Z', lastOpenedAt: '2024-01-01T00:00:00Z' };
}

const SEVEN_PROJECTS: Project[] = Array.from({ length: 7 }, (_, i) => project(`p${i + 1}`, `Project ${i + 1}`));

describe('ProjectFilterPillBar — All row active state', () => {
  it('All row has aria-pressed="true" when filterProjectId is null', () => {
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

  it('project rows have aria-pressed="false" when filterProjectId is null', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('sessions-filter-pill-p1')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('sessions-filter-pill-p2')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ProjectFilterPillBar — a project row active state', () => {
  it('the matching project row is active and All is not', () => {
    render(
      <ProjectFilterPillBar projects={PROJECTS} filterProjectId="p1" attentionCounts={{}} onSelect={() => undefined} />,
    );
    expect(screen.getByTestId('sessions-filter-pill-p1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sessions-filter-pill-all')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ProjectFilterPillBar — attention badge', () => {
  it('renders "3" for p1 when attentionCounts.p1 === 3', () => {
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

  it('omits the badge for p2 when attentionCounts.p2 === 0', () => {
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
// Name color convention — mirrors SessionRow's title: full-strength foreground
// is the UNREAD signal only. A project with no unread sessions must render its
// name muted, never black.
// ---------------------------------------------------------------------------

describe('ProjectFilterPillBar — project name color signals unread, not rest state', () => {
  /** p1's name span — the element carrying the color/weight classes. */
  const nameSpan = (): HTMLElement => screen.getByText('mainframe');

  it('renders a project with no unread sessions muted, not foreground', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{ p1: 0, p2: 0 }}
        onSelect={() => undefined}
      />,
    );
    expect(nameSpan().className).toContain('text-muted-foreground');
    expect(nameSpan().className).not.toContain('text-foreground');
  });

  it('renders a project WITH unread sessions bold foreground', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{ p1: 3, p2: 0 }}
        onSelect={() => undefined}
      />,
    );
    expect(nameSpan().className).toContain('text-foreground');
    expect(nameSpan().className).toContain('font-bold');
  });

  it('renders the active project in the selection color, not the unread black', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId="p1"
        attentionCounts={{ p1: 3, p2: 0 }}
        onSelect={() => undefined}
      />,
    );
    expect(nameSpan().className).toContain('text-primary');
    expect(nameSpan().className).not.toContain('font-bold');
  });
});

describe('ProjectFilterPillBar — single-select click semantics', () => {
  it('clicking an inactive project row calls onSelect with its id', async () => {
    const handleSelect = vi.fn();
    render(
      <ProjectFilterPillBar projects={PROJECTS} filterProjectId={null} attentionCounts={{}} onSelect={handleSelect} />,
    );
    await userEvent.click(screen.getByTestId('sessions-filter-pill-p2'));
    expect(handleSelect).toHaveBeenCalledWith('p2');
  });

  it('clicking the All row calls onSelect(null)', async () => {
    const handleSelect = vi.fn();
    render(
      <ProjectFilterPillBar projects={PROJECTS} filterProjectId="p1" attentionCounts={{}} onSelect={handleSelect} />,
    );
    await userEvent.click(screen.getByTestId('sessions-filter-pill-all'));
    expect(handleSelect).toHaveBeenCalledWith(null);
  });

  it('clicking the ALREADY-active project row calls onSelect with its own id again (not null — no toggle-off)', async () => {
    const handleSelect = vi.fn();
    render(
      <ProjectFilterPillBar projects={PROJECTS} filterProjectId="p1" attentionCounts={{}} onSelect={handleSelect} />,
    );
    await userEvent.click(screen.getByTestId('sessions-filter-pill-p1'));
    expect(handleSelect).toHaveBeenCalledWith('p1');
    expect(handleSelect).not.toHaveBeenCalledWith(null);
  });
});

describe('ProjectFilterPillBar — colored avatar', () => {
  it('renders an avatar with the project initial for each project row', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    const avatar = screen.getByTestId('sessions-filter-pill-avatar-p1');
    expect(avatar.textContent).toBe('M');
  });
});

describe('ProjectFilterPillBar — collapsible past 3 projects', () => {
  it('shows only the first 3 project rows by default, hiding the rest', () => {
    render(
      <ProjectFilterPillBar
        projects={SEVEN_PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    for (let i = 1; i <= 3; i++) expect(screen.getByTestId(`sessions-filter-pill-p${i}`)).toBeTruthy();
    for (let i = 4; i <= 7; i++) expect(screen.queryByTestId(`sessions-filter-pill-p${i}`)).toBeNull();
  });

  it('renders a "Show 4 more" toggle when 4 projects are hidden', () => {
    render(
      <ProjectFilterPillBar
        projects={SEVEN_PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    const more = screen.getByTestId('sessions-projects-more');
    expect(more.textContent).toContain('Show 4 more');
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands to reveal all project rows and switches to "Show less" when clicked', async () => {
    render(
      <ProjectFilterPillBar
        projects={SEVEN_PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    await userEvent.click(screen.getByTestId('sessions-projects-more'));
    for (let i = 4; i <= 7; i++) expect(screen.getByTestId(`sessions-filter-pill-p${i}`)).toBeTruthy();
    const more = screen.getByTestId('sessions-projects-more');
    expect(more.textContent).toContain('Show less');
    expect(more).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses again on a second click', async () => {
    render(
      <ProjectFilterPillBar
        projects={SEVEN_PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    const toggle = screen.getByTestId('sessions-projects-more');
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(screen.queryByTestId('sessions-filter-pill-p4')).toBeNull();
  });

  it('does not render the toggle when there are 3 or fewer projects', () => {
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

  it('renders the "Show N more" toggle AFTER the Add project row in DOM order', () => {
    render(
      <ProjectFilterPillBar
        projects={SEVEN_PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
        onAddProject={() => undefined}
      />,
    );
    const addProject = screen.getByTestId('sessions-add-project');
    const more = screen.getByTestId('sessions-projects-more');
    expect(addProject.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ProjectFilterPillBar — Add project row', () => {
  it('renders the Add project row when onAddProject is provided', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
        onAddProject={() => undefined}
      />,
    );
    const row = screen.getByTestId('sessions-add-project');
    expect(row.textContent).toContain('Add project');
  });

  it('does not render the Add project row when onAddProject is omitted', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(screen.queryByTestId('sessions-add-project')).toBeNull();
  });

  it('calls onAddProject when clicked', async () => {
    const handleAdd = vi.fn();
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
        onAddProject={handleAdd}
      />,
    );
    await userEvent.click(screen.getByTestId('sessions-add-project'));
    expect(handleAdd).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectFilterPillBar — right-click project management', () => {
  it('shows a "Right-click for options" hint on hover', async () => {
    const user = userEvent.setup();
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
        onRemoveProject={() => undefined}
      />,
    );
    await user.hover(screen.getByTestId('sessions-filter-pill-p1'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Right-click for options');
  });

  it('opens Remove Project from the right-click menu and calls onRemoveProject with the project', async () => {
    const handleRemove = vi.fn();
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
        onRemoveProject={handleRemove}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('sessions-filter-pill-p1-wrap'));
    expect(screen.getByTestId('sessions-project-rename-p1')).toHaveAttribute('data-disabled');
    await userEvent.click(screen.getByTestId('sessions-project-remove-p1'));
    expect(handleRemove).toHaveBeenCalledWith(PROJECTS[0]);
  });
});

describe('ProjectFilterPillBar — hover-revealed remove button on the project row', () => {
  it('calls onRemoveProject with the project when the hover remove button is clicked', async () => {
    const handleRemove = vi.fn();
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
        onRemoveProject={handleRemove}
      />,
    );
    await userEvent.click(screen.getByTestId('sessions-project-remove-action-p2'));
    expect(handleRemove).toHaveBeenCalledTimes(1);
    expect(handleRemove).toHaveBeenCalledWith(PROJECTS[1]);
  });

  it('does not call onSelect when the hover remove button is clicked (stopPropagation)', async () => {
    const handleSelect = vi.fn();
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={handleSelect}
        onRemoveProject={() => undefined}
      />,
    );
    await userEvent.click(screen.getByTestId('sessions-project-remove-action-p1'));
    expect(handleSelect).not.toHaveBeenCalled();
  });

  it('does not render the hover remove button when onRemoveProject is omitted', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(screen.queryByTestId('sessions-project-remove-action-p1')).toBeNull();
  });
});

describe('ProjectFilterPillBar — collapsible', () => {
  it('renders a chevron next to the "Projects" label', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(document.querySelector('svg.lucide-chevron-down[aria-hidden="true"]')).toBeTruthy();
  });

  it('clicking the toggle hides the "All" row and project rows', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('sessions-filter-pill-all')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sessions-projects-section-toggle'));
    expect(screen.queryByTestId('sessions-filter-pill-all')).toBeNull();
  });

  it('clicking the toggle again shows the section again', () => {
    render(
      <ProjectFilterPillBar
        projects={PROJECTS}
        filterProjectId={null}
        attentionCounts={{}}
        onSelect={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('sessions-projects-section-toggle'));
    fireEvent.click(screen.getByTestId('sessions-projects-section-toggle'));
    expect(screen.getByTestId('sessions-filter-pill-all')).toBeTruthy();
  });
});
