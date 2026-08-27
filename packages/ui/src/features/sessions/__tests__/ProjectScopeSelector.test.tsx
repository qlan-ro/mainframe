/**
 * ProjectScopeSelector — the header dropdown that replaced the inline
 * projects list.
 *
 * Strategy: render the real component inside a `SidebarProvider` (it mounts
 * the `TooltipProvider` the `Hint` and `SidebarMenuButton` tooltip need, and
 * `SidebarMenuButton` throws outside `useSidebar()`). The menu only mounts its
 * content once opened, so every menu-content assertion first clicks the real
 * trigger via `userEvent` — there is no `open`/`defaultOpen` prop to bypass it.
 * The hover-gated clear/remove affordances are asserted via `fireEvent.pointerDown`
 * (the exact event their handlers listen for) rather than `userEvent.click`,
 * since jsdom never loads the Tailwind stylesheet that hover-gates them —
 * behavior over styling is the contract here, not a jsdom quirk workaround.
 *
 * Behaviors covered:
 *  1. Trigger label: empty scope → "All projects"; one project → its name;
 *     two projects → "2 projects".
 *  2. Trigger hidden-attention badge: sum of attention OUTSIDE the scope;
 *     absent when the scope is empty.
 *  3. Trigger clear affordance: absent when unscoped, present when scoped;
 *     pointerdown calls onClear once and does not open the menu.
 *  4. Opening the menu: "All projects" checked iff the scope is empty; each
 *     project item checked iff in scope; per-item attention badge; the
 *     unavailable badge for available: false.
 *  5. Clicking a project item calls onToggle(id) and leaves the menu open.
 *  6. Clicking "All projects" calls onClear.
 *  7. The remove affordance: pointerdown calls onRemoveProject(project), never
 *     onToggle; absent when onRemoveProject is omitted.
 *  8. Add project: the standalone button and the menu item both call
 *     onAddProject; neither renders when onAddProject is omitted.
 */
import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@qlan-ro/mainframe-types';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ProjectScopeSelector } from '../ProjectScopeSelector';

type ProjectScopeSelectorProps = ComponentProps<typeof ProjectScopeSelector>;

const PROJECT_A: Project = {
  id: 'proj-a',
  name: 'Alpha',
  path: '/repos/alpha',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
};
const PROJECT_B: Project = {
  id: 'proj-b',
  name: 'Beta',
  path: '/repos/beta',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
  available: false,
};
const PROJECTS = [PROJECT_A, PROJECT_B];

