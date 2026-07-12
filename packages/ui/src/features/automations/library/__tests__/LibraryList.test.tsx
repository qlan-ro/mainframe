/**
 * LibraryList — row list wired to the store, New button, and BlankState with
 * both creation paths when the library is empty. TDD: test written first,
 * component implemented after.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AutomationSummary } from '../../contract';
import { useAutomationsStore } from '../../data/use-automations-store';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { LibraryList } from '../LibraryList';

const AUTOMATION_A: AutomationSummary = {
  id: 'auto-a',
  name: 'Daily standup',
  scope: 'global',
  projectId: null,
  enabled: true,
  definition: { triggers: [], steps: [] },
  createdAt: 1,
  updatedAt: 1,
};

const AUTOMATION_B: AutomationSummary = {
  id: 'auto-b',
  name: 'Ship work',
  scope: 'project',
  projectId: 'proj-1',
  enabled: true,
  definition: { triggers: [], steps: [] },
  createdAt: 2,
  updatedAt: 2,
};

describe('LibraryList', () => {
  beforeEach(() => {
    useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  });

  it('renders a row per definition, keyed by automation id', () => {
    useAutomationsStore.setState({ definitions: [AUTOMATION_A, AUTOMATION_B], runs: [] });
    render(<LibraryList />);

    expect(screen.getByTestId('automations-library-row-auto-a')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-row-auto-b')).toBeInTheDocument();
  });

  it('passes each row its most recent run', () => {
    useAutomationsStore.setState({
      definitions: [AUTOMATION_A],
      runs: [
        {
          id: 'run-old',
          automationId: 'auto-a',
          status: 'failed',
          trigger: { kind: 'manual' },
          startedAt: 1,
          finishedAt: 2,
          error: 'boom',
        },
        {
          id: 'run-new',
          automationId: 'auto-a',
          status: 'succeeded',
          trigger: { kind: 'manual' },
          startedAt: 100,
          finishedAt: 110,
          error: null,
        },
      ],
    });
    render(<LibraryList />);

    expect(screen.getByTestId('automations-library-last-run-auto-a')).toHaveTextContent('Succeeded');
  });

  it('clicking New opens the editor in "new" mode', () => {
    useAutomationsStore.setState({ definitions: [AUTOMATION_A], runs: [] });
    render(<LibraryList />);

    fireEvent.click(screen.getByTestId('automations-library-new'));

    expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'new' });
  });

  it('shows BlankState with both creation paths when there are no definitions', () => {
    useAutomationsStore.setState({ definitions: [], runs: [] });
    render(<LibraryList />);

    expect(screen.queryByTestId('automations-library-new')).not.toBeInTheDocument();
    expect(screen.getByTestId('automations-blank-describe')).toBeInTheDocument();
    expect(screen.getByTestId('automations-blank-build')).toBeInTheDocument();
  });

  it('"Build it" on the blank state opens the editor in "new" mode', () => {
    useAutomationsStore.setState({ definitions: [], runs: [] });
    render(<LibraryList />);

    fireEvent.click(screen.getByTestId('automations-blank-build'));

    expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'new' });
  });

  it('"Describe it" on the blank state is disabled while the describe flow is unshipped', () => {
    useAutomationsStore.setState({ definitions: [], runs: [] });
    render(<LibraryList />);

    const describeButton = screen.getByTestId('automations-blank-describe');
    expect(describeButton).toBeDisabled();

    fireEvent.click(describeButton);
    expect(useAutomationsNav.getState().editorTarget).toBeNull();
  });
});
