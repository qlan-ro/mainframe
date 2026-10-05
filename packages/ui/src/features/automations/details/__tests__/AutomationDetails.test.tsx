/**
 * AutomationDetails — the Automations rail's single per-automation view
 * (todo #233; 2026-10 redesign: no more Runs/Overview tabs — a `RunsColumn`
 * plus the body it drives). Self-sufficient: driven through
 * `use-automations-nav`/`use-automations-store` rather than props.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [{ id: 'proj-1', name: 'Mainframe' }] }),
}));

vi.mock('@/lib/confirm-bridge', () => ({ requestConfirm: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { requestConfirm } from '@/lib/confirm-bridge';

/** The view's single header row: details portals its name and actions here. */
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

function run(
  id: string,
  startedAt: number,
  status: AutomationRunSummary['status'] = 'succeeded',
): AutomationRunSummary {
  return {
    id,
    automationId: 'auto-1',
    status,
    trigger: { kind: 'schedule' },
    startedAt,
    finishedAt: status === 'running' || status === 'waiting' ? null : startedAt + 5000,
    error: null,
  };
}

function resetStores() {
  useAutomationsNav.setState({ editorTarget: null, detailsAutomationId: null, selectedRunId: null });
  useAutomationsStore.setState({ libraries: {}, catalog: [], gateway: fakeGateway() });
  patchLibrary({ definitions: [AUTOMATION], runs: [] });
  vi.mocked(requestConfirm).mockReset();
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

  it("shows the project chip, scoped to the automation's own project", () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    render(<WithHeader />);
    expect(screen.getByTestId('automations-details-project')).toHaveTextContent('Mainframe');
  });

  it('shows "All projects" on the chip for an unscoped automation', () => {
    resetStores();
    patchLibrary({ definitions: [{ ...AUTOMATION, projectId: null }] });
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    render(<WithHeader />);
    expect(screen.getByTestId('automations-details-project')).toHaveTextContent('All projects');
  });

  it('Edit navigates to the editor for this automation, keeping detailsAutomationId set', async () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    const user = userEvent.setup();
    render(<WithHeader />);

    await user.click(screen.getByTestId('automations-details-edit'));
    expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'edit', automationId: 'auto-1' });
    expect(useAutomationsNav.getState().detailsAutomationId).toBe('auto-1');
  });

  it('"Run now" starts a run via the gateway and selects it in the column', async () => {
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
      expect(useAutomationsNav.getState().selectedRunId).toBe('run-new');
    });
  });

  it('toggles enabled/disabled via the Switch', async () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ setEnabled: async (id, enabled) => ({ ...AUTOMATION, id, enabled }) }));
    const user = userEvent.setup();
    render(<WithHeader />);

    await user.click(screen.getByTestId('automations-details-toggle'));
    await waitFor(() => {
      expect(useAutomationsStore.getState().libraries.all?.definitions[0]?.enabled).toBe(false);
    });
  });

  describe('delete', () => {
    it('confirming the dialog deletes the automation and closes details', async () => {
      resetStores();
      useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
      vi.mocked(requestConfirm).mockResolvedValue(true);
      const deleteAutomation = vi.fn().mockResolvedValue(undefined);
      useAutomationsStore.getState().setGateway(fakeGateway({ deleteAutomation }));
      const user = userEvent.setup();
      render(<WithHeader />);

      await user.click(screen.getByTestId('automations-details-delete'));
      await waitFor(() => expect(deleteAutomation).toHaveBeenCalledWith('auto-1'));
      await waitFor(() => expect(useAutomationsNav.getState().detailsAutomationId).toBeNull());
    });

    it('cancelling the dialog leaves the automation and details open', async () => {
      resetStores();
      useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
      vi.mocked(requestConfirm).mockResolvedValue(false);
      const deleteAutomation = vi.fn();
      useAutomationsStore.getState().setGateway(fakeGateway({ deleteAutomation }));
      const user = userEvent.setup();
      render(<WithHeader />);

      await user.click(screen.getByTestId('automations-details-delete'));
      await waitFor(() => expect(requestConfirm).toHaveBeenCalled());
      expect(deleteAutomation).not.toHaveBeenCalled();
      expect(useAutomationsNav.getState().detailsAutomationId).toBe('auto-1');
    });
  });
});

describe('AutomationDetails — runs column + default selection', () => {
  it('lands on Overview when the automation has never run', () => {
    resetStores();
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    render(<WithHeader />);
    expect(screen.getByTestId('automations-details-overview')).toBeInTheDocument();
    expect(screen.getByTestId('automations-runs-empty')).toBeInTheDocument();
  });

  it("defaults to the most recent run's trace, expanded, when there is run history", async () => {
    resetStores();
    patchLibrary({
      runs: [run('r-old', 500, 'succeeded'), run('r-new', 1500, 'succeeded')],
    });
    useAutomationsStore.setState({
      gateway: fakeGateway({
        getRunTimeline: async () => [
          { stepRef: 's1', stepId: 's1', kind: 'notify', status: 'succeeded', outputPreview: 'hi' },
        ],
      }),
    });
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    render(<WithHeader />);

    await waitFor(() => expect(useAutomationsNav.getState().selectedRunId).toBe('r-new'));
    expect(await screen.findByTestId('automations-run-step-s1-output')).toBeInTheDocument();
    expect(screen.getByTestId('automations-runs-row-r-new')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking an older run shows its trace, collapsed by default (not the forced-open latest)', async () => {
    resetStores();
    patchLibrary({ runs: [run('r-old', 500, 'succeeded'), run('r-new', 1500, 'succeeded')] });
    useAutomationsStore.setState({
      gateway: fakeGateway({
        getRunTimeline: async () => [
          { stepRef: 's1', stepId: 's1', kind: 'notify', status: 'succeeded', outputPreview: 'hi' },
        ],
      }),
    });
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    const user = userEvent.setup();
    render(<WithHeader />);

    await waitFor(() => expect(useAutomationsNav.getState().selectedRunId).toBe('r-new'));
    await user.click(screen.getByTestId('automations-runs-row-r-old'));

    await screen.findByTestId('automations-run-step-s1');
    expect(screen.queryByTestId('automations-run-step-s1-output')).not.toBeInTheDocument();
  });

  it('clicking Overview returns to the overview body and stays there across later run patches', async () => {
    resetStores();
    patchLibrary({ runs: [run('r-new', 1500, 'succeeded')] });
    useAutomationsStore.setState({ gateway: fakeGateway({ getRunTimeline: async () => [] }) });
    useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
    const user = userEvent.setup();
    render(<WithHeader />);

    await waitFor(() => expect(useAutomationsNav.getState().selectedRunId).toBe('r-new'));
    await user.click(screen.getByTestId('automations-runs-overview'));

    expect(screen.getByTestId('automations-details-overview')).toBeInTheDocument();
  });
});
