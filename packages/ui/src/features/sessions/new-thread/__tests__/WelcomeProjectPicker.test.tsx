import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

let __threadItems: Array<{ id: string; status: string; custom?: { projectId: string; updatedAt: number } }> = [];
let __projects: Array<{ id: string; name: string }> = [];

vi.mock('../../use-projects', () => ({ useProjects: () => ({ projects: __projects }) }));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: { threads: { threadItems: typeof __threadItems } }) => unknown) =>
    sel({ threads: { threadItems: __threadItems } }),
}));

import { WelcomeProjectPicker } from '../WelcomeProjectPicker';

const onSelect = vi.fn();

function renderPicker(projectId: string | null | undefined) {
  return render(
    <TooltipProvider>
      <WelcomeProjectPicker projectId={projectId} onSelect={onSelect} />
    </TooltipProvider>,
  );
}

/** Radix menu triggers open on POINTERDOWN, not click. */
const openPicker = () => fireEvent.pointerDown(screen.getByTestId('welcome-project'), { button: 0 });

const orderedPickerIds = () =>
  screen.getAllByTestId(/^welcome-project-proj-/).map((el) => el.getAttribute('data-testid'));

beforeEach(() => {
  onSelect.mockReset();
  __threadItems = [];
  __projects = [
    { id: 'proj-a', name: 'Mainframe' },
    { id: 'proj-b', name: 'Sidecar' },
  ];
});

describe('WelcomeProjectPicker — trigger', () => {
  it('reads "Choose a project" before anything is resolved', () => {
    renderPicker(undefined);
    expect(screen.getByTestId('welcome-project')).toHaveTextContent('Choose a project');
    expect(screen.getByTestId('welcome-project')).toHaveAttribute('aria-label', 'Project: not chosen');
  });

  it('names the picked project', () => {
    renderPicker('proj-a');
    expect(screen.getByTestId('welcome-project')).toHaveTextContent('Mainframe');
    expect(screen.getByTestId('welcome-project')).toHaveAttribute('aria-label', 'Project: Mainframe');
  });

  it('reads "No project" when that was chosen', () => {
    renderPicker(null);
    expect(screen.getByTestId('welcome-project')).toHaveTextContent('No project');
    expect(screen.getByTestId('welcome-project')).toHaveAttribute('aria-label', 'Project: No project');
  });
});

describe('WelcomeProjectPicker — menu', () => {
  it('lists every project', () => {
    renderPicker(undefined);
    openPicker();

    expect(screen.getByTestId('welcome-project-proj-a')).toHaveTextContent('Mainframe');
    expect(screen.getByTestId('welcome-project-proj-b')).toHaveTextContent('Sidecar');
  });

  it('selects the project picked from the menu', () => {
    renderPicker(undefined);
    openPicker();
    fireEvent.click(screen.getByTestId('welcome-project-proj-b'));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('proj-b');
  });

  it('offers "No project" and selects null for it', () => {
    renderPicker('proj-a');
    openPicker();
    fireEvent.click(screen.getByTestId('welcome-project-picker-no-project'));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('checks only the current project', () => {
    const { rerender } = renderPicker('proj-a');
    rerender(
      <TooltipProvider>
        <WelcomeProjectPicker projectId="proj-b" onSelect={onSelect} />
      </TooltipProvider>,
    );
    openPicker();

    expect(screen.getByTestId('welcome-project-proj-a')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('welcome-project-proj-b')).toHaveAttribute('aria-checked', 'true');
  });

  it('tags nothing when no project was ever auto-resolved', () => {
    renderPicker(undefined);
    openPicker();

    expect(screen.queryByText('Resolved default')).toBeNull();
  });
});

describe('WelcomeProjectPicker — ordering', () => {
  it('puts the most-recently-active project first and a session-less project last', () => {
    __projects = [
      { id: 'proj-a', name: 'Mainframe' },
      { id: 'proj-b', name: 'Sidecar' },
      { id: 'proj-c', name: 'Idle' },
    ];
    __threadItems = [
      { id: 'chat-a', status: 'regular', custom: { projectId: 'proj-a', updatedAt: 100 } },
      { id: 'chat-b', status: 'regular', custom: { projectId: 'proj-b', updatedAt: 200 } },
    ];

    renderPicker(undefined);
    openPicker();

    expect(orderedPickerIds()).toEqual(['welcome-project-proj-b', 'welcome-project-proj-a', 'welcome-project-proj-c']);
  });

  it('ranks a project whose only sessions are archived behind one with an older live session', () => {
    __projects = [
      { id: 'proj-archived', name: 'Archived-only' },
      { id: 'proj-live', name: 'Live' },
    ];
    __threadItems = [
      { id: 'chat-archived', status: 'archived', custom: { projectId: 'proj-archived', updatedAt: 999 } },
      { id: 'chat-live', status: 'regular', custom: { projectId: 'proj-live', updatedAt: 50 } },
    ];

    renderPicker(undefined);
    openPicker();

    expect(orderedPickerIds()).toEqual(['welcome-project-proj-live', 'welcome-project-proj-archived']);
  });
});
