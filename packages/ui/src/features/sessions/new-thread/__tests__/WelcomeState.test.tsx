import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Suggestion } from '@qlan-ro/mainframe-types';

let __suggestions: Suggestion[] = [];
let __suggestionsArg: string | null | undefined;
let __threadItems: Array<{ id: string; status: string; custom?: { projectId: string; updatedAt: number } }> = [];
const setText = vi.fn();
const selectProject = vi.fn();

// Shallow: the real popover fires git fetches when open, and its own behavior
// belongs to its own suite. Here we only care that the branch label triggers it.
// The pill carries NO onClick of its own (the real DropdownMenuTrigger owns
// the gesture — pinned by e2e), so the mock exposes onOpenChange for the test
// to drive the wiring through.
vi.mock('@/features/git/BranchPopover', () => ({
  BranchPopover: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    children: ReactNode;
  }) => (
    <div data-testid="branch-popover" data-open={String(open)}>
      <button data-testid="branch-popover-drive" onClick={() => onOpenChange(!open)} />
      {children}
    </div>
  ),
}));

vi.mock('../use-repo-suggestions', () => ({
  useRepoSuggestions: (projectId: string | null) => {
    __suggestionsArg = projectId;
    return { suggestions: __suggestions };
  },
}));
vi.mock('../use-select-draft-project', () => ({ useSelectDraftProject: () => selectProject }));
let __projects: Array<{ id: string; name: string }> = [
  { id: 'proj-a', name: 'Mainframe' },
  { id: 'proj-b', name: 'Sidecar' },
];
vi.mock('../../use-projects', () => ({
  useProjects: () => ({ projects: __projects }),
}));
vi.mock('../../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/lib/api/git', () => ({ getGitBranch: vi.fn().mockResolvedValue({ branch: 'main' }) }));
vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ composer: { setText } }),
  useAuiState: (sel: (s: { threads: { threadItems: typeof __threadItems } }) => unknown) =>
    sel({ threads: { threadItems: __threadItems } }),
}));

import { WelcomeState } from '../WelcomeState';

const S = (over: Partial<Suggestion> = {}): Suggestion => ({
  icon: 'git-compare',
  tint: 'accent',
  title: 'Review the working changes',
  meta: 'git · 3 files',
  prefill: 'Review the changes.',
  ...over,
});

/** Radix menu triggers open on POINTERDOWN, not click. */
const openPicker = () => fireEvent.pointerDown(screen.getByTestId('welcome-project'), { button: 0 });

describe('WelcomeState', () => {
  beforeEach(() => {
    __suggestions = [];
    __suggestionsArg = undefined;
    __projects = [
      { id: 'proj-a', name: 'Mainframe' },
      { id: 'proj-b', name: 'Sidecar' },
    ];
    __threadItems = [];
    setText.mockReset();
    selectProject.mockReset();
  });

  it('renders the headline and the project + branch context line', async () => {
    render(<WelcomeState projectId="proj-a" />);
    expect(screen.getByTestId('sessions-welcome')).toHaveTextContent('What should we take on?');
    expect(screen.getByText('Mainframe')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('main')).toBeInTheDocument());
  });

  it('renders the branch pill as the popover trigger and wires the open state through', async () => {
    render(<WelcomeState projectId="proj-a" />);
    const trigger = await screen.findByTestId('welcome-branch');
    expect(trigger.tagName).toBe('BUTTON');
    expect(screen.getByTestId('branch-popover')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByTestId('branch-popover-drive'));

    expect(screen.getByTestId('branch-popover')).toHaveAttribute('data-open', 'true');
  });

  it('does not render the From the repo section when there are no suggestions', () => {
    render(<WelcomeState projectId="proj-a" />);
    expect(screen.queryByText('From the repo')).toBeNull();
    expect(screen.queryByTestId('sessions-welcome-suggestion-0')).toBeNull();
  });

  it('renders suggestion rows and prefills the composer on click (no auto-send)', () => {
    __suggestions = [S(), S({ title: 'Clean up TODOs', tint: 'amber', prefill: 'Fix TODOs.' })];
    render(<WelcomeState projectId="proj-a" />);
    expect(screen.getByText('From the repo')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sessions-welcome-suggestion-1'));
    expect(setText).toHaveBeenCalledWith('Fix TODOs.');
  });

  it('prompts for a task once a project is picked', () => {
    render(<WelcomeState projectId="proj-a" />);
    expect(screen.getByTestId('sessions-welcome')).toHaveTextContent(
      'Describe a task, or pick a starting point below.',
    );
  });

  it('asks the repo suggestions for the picked project', () => {
    render(<WelcomeState projectId="proj-a" />);
    expect(__suggestionsArg).toBe('proj-a');
  });
});

