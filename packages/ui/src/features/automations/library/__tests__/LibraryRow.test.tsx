/**
 * LibraryRow — name/description/scope/trigger chips, last-run pill, toggle,
 * Run now, Edit. TDD: test written first, component implemented after.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AutomationRunSummary, AutomationSummary } from '../../contract';
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsStore } from '../../data/use-automations-store';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { LibraryRow } from '../LibraryRow';

const AUTOMATION: AutomationSummary = {
  id: 'auto-1',
  name: 'Daily standup',
  description: 'Summarizes yesterday and pings me',
  scope: 'project',
  projectId: 'proj-1',
  enabled: true,
  definition: {
    triggers: [{ id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '08:00' }, onMissed: 'skip' }],
    steps: [],
  },
  createdAt: 1,
  updatedAt: 1,
};

const RUN: AutomationRunSummary = {
  id: 'run-1',
  automationId: 'auto-1',
  status: 'succeeded',
  trigger: { kind: 'schedule' },
  startedAt: Date.now() - 60_000,
  finishedAt: Date.now() - 55_000,
  error: null,
};

describe('LibraryRow', () => {
  beforeEach(() => {
    useAutomationsStore.setState({ definitions: [AUTOMATION], runs: [], gateway: fakeGateway() });
    useAutomationsNav.setState({ open: true, editorTarget: null, runId: null });
  });

  it('renders name, description, scope badge, and trigger chip', () => {
    render(<LibraryRow automation={AUTOMATION} />);

    const row = screen.getByTestId('automations-library-row-auto-1');
    expect(row).toHaveTextContent('Daily standup');
    expect(row).toHaveTextContent('Summarizes yesterday and pings me');
    expect(row).toHaveTextContent('Project');
    expect(row).toHaveTextContent('Every day at 08:00');
  });

  it('shows the "Global" scope badge for a global automation', () => {
    render(<LibraryRow automation={{ ...AUTOMATION, scope: 'global', projectId: null }} />);
    expect(screen.getByTestId('automations-library-row-auto-1')).toHaveTextContent('Global');
  });

  it('renders a chip per trigger when there are several', () => {
    render(
      <LibraryRow
        automation={{
          ...AUTOMATION,
          definition: {
            ...AUTOMATION.definition,
            triggers: [
              { id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '08:00' }, onMissed: 'skip' },
              { id: 't2', kind: 'event', event: 'session.finished' },
            ],
          },
        }}
      />,
    );
    const row = screen.getByTestId('automations-library-row-auto-1');
    expect(row).toHaveTextContent('Every day at 08:00');
    expect(row).toHaveTextContent('When a chat session finishes');
  });

  it('shows "Never run" when there is no last run', () => {
    render(<LibraryRow automation={AUTOMATION} />);
    expect(screen.getByTestId('automations-library-last-run-auto-1')).toHaveTextContent('Never run');
  });

  it('shows the last run status and opens the run view on click', () => {
    render(<LibraryRow automation={AUTOMATION} lastRun={RUN} />);

    const pill = screen.getByTestId('automations-library-last-run-auto-1');
    expect(pill).toHaveTextContent('Done');

    fireEvent.click(pill);
    expect(useAutomationsNav.getState().runId).toBe('run-1');
  });

  it('toggling the switch calls gateway.setEnabled and patches the definition', async () => {
    const updated: AutomationSummary = { ...AUTOMATION, enabled: false };
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        setEnabled: async (id, enabled) => {
          expect(id).toBe('auto-1');
          expect(enabled).toBe(false);
          return updated;
        },
      }),
    );
    render(<LibraryRow automation={AUTOMATION} />);

    fireEvent.click(screen.getByTestId('automations-library-toggle-auto-1'));

    await waitFor(() => {
      expect(useAutomationsStore.getState().definitions).toEqual([updated]);
    });
  });

  it('"Run now" starts a run via the gateway and opens it', async () => {
    const newRun: AutomationRunSummary = { ...RUN, id: 'run-new', status: 'running' };
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        startRun: async (id) => {
          expect(id).toBe('auto-1');
          return newRun;
        },
      }),
    );
    render(<LibraryRow automation={AUTOMATION} />);

    fireEvent.click(screen.getByTestId('automations-library-run-auto-1'));

    await waitFor(() => {
      expect(useAutomationsNav.getState().runId).toBe('run-new');
    });
    expect(useAutomationsStore.getState().runs).toEqual([newRun]);
  });

  it('Edit navigates to the editor for this automation', () => {
    render(<LibraryRow automation={AUTOMATION} />);

    fireEvent.click(screen.getByTestId('automations-library-edit-auto-1'));

    expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'edit', automationId: 'auto-1' });
  });

  it('keys every interactive testid off the automation id, not an array index', () => {
    render(<LibraryRow automation={{ ...AUTOMATION, id: 'zz-42' }} />);

    expect(screen.getByTestId('automations-library-row-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-run-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-edit-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-toggle-zz-42')).toBeInTheDocument();
    expect(screen.getByTestId('automations-library-last-run-zz-42')).toBeInTheDocument();
  });
});
