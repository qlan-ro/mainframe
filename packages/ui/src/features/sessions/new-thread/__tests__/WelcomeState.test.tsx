import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Suggestion } from '@qlan-ro/mainframe-types';

let __suggestions: Suggestion[] = [];
const setText = vi.fn();

vi.mock('../use-repo-suggestions', () => ({ useRepoSuggestions: () => ({ suggestions: __suggestions }) }));
vi.mock('../../use-projects', () => ({ useProjects: () => ({ projects: [{ id: 'proj-a', name: 'Mainframe' }] }) }));
vi.mock('../../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/lib/api/git', () => ({ getGitBranch: vi.fn().mockResolvedValue({ branch: 'main' }) }));
vi.mock('@assistant-ui/react', () => ({ useAui: () => ({ composer: () => ({ setText }) }) }));

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
