/**
 * The list a modal falls back to when its scope resolves to no project.
 *
 * Wrapped in the app-root TooltipProvider the rows' Hint needs — SidebarProvider
 * mounts one in the app, so a bare render would throw.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Project } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectPickList } from '../ProjectPickList';

const PROJECTS: Project[] = [
  { id: 'proj-z', name: 'Zulu', path: '/tmp/z', createdAt: '', lastOpenedAt: '' },
  { id: 'proj-a', name: 'Alpha', path: '/tmp/a', createdAt: '', lastOpenedAt: '' },
];

function renderList(props: Partial<React.ComponentProps<typeof ProjectPickList>> = {}) {
  return render(
    <TooltipProvider>
      <ProjectPickList surface="tasks-board" projects={PROJECTS} filterProjectId={null} onSelect={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

describe('ProjectPickList — ordering', () => {
  it('sorts the sidebar filter first and the rest alphabetically', () => {
    renderList({ filterProjectId: 'proj-z' });

    const names = [...screen.getByTestId('tasks-board-project-pick').querySelectorAll('button')].map(
      (row) => row.textContent,
    );

    expect(names).toEqual(['ZZulu', 'AAlpha']);
  });

  it('drops to alphabetical when the filter names no project', () => {
    renderList();

    const names = [...screen.getByTestId('tasks-board-project-pick').querySelectorAll('button')].map(
      (row) => row.textContent,
    );

    expect(names).toEqual(['AAlpha', 'ZZulu']);
  });
});

describe('ProjectPickList — picking', () => {
  it('reports the chosen project id', () => {
    const onSelect = vi.fn();
    renderList({ onSelect });

    fireEvent.click(screen.getByTestId('tasks-board-project-proj-a'));

    expect(onSelect).toHaveBeenCalledWith('proj-a');
  });
});

describe('ProjectPickList — no projects at all', () => {
  it('says what to do instead of rendering an empty list', () => {
    renderList({ projects: [] });

    const empty = screen.getByTestId('tasks-board-project-pick-empty');
    expect(empty).toHaveTextContent('No projects yet');
    expect(empty).toHaveTextContent('Add a project to start tracking tasks here.');
    expect(screen.queryByTestId('tasks-board-project-pick')).toBeNull();
  });
});
