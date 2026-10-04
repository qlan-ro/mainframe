/**
 * ScopeStrip — unit tests.
 *
 * D14: the project scope as a row of stacked avatars. Click toggles a project
 * in/out of scope; ⌥-click solos it; right-click offers Remove project; past
 * six avatars the rest collapse into "+N"; "+" calls onAddProject; the
 * ToggleGroup gives roving keyboard focus (←/→, Space).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ScopeStrip } from '../ScopeStrip';

function project(id: string, name: string, over: Partial<Project> = {}): Project {
  return { id, name, path: `/repo/${id}`, createdAt: '', lastOpenedAt: '', ...over };
}

const onToggle = vi.fn();
const onSolo = vi.fn();
const onRemoveProject = vi.fn();
const onAddProject = vi.fn();

function renderStrip(projects: Project[], scope: ReadonlySet<string> = new Set()) {
  return render(
    <TooltipProvider>
      <ScopeStrip
        projects={projects}
        scope={scope}
        onToggle={onToggle}
        onSolo={onSolo}
        onRemoveProject={onRemoveProject}
        onAddProject={onAddProject}
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  onToggle.mockReset();
  onSolo.mockReset();
  onRemoveProject.mockReset();
  onAddProject.mockReset();
});

describe('ScopeStrip — click', () => {
  it('toggles the clicked project in scope', () => {
    renderStrip([project('a', 'Alpha'), project('b', 'Beta')]);
    fireEvent.click(screen.getByTestId('sessions-scope-avatar-a'));
    expect(onToggle).toHaveBeenCalledWith('a');
    expect(onSolo).not.toHaveBeenCalled();
  });

  it('toggles OUT a project already in scope', () => {
    renderStrip([project('a', 'Alpha'), project('b', 'Beta')], new Set(['a']));
    fireEvent.click(screen.getByTestId('sessions-scope-avatar-a'));
    expect(onToggle).toHaveBeenCalledWith('a');
  });
});

describe('ScopeStrip — ⌥-click solos', () => {
  it('calls onSolo, not onToggle, on an option-click', () => {
    renderStrip([project('a', 'Alpha'), project('b', 'Beta')]);
    fireEvent.click(screen.getByTestId('sessions-scope-avatar-b'), { altKey: true });
    expect(onSolo).toHaveBeenCalledWith('b');
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('ScopeStrip — overflow', () => {
  it('shows "+N" past six avatars, and renders only the first six', () => {
    const projects = Array.from({ length: 8 }, (_, i) => project(`p${i}`, `Project ${i}`));
    renderStrip(projects);
    for (let i = 0; i < 6; i++) expect(screen.getByTestId(`sessions-scope-avatar-p${i}`)).toBeInTheDocument();
    expect(screen.queryByTestId('sessions-scope-avatar-p6')).toBeNull();
    expect(screen.getByTestId('sessions-scope-more')).toHaveTextContent('+2');
  });

  it('shows no overflow marker at exactly six', () => {
    const projects = Array.from({ length: 6 }, (_, i) => project(`p${i}`, `Project ${i}`));
    renderStrip(projects);
    expect(screen.queryByTestId('sessions-scope-more')).toBeNull();
  });
});

describe('ScopeStrip — add project', () => {
  it('calls onAddProject from the "+" button, carrying the tour anchor', () => {
    renderStrip([project('a', 'Alpha')]);
    const add = screen.getByTestId('sessions-scope-add');
    expect(add).toHaveAttribute('data-tut', 'add-project');
    fireEvent.click(add);
    expect(onAddProject).toHaveBeenCalledTimes(1);
  });
});

describe('ScopeStrip — right-click', () => {
  // KNOWN PRODUCT BUG (reported, not fixed here — this suite may only touch
  // __tests__): ScopeStrip.tsx's ScopeAvatar wraps `<ContextMenuTrigger
  // asChild>` around `item`, whose root is `<Hint>` → Radix `<Tooltip
  // (Root)>`. Tooltip.Root destructures only its own named props and never
  // spreads `...rest` onto a DOM node (@radix-ui/react-tooltip's `Tooltip`),
  // so the context menu's `onContextMenu`/`onPointerDown` handlers — merged
  // onto that `<Tooltip>` element by Slot's asChild cloning — are silently
  // dropped before they ever reach the rendered `<button>`. Right-clicking an
  // avatar never opens "Remove project" in the running app either. This test
  // pins the CONTRACT per the blind-testing protocol and will fail until the
  // trigger wraps the ToggleGroupItem directly (inside the Hint) instead of
  // wrapping the Hint.
  it('opens a context menu offering Remove project, which calls onRemoveProject', () => {
    const alpha = project('a', 'Alpha');
    renderStrip([alpha, project('b', 'Beta')]);
    fireEvent.contextMenu(screen.getByTestId('sessions-scope-avatar-a'));
    const removeItem = screen.getByTestId('sidebar-project-remove-a');
    expect(removeItem).toBeInTheDocument();
    fireEvent.click(removeItem);
    expect(onRemoveProject).toHaveBeenCalledWith(alpha);
  });
});

describe('ScopeStrip — keyboard via ToggleGroup', () => {
  it('moves roving focus with ArrowRight/ArrowLeft across avatars', async () => {
    const user = userEvent.setup();
    renderStrip([project('a', 'Alpha'), project('b', 'Beta'), project('c', 'Gamma')]);

    const first = screen.getByTestId('sessions-scope-avatar-a');
    const second = screen.getByTestId('sessions-scope-avatar-b');
    first.focus();
    expect(document.activeElement).toBe(first);

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(second);

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(first);
  });

  it('toggles the focused avatar on Space', async () => {
    const user = userEvent.setup();
    renderStrip([project('a', 'Alpha'), project('b', 'Beta')]);

    screen.getByTestId('sessions-scope-avatar-a').focus();
    await user.keyboard(' ');

    expect(onToggle).toHaveBeenCalledWith('a');
  });
});
