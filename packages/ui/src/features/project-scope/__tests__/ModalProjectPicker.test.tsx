/**
 * The header chip both sidebar modals share. The testids asserted here are the
 * ones the surface-level scope suites address the picker by, so they are part
 * of the contract rather than an implementation detail.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Project } from '@qlan-ro/mainframe-types';
import { ModalProjectPicker } from '../ModalProjectPicker';

const PROJECTS: Project[] = [
  { id: 'proj-a', name: 'Alpha', path: '/tmp/a', createdAt: '', lastOpenedAt: '' },
  { id: 'proj-b', name: 'Beta', path: '/tmp/b', createdAt: '', lastOpenedAt: '' },
];

/** Radix DropdownMenu opens on pointer events (a real mouse click fires these too). */
function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger);
}

describe('ModalProjectPicker — a project is scoped', () => {
  it('names it in the trigger and selects another from the menu', () => {
    const onSelect = vi.fn();
    render(<ModalProjectPicker surface="tasks-board" projectId="proj-b" projects={PROJECTS} onSelect={onSelect} />);

    expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Beta');

    openMenu(screen.getByTestId('tasks-board-project-picker'));
    expect(screen.getByTestId('tasks-board-project-picker-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-board-project-proj-a'));

    expect(onSelect).toHaveBeenCalledWith('proj-a');
  });
});

describe('ModalProjectPicker — no project is scoped', () => {
  it('asks for one when the surface needs a single project', () => {
    render(<ModalProjectPicker surface="tasks-board" projectId={null} projects={PROJECTS} onSelect={vi.fn()} />);

    expect(screen.getByTestId('tasks-board-project-picker')).toHaveTextContent('Choose a project');
  });

  it('reads as "All projects" where an unscoped view is a real choice', () => {
    const onSelect = vi.fn();
    render(
      <ModalProjectPicker
        surface="automations"
        projectId="proj-a"
        projects={PROJECTS}
        onSelect={onSelect}
        allowAllProjects
      />,
    );

    openMenu(screen.getByTestId('automations-project-picker'));
    fireEvent.click(screen.getByTestId('automations-project-all'));

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('ModalProjectPicker — disabled', () => {
  it('still names the project but does not open', () => {
    render(
      <ModalProjectPicker
        surface="automations"
        projectId="proj-a"
        projects={PROJECTS}
        onSelect={vi.fn()}
        allowAllProjects
        disabled
      />,
    );

    const trigger = screen.getByTestId('automations-project-picker');
    expect(trigger).toHaveTextContent('Alpha');
    expect(trigger).toBeDisabled();

    openMenu(trigger);

    expect(screen.queryByTestId('automations-project-picker-menu')).toBeNull();
  });
});

describe('ModalProjectPicker — the project list has not arrived', () => {
  it('says so instead of opening an empty menu', () => {
    render(<ModalProjectPicker surface="tasks-board" projectId={null} projects={[]} onSelect={vi.fn()} />);

    openMenu(screen.getByTestId('tasks-board-project-picker'));

    expect(screen.getByTestId('tasks-board-project-picker-empty')).toHaveTextContent('No projects yet');
  });
});
