import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Project } from '@qlan-ro/mainframe-types';
import { NewSessionPickerPopover } from '../NewSessionPickerPopover';

const projects: Project[] = [
  { id: 'p1', name: 'Alpha', path: '/a' } as Project,
  { id: 'p2', name: 'Beta', path: '/b' } as Project,
];

function setup() {
  const onPick = vi.fn();
  const onAddProject = vi.fn();
  render(
    <NewSessionPickerPopover
      projects={projects}
      sessionCounts={{ p1: 3, p2: 0 }}
      onPick={onPick}
      onAddProject={onAddProject}
    >
      <button data-testid="sessions-new-button">+</button>
    </NewSessionPickerPopover>,
  );
  return { onPick, onAddProject };
}

describe('NewSessionPickerPopover', () => {
  it('opens on trigger click and lists projects with live session counts', () => {
    setup();
    fireEvent.click(screen.getByTestId('sessions-new-button'));
    expect(screen.getByTestId('sessions-new-picker')).toBeInTheDocument();
    expect(screen.getByTestId('sessions-new-picker-project-p1')).toHaveTextContent('3 sessions');
    expect(screen.getByTestId('sessions-new-picker-project-p2')).toHaveTextContent('no sessions');
  });

  it('calls onPick with the project id when a project row is clicked', () => {
    const { onPick } = setup();
    fireEvent.click(screen.getByTestId('sessions-new-button'));
    fireEvent.click(screen.getByTestId('sessions-new-picker-project-p1'));
    expect(onPick).toHaveBeenCalledWith('p1');
  });

  it('calls onAddProject when the add-project row is clicked', () => {
    const { onAddProject } = setup();
    fireEvent.click(screen.getByTestId('sessions-new-button'));
    fireEvent.click(screen.getByTestId('sessions-new-picker-add-project'));
    expect(onAddProject).toHaveBeenCalledTimes(1);
  });
});
