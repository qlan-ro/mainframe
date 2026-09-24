/**
 * WelcomeProjectPicker — trigger label, picker entries and the "Resolved
 * default" tag (todo #346).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let __threadItems: Array<{ id: string; status: string; custom?: { projectId: string; updatedAt: number } }> = [];
let __projects: Array<{ id: string; name: string }> = [
  { id: 'proj-a', name: 'Mainframe' },
  { id: 'proj-b', name: 'Sidecar' },
];

vi.mock('../../use-projects', () => ({ useProjects: () => ({ projects: __projects }) }));
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: { threads: { threadItems: typeof __threadItems } }) => unknown) =>
    sel({ threads: { threadItems: __threadItems } }),
}));

import { WelcomeProjectPicker } from '../WelcomeProjectPicker';

const openPicker = () => fireEvent.pointerDown(screen.getByTestId('welcome-project'), { button: 0 });

beforeEach(() => {
  __threadItems = [];
  __projects = [
    { id: 'proj-a', name: 'Mainframe' },
    { id: 'proj-b', name: 'Sidecar' },
  ];
});

describe('WelcomeProjectPicker — trigger label', () => {
  it('reads "Choose a project" while unresolved (projectId undefined)', () => {
    render(<WelcomeProjectPicker projectId={undefined} onSelect={vi.fn()} />);
    expect(screen.getByTestId('welcome-project')).toHaveTextContent('Choose a project');
  });

  it('shows the project chip once a project is picked', () => {
    render(<WelcomeProjectPicker projectId="proj-a" onSelect={vi.fn()} />);
    expect(screen.getByTestId('welcome-project')).toHaveTextContent('Mainframe');
  });

  it('reads "No project" once explicitly chosen (projectId null)', () => {
    render(<WelcomeProjectPicker projectId={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId('welcome-project')).toHaveTextContent('No project');
  });
});

describe('WelcomeProjectPicker — picker entries', () => {
  it('lists every project plus a trailing "No project" entry', () => {
    render(<WelcomeProjectPicker projectId={undefined} onSelect={vi.fn()} />);
    openPicker();

    expect(screen.getByTestId('welcome-project-picker')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-project-proj-a')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-project-proj-b')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-project-picker-no-project')).toHaveTextContent('No project');
  });

  it('calls onSelect(projectId) for a project row and onSelect(null) for the no-project row', () => {
    const onSelect = vi.fn();
    render(<WelcomeProjectPicker projectId={undefined} onSelect={onSelect} />);
    openPicker();

    fireEvent.click(screen.getByTestId('welcome-project-proj-b'));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('proj-b');

    onSelect.mockClear();
    openPicker();
    fireEvent.click(screen.getByTestId('welcome-project-picker-no-project'));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(null);
  });
});

describe('WelcomeProjectPicker — "Resolved default" tag', () => {
  it('tags the project the draft first resolved to, and keeps the tag after switching away', () => {
    const { rerender } = render(<WelcomeProjectPicker projectId="proj-a" onSelect={vi.fn()} />);
    openPicker();
    expect(screen.getByTestId('welcome-project-proj-a')).toHaveTextContent('Resolved default');
    expect(screen.getByTestId('welcome-project-proj-b')).not.toHaveTextContent('Resolved default');

    // The user switches the draft to a different project (or "No project") —
    // the tag stays on the ORIGINAL resolved default, not the new choice.
    // The dropdown (uncontrolled, same mounted instance) is already open from
    // above — a second pointerdown on the trigger would toggle it CLOSED.
    rerender(<WelcomeProjectPicker projectId="proj-b" onSelect={vi.fn()} />);
    expect(screen.getByTestId('welcome-project-proj-a')).toHaveTextContent('Resolved default');
    expect(screen.getByTestId('welcome-project-proj-b')).not.toHaveTextContent('Resolved default');
  });

  it('tags nothing when the draft never auto-resolved (started at "Choose a project")', () => {
    render(<WelcomeProjectPicker projectId={undefined} onSelect={vi.fn()} />);
    openPicker();

    expect(screen.getByTestId('welcome-project-proj-a')).not.toHaveTextContent('Resolved default');
    expect(screen.getByTestId('welcome-project-proj-b')).not.toHaveTextContent('Resolved default');
  });

  it('tags nothing when the draft resolved straight to "No project"', () => {
    render(<WelcomeProjectPicker projectId={null} onSelect={vi.fn()} />);
    openPicker();

    expect(screen.getByTestId('welcome-project-proj-a')).not.toHaveTextContent('Resolved default');
    expect(screen.getByTestId('welcome-project-proj-b')).not.toHaveTextContent('Resolved default');
  });
});
