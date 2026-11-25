import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Suggestion } from '@qlan-ro/mainframe-types';

let __suggestions: Suggestion[] = [];
let __suggestionsArg: string | null | undefined;
const setText = vi.fn();

vi.mock('../use-repo-suggestions', () => ({
  useRepoSuggestions: (projectId: string | null) => {
    __suggestionsArg = projectId;
    return { suggestions: __suggestions };
  },
}));
vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ composer: { setText } }),
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

describe('WelcomeState', () => {
  beforeEach(() => {
    __suggestions = [];
    __suggestionsArg = undefined;
    setText.mockReset();
  });

  it('renders the headline', () => {
    render(<WelcomeState projectId="proj-a" />);
    expect(screen.getByTestId('sessions-welcome')).toHaveTextContent('What should we take on?');
  });

  it('leaves the project and branch pickers to the strip above the composer', () => {
    render(<WelcomeState projectId="proj-a" />);
    expect(screen.queryByTestId('welcome-project')).toBeNull();
    expect(screen.queryByTestId('welcome-branch')).toBeNull();
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
    setText.mockReset();
  });

  it('asks the user to choose a project, with no suggestions', () => {
    render(<WelcomeState />);
    expect(screen.getByTestId('sessions-welcome')).toHaveTextContent('Choose a project to get started.');
    expect(screen.queryByText('From the repo')).toBeNull();
  });

  it('asks the repo suggestions for no project', () => {
    render(<WelcomeState />);
    expect(__suggestionsArg).toBeNull();
  });
});

describe('WelcomeState — "No project" explicitly chosen (todo #346)', () => {
  beforeEach(() => {
    __suggestions = [];
    __suggestionsArg = undefined;
    setText.mockReset();
  });

  it('prompts for a task, not "choose a project" — "No project" counts as a choice', () => {
    render(<WelcomeState projectId={null} />);
    expect(screen.getByTestId('sessions-welcome')).toHaveTextContent(
      'Describe a task, or pick a starting point below.',
    );
  });

  it('asks the repo suggestions for no project (null, not a stale project id)', () => {
    render(<WelcomeState projectId={null} />);
    expect(__suggestionsArg).toBeNull();
  });
});
