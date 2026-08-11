import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Suggestion } from '@qlan-ro/mainframe-types';

let __suggestions: Suggestion[] = [];
const setText = vi.fn();

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

vi.mock('../use-repo-suggestions', () => ({ useRepoSuggestions: () => ({ suggestions: __suggestions }) }));
vi.mock('../../use-projects', () => ({ useProjects: () => ({ projects: [{ id: 'proj-a', name: 'Mainframe' }] }) }));
vi.mock('../../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/lib/api/git', () => ({ getGitBranch: vi.fn().mockResolvedValue({ branch: 'main' }) }));
vi.mock('@assistant-ui/react', () => ({ useAui: () => ({ composer: { setText } }) }));

import { WelcomeState } from '../WelcomeState';

const S = (over: Partial<Suggestion> = {}): Suggestion => ({
  icon: 'git-compare',
  tint: 'accent',
  title: 'Review the working changes',
  meta: 'git · 3 files',
  prefill: 'Review the changes.',
  ...over,
});

describe('WelcomeState', () => {
  beforeEach(() => {
    __suggestions = [];
    setText.mockReset();
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
});
