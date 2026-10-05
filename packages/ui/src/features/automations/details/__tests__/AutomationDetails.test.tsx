/**
 * AutomationDetails — read-only Overview/Runs details view for a library row
 * (todo #233). Self-sufficient like `AutomationEditor`/`RunView`: driven
 * through `use-automations-nav`/`use-automations-store` rather than props.
 * TDD: test written first, implemented after.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationRunSummary, AutomationSummary } from '../../contract';
import { createFakeGateway as fakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { useAutomationsStore } from '../../data/use-automations-store';
import { EMPTY_LIBRARY } from '../../data/library-cache';
import { AutomationDetails } from '../AutomationDetails';
import { AutomationsHeaderSlot } from '../../header-slot';

/** The view's single header row: details portals its crumb, tabs and actions here. */
function WithHeader() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <>
      <div data-testid="automations-header-slot" ref={setSlot} />
      <AutomationsHeaderSlot.Provider value={slot}>
        <AutomationDetails />
      </AutomationsHeaderSlot.Provider>
    </>
  );
}

/** Patches the 'all' scope entry on top of whatever is already there. */
function patchLibrary(patch: { definitions?: AutomationSummary[]; runs?: AutomationRunSummary[] }) {
  useAutomationsStore.setState((s) => ({
    libraries: { ...s.libraries, all: { ...(s.libraries.all ?? EMPTY_LIBRARY), ...patch } },
  }));
}

const AUTOMATION: AutomationSummary = {
  id: 'auto-1',
  name: 'Daily standup',
  description: 'Summarizes yesterday and pings me',
  scope: 'project',
  projectId: 'proj-1',
  enabled: true,
  definition: {
    triggers: [{ id: 't1', kind: 'schedule', schedule: { type: 'daily', at: '08:00' }, onMissed: 'skip' }],
    steps: [{ id: 's1', kind: 'notify', message: ['hi'] }],
  },
  createdAt: 1,
  updatedAt: 1,
};

function run(id: string, startedAt: number): AutomationRunSummary {
  return {
    id,
    automationId: 'auto-1',
    status: 'succeeded',
    trigger: { kind: 'schedule' },
    startedAt,
    finishedAt: startedAt + 5000,
    error: null,
  };
}

function resetStores() {
  useAutomationsNav.setState({ editorTarget: null, runId: null, detailsAutomationId: null });
  useAutomationsStore.setState({ libraries: {}, catalog: [], gateway: fakeGateway() });
  patchLibrary({ definitions: [AUTOMATION], runs: [] });
}

afterEach(() => {
  resetStores();
});

describe('AutomationDetails — not found / not open', () => {
  it('renders nothing when there is no details target', () => {
    resetStores();
    const { container } = render(<AutomationDetails />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a not-found state when the automation id doesn't match a definition", () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'missing' });
    render(<AutomationDetails />);
    expect(screen.getByTestId('automations-details-not-found')).toBeInTheDocument();
  });
});

describe('AutomationDetails — header', () => {
  it('puts the automation name in the view header (no second title row)', () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    render(<WithHeader />);

    expect(screen.getByTestId('automations-header-slot')).toHaveTextContent('Daily standup');
    expect(screen.getByTestId('automations-details')).not.toHaveTextContent('Daily standup');
  });

  it('Edit navigates to the editor for this automation', async () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    const user = userEvent.setup();
    render(<WithHeader />);

    await user.click(screen.getByTestId('automations-details-edit'));
    expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'edit', automationId: 'auto-1' });
  });

  it('"Run now" starts a run via the gateway and opens it', async () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    const newRun = run('run-new', Date.now());
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        startRun: async (id) => {
          expect(id).toBe('auto-1');
          return newRun;
        },
      }),
    );
    const user = userEvent.setup();
    render(<WithHeader />);

    await user.click(screen.getByTestId('automations-details-run'));

    await waitFor(() => {
      expect(useAutomationsNav.getState().runId).toBe('run-new');
    });
  });
});

describe('AutomationDetails — tabs', () => {
  it('lands on Runs even when the automation has never run (its empty state)', () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    render(<WithHeader />);
    expect(screen.getByTestId('automations-details-runs-empty')).toBeInTheDocument();
  });

  it('defaults to Runs when there is run history', () => {
    resetStores();
    patchLibrary({ runs: [run('r1', 1000), run('r2', 500)] });
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    render(<WithHeader />);
    expect(screen.getByTestId('automations-details-runs')).toBeInTheDocument();
  });

  it('switches tabs on click', async () => {
    resetStores();
    patchLibrary({ runs: [run('r1', 1000), run('r2', 500)] });
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    const user = userEvent.setup();
    render(<WithHeader />);

    expect(screen.getByTestId('automations-details-runs')).toBeInTheDocument();
    await user.click(screen.getByTestId('automations-details-tab-overview'));
    expect(screen.getByTestId('automations-details-overview')).toBeInTheDocument();
  });

  it('Overview shows the trigger and step recipe summary', async () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    render(<WithHeader />);
    await userEvent.setup().click(screen.getByTestId('automations-details-tab-overview'));
    const overview = screen.getByTestId('automations-details-overview');
    expect(overview).toHaveTextContent('Every day at 08:00');
    expect(overview).toHaveTextContent('Notify me');
  });

  it('Runs lists every run for this automation, newest first, and opens one on click', async () => {
    resetStores();
    patchLibrary({ runs: [run('r-old', 500), run('r-new', 1500)] });
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    const user = userEvent.setup();
    render(<WithHeader />);

    const rows = screen.getAllByTestId(/automations-details-run-r-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'automations-details-run-r-new',
      'automations-details-run-r-old',
    ]);

    await user.click(screen.getByTestId('automations-details-run-r-old'));
    expect(useAutomationsNav.getState().runId).toBe('r-old');
  });
});