function renderSelector(overrides: Partial<ProjectScopeSelectorProps> = {}) {
  const props: ProjectScopeSelectorProps = {
    projects: PROJECTS,
    attention: {},
    scope: new Set(),
    onToggle: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(
    <SidebarProvider>
      <ProjectScopeSelector {...props} />
    </SidebarProvider>,
  );
  return props;
}

async function openMenu() {
  await userEvent.click(screen.getByTestId('sidebar-project-scope-trigger'));
}

// ---------------------------------------------------------------------------
// Trigger label
// ---------------------------------------------------------------------------

describe('ProjectScopeSelector — trigger label', () => {
  it('shows "All projects" for an empty scope', () => {
    renderSelector({ scope: new Set() });
    const trigger = screen.getByTestId('sidebar-project-scope-trigger');
    expect(within(trigger).getByText('All projects')).toBeInTheDocument();
  });

  it("shows the sole scoped project's name for a scope of one", () => {
    renderSelector({ scope: new Set(['proj-a']) });
    const trigger = screen.getByTestId('sidebar-project-scope-trigger');
    expect(within(trigger).getByText('Alpha')).toBeInTheDocument();
  });

  it('shows "2 projects" for a scope of two', () => {
    renderSelector({ scope: new Set(['proj-a', 'proj-b']) });
    const trigger = screen.getByTestId('sidebar-project-scope-trigger');
    expect(within(trigger).getByText('2 projects')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Trigger hidden-attention badge
// ---------------------------------------------------------------------------

describe('ProjectScopeSelector — trigger hidden-attention badge', () => {
  it('sums attention outside the scope', () => {
    renderSelector({ scope: new Set(['proj-a']), attention: { 'proj-a': 2, 'proj-b': 3 } });
    expect(screen.getByTestId('sidebar-project-scope-badge')).toHaveTextContent('3');
  });

  it('is absent when the scope is empty', () => {
    renderSelector({ scope: new Set(), attention: { 'proj-a': 2, 'proj-b': 3 } });
    expect(screen.queryByTestId('sidebar-project-scope-badge')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Trigger clear affordance
// ---------------------------------------------------------------------------

describe('ProjectScopeSelector — trigger clear affordance', () => {
  it('is absent when the scope is empty', () => {
    renderSelector({ scope: new Set() });
    expect(screen.queryByTestId('sidebar-project-scope-clear')).toBeNull();
  });

  it('is present when the scope is non-empty', () => {
    renderSelector({ scope: new Set(['proj-a']) });
    expect(screen.getByTestId('sidebar-project-scope-clear')).toBeInTheDocument();
  });

  it('pointerdown calls onClear exactly once and does not open the menu', () => {
    const onClear = vi.fn();
    renderSelector({ scope: new Set(['proj-a']), onClear });

    fireEvent.pointerDown(screen.getByTestId('sidebar-project-scope-clear'));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('sidebar-project-scope-menu')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Opening the menu
// ---------------------------------------------------------------------------

describe('ProjectScopeSelector — opening the menu', () => {
  it('checks "All projects" when the scope is empty', async () => {
    renderSelector({ scope: new Set() });
    await openMenu();
    expect(screen.getByTestId('sidebar-project-all')).toHaveAttribute('data-state', 'checked');
  });

  it('unchecks "All projects" when the scope is non-empty', async () => {
    renderSelector({ scope: new Set(['proj-a']) });
    await openMenu();
    expect(screen.getByTestId('sidebar-project-all')).toHaveAttribute('data-state', 'unchecked');
  });

  it('checks each project item that is in scope and unchecks the rest', async () => {
    renderSelector({ scope: new Set(['proj-a']) });
    await openMenu();
    expect(screen.getByTestId('sidebar-project-proj-a')).toHaveAttribute('data-state', 'checked');
    expect(screen.getByTestId('sidebar-project-proj-b')).toHaveAttribute('data-state', 'unchecked');
  });

  it('shows the per-item attention badge with the count when greater than 0', async () => {
    renderSelector({ attention: { 'proj-a': 5 } });
    await openMenu();
    expect(screen.getByTestId('sidebar-project-badge-proj-a')).toHaveTextContent('5');
    expect(screen.queryByTestId('sidebar-project-badge-proj-b')).toBeNull();
  });

  it('renders the unavailable badge for a project with available: false', async () => {
    renderSelector();
    await openMenu();
    expect(screen.getByTestId('sidebar-project-unavailable-proj-b')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-project-unavailable-proj-a')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Clicking items
// ---------------------------------------------------------------------------

describe('ProjectScopeSelector — clicking a project item', () => {
  it('calls onToggle with the project id and leaves the menu open', async () => {
    const onToggle = vi.fn();
    renderSelector({ onToggle });
    await openMenu();

    await userEvent.click(screen.getByTestId('sidebar-project-proj-a'));

    expect(onToggle).toHaveBeenCalledExactlyOnceWith('proj-a');
    // Still in the document: onSelect is preventDefault'd, so the menu stays open.
    expect(screen.getByTestId('sidebar-project-proj-a')).toBeInTheDocument();
  });
});

describe('ProjectScopeSelector — clicking "All projects"', () => {
  it('calls onClear', async () => {
    const onClear = vi.fn();
    renderSelector({ scope: new Set(['proj-a']), onClear });
    await openMenu();

    await userEvent.click(screen.getByTestId('sidebar-project-all'));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Remove affordance
// ---------------------------------------------------------------------------

describe('ProjectScopeSelector — remove affordance', () => {
  it('pointerdown calls onRemoveProject with the project and not onToggle', async () => {
    const onRemoveProject = vi.fn();
    const onToggle = vi.fn();
    renderSelector({ onRemoveProject, onToggle });
    await openMenu();

    fireEvent.pointerDown(screen.getByTestId('sidebar-project-remove-proj-a'));

    expect(onRemoveProject).toHaveBeenCalledExactlyOnceWith(PROJECT_A);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('is absent when onRemoveProject is omitted', async () => {
    renderSelector({ onRemoveProject: undefined });
    await openMenu();

    expect(screen.queryByTestId('sidebar-project-remove-proj-a')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Add project
// ---------------------------------------------------------------------------

describe('ProjectScopeSelector — add project', () => {
  it('the standalone button calls onAddProject', () => {
    const onAddProject = vi.fn();
    renderSelector({ onAddProject });

    fireEvent.click(screen.getByTestId('sidebar-projects-add'));

    expect(onAddProject).toHaveBeenCalledTimes(1);
  });

  it("the menu's Add project item calls onAddProject", async () => {
    const onAddProject = vi.fn();
    renderSelector({ onAddProject });
    await openMenu();

    await userEvent.click(screen.getByTestId('sidebar-project-scope-add'));

    expect(onAddProject).toHaveBeenCalledTimes(1);
  });

  it('renders neither add affordance when onAddProject is omitted', async () => {
    renderSelector({ onAddProject: undefined });

    expect(screen.queryByTestId('sidebar-projects-add')).toBeNull();

    await openMenu();
    expect(screen.queryByTestId('sidebar-project-scope-add')).toBeNull();
  });
});