describe('WelcomeState — no project picked yet', () => {
  beforeEach(() => {
    __suggestions = [];
    __suggestionsArg = undefined;
    __projects = [
      { id: 'proj-a', name: 'Mainframe' },
      { id: 'proj-b', name: 'Sidecar' },
    ];
    __threadItems = [];
    setText.mockReset();
    selectProject.mockReset();
  });

  it('shows the choose-a-project trigger and subtitle', () => {
    render(<WelcomeState />);
    expect(screen.getByTestId('welcome-project')).toHaveTextContent('Choose a project');
    expect(screen.getByTestId('sessions-welcome')).toHaveTextContent('Choose a project to get started.');
  });

  it('renders no branch pill', () => {
    render(<WelcomeState />);
    expect(screen.queryByTestId('welcome-branch')).toBeNull();
    expect(screen.queryByTestId('branch-popover')).toBeNull();
  });

  it('asks the repo suggestions for no project', () => {
    render(<WelcomeState />);
    expect(__suggestionsArg).toBeNull();
  });

  it('lists every project in the picker', () => {
    render(<WelcomeState />);
    openPicker();

    expect(screen.getByTestId('welcome-project-picker')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-project-proj-a')).toHaveTextContent('Mainframe');
    expect(screen.getByTestId('welcome-project-proj-b')).toHaveTextContent('Sidecar');
  });

  it('scopes the draft to the project picked from the menu', () => {
    render(<WelcomeState />);
    openPicker();
    fireEvent.click(screen.getByTestId('welcome-project-proj-b'));

    expect(selectProject).toHaveBeenCalledExactlyOnceWith('proj-b');
  });
});

describe('WelcomeState — "No project" explicitly chosen (todo #346)', () => {
  beforeEach(() => {
    __suggestions = [];
    __suggestionsArg = undefined;
    __projects = [
      { id: 'proj-a', name: 'Mainframe' },
      { id: 'proj-b', name: 'Sidecar' },
    ];
    __threadItems = [];
    setText.mockReset();
    selectProject.mockReset();
  });

  it('reads "No project" on the trigger', () => {
    render(<WelcomeState projectId={null} />);
    expect(screen.getByTestId('welcome-project')).toHaveTextContent('No project');
  });

  it('prompts for a task, not "choose a project" — "No project" counts as a choice', () => {
    render(<WelcomeState projectId={null} />);
    expect(screen.getByTestId('sessions-welcome')).toHaveTextContent(
      'Describe a task, or pick a starting point below.',
    );
  });

  it('renders no branch pill', () => {
    render(<WelcomeState projectId={null} />);
    expect(screen.queryByTestId('welcome-branch')).toBeNull();
  });

  it('asks the repo suggestions for no project (null, not a stale project id)', () => {
    render(<WelcomeState projectId={null} />);
    expect(__suggestionsArg).toBeNull();
  });

  it('offers the no-project entry in the picker and switches to a project from there', () => {
    render(<WelcomeState projectId={null} />);
    openPicker();

    expect(screen.getByTestId('welcome-project-picker-no-project')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('welcome-project-proj-a'));

    expect(selectProject).toHaveBeenCalledExactlyOnceWith('proj-a');
  });

  it('picking "No project" from the picker (on a project-scoped draft) calls select(null)', () => {
    render(<WelcomeState projectId="proj-a" />);
    openPicker();

    fireEvent.click(screen.getByTestId('welcome-project-picker-no-project'));

    expect(selectProject).toHaveBeenCalledExactlyOnceWith(null);
  });
});

describe('WelcomeState — project picker ordering', () => {
  beforeEach(() => {
    __suggestions = [];
    __suggestionsArg = undefined;
    __threadItems = [];
    setText.mockReset();
    selectProject.mockReset();
  });

  const orderedPickerIds = () =>
    screen.getAllByTestId(/^welcome-project-proj-/).map((el) => el.getAttribute('data-testid'));

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

    render(<WelcomeState />);
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

    render(<WelcomeState />);
    openPicker();

    expect(orderedPickerIds()).toEqual(['welcome-project-proj-live', 'welcome-project-proj-archived']);
  });
});
