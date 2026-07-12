/**
 * RunView — header (name, trigger · time, status pill, Run again, Cancel) +
 * timeline (ts153 wf2-runtime.jsx `WfRunView`, ported onto the real
 * `AutomationRunSummary`/`AutomationTimelineEntry` and fetched via
 * `gateway.getRunTimeline` rather than a pre-nested mock run). Self-
 * sufficient like `AutomationEditor`: reads `runId` from `use-automations-
 * nav` and `runs`/`definitions`/`interactions`/`catalog`/`gateway` from
 * `use-automations-store` directly. TDD: test written first, implemented
 * after.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationRunSummary, AutomationSummary, AutomationTimelineEntry } from '../../contract';
import { createFakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { useAutomationsStore } from '../../data/use-automations-store';
import { RunView } from '../RunView';

vi.mock('@/lib/session-nav', () => ({
  openSessionById: vi.fn(),
}));

const AUTOMATION: AutomationSummary = {
  id: 'auto-1',
  name: 'Ship work',
  scope: 'project',
  projectId: 'proj-1',
  enabled: true,
  definition: {
    triggers: [],
    steps: [
      { id: 'q', kind: 'ask_me', title: 'Link an ADO item?', fields: [] },
      { id: 'create-pr', kind: 'run_action', actionId: 'github.create_pr', params: {} },
    ],
  },
  createdAt: 1,
  updatedAt: 1,
};

function run(overrides: Partial<AutomationRunSummary> = {}): AutomationRunSummary {
  return {
    id: 'run-1',
    automationId: 'auto-1',
    status: 'succeeded',
    trigger: { kind: 'manual' },
    startedAt: Date.now() - 60_000,
    finishedAt: Date.now() - 55_000,
    error: null,
    ...overrides,
  };
}

function setup(overrides: {
  run: AutomationRunSummary;
  timeline: AutomationTimelineEntry[];
  definitions?: AutomationSummary[];
  gatewayOverrides?: Parameters<typeof createFakeGateway>[0];
}) {
  const getRunTimeline = vi.fn().mockResolvedValue(overrides.timeline);
  useAutomationsStore.setState({
    definitions: overrides.definitions ?? [AUTOMATION],
    runs: [overrides.run],
    interactions: [],
    catalog: [],
    gateway: createFakeGateway({ getRunTimeline, ...overrides.gatewayOverrides }),
  });
  useAutomationsNav.setState({ runId: overrides.run.id, editorTarget: null });
  return { getRunTimeline };
}

beforeEach(() => {
  useAutomationsNav.setState({ open: true, runId: null, editorTarget: null });
  useAutomationsStore.setState({ definitions: [], runs: [], interactions: [], catalog: [] });
});

describe('RunView — header', () => {
  it('shows the automation name and the run status', async () => {
    setup({ run: run({ status: 'succeeded' }), timeline: [] });
    render(<RunView />);
    expect(await screen.findByText('Ship work')).toBeInTheDocument();
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
  });

  it('shows Cancel only while running or waiting', async () => {
    setup({ run: run({ status: 'running', finishedAt: null }), timeline: [] });
    render(<RunView />);
    await screen.findByText('Ship work');
    expect(screen.getByTestId('automations-run-cancel')).toBeInTheDocument();
  });

  it('hides Cancel once the run has finished', async () => {
    setup({ run: run({ status: 'succeeded' }), timeline: [] });
    render(<RunView />);
    await screen.findByText('Ship work');
    expect(screen.queryByTestId('automations-run-cancel')).not.toBeInTheDocument();
  });

  it('Run again starts a fresh run and navigates to it', async () => {
    const user = userEvent.setup();
    const newRun = run({ id: 'run-2', status: 'running', finishedAt: null });
    const startRun = vi.fn().mockResolvedValue(newRun);
    setup({ run: run({ status: 'succeeded' }), timeline: [], gatewayOverrides: { startRun } });
    render(<RunView />);
    await screen.findByText('Ship work');

    await user.click(screen.getByTestId('automations-run-again'));
    expect(startRun).toHaveBeenCalledWith('auto-1');
    await waitFor(() => expect(useAutomationsNav.getState().runId).toBe('run-2'));
  });

  it('Cancel calls gateway.cancelRun and refreshes the run status', async () => {
    const user = userEvent.setup();
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    const getRun = vi.fn().mockResolvedValue(run({ status: 'cancelled', finishedAt: Date.now() }));
    setup({ run: run({ status: 'running', finishedAt: null }), timeline: [], gatewayOverrides: { cancelRun, getRun } });
    render(<RunView />);
    await screen.findByText('Ship work');

    await user.click(screen.getByTestId('automations-run-cancel'));
    expect(cancelRun).toHaveBeenCalledWith('run-1');
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });
});

describe('RunView — live updates', () => {
  it('refetches the timeline when the open run is patched with a new status (e.g. a live automation.run.updated WS event)', async () => {
    const { getRunTimeline } = setup({ run: run({ status: 'running', finishedAt: null }), timeline: [] });
    render(<RunView />);
    await screen.findByText('Ship work');
    expect(getRunTimeline).toHaveBeenCalledTimes(1);

    useAutomationsStore.getState().patchRun(run({ status: 'succeeded', finishedAt: Date.now() }));

    await waitFor(() => expect(getRunTimeline).toHaveBeenCalledTimes(2));
  });

  it('does not refetch the timeline on a re-render that leaves the run status unchanged', async () => {
    const { getRunTimeline } = setup({ run: run({ status: 'running', finishedAt: null }), timeline: [] });
    render(<RunView />);
    await screen.findByText('Ship work');
    expect(getRunTimeline).toHaveBeenCalledTimes(1);

    useAutomationsStore.getState().patchRun(run({ status: 'running', finishedAt: null }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getRunTimeline).toHaveBeenCalledTimes(1);
  });
});

describe('RunView — not found', () => {
  it('renders a not-found state instead of crashing when the run id is unknown', () => {
    useAutomationsStore.setState({ definitions: [AUTOMATION], runs: [], interactions: [], catalog: [] });
    useAutomationsNav.setState({ runId: 'missing-run', editorTarget: null });
    render(<RunView />);
    expect(screen.getByTestId('automations-run-not-found')).toBeInTheDocument();
  });
});

describe('RunView — timeline states', () => {
  it('renders a top-level row per timeline entry, across every status', async () => {
    const timeline: AutomationTimelineEntry[] = [
      { stepRef: 'q', stepId: 'q', kind: 'ask_me', status: 'succeeded', outputPreview: 'Create new' },
      { stepRef: 'create-pr', stepId: 'create-pr', kind: 'run_action', status: 'skipped' },
    ];
    setup({ run: run({ status: 'succeeded' }), timeline });
    render(<RunView />);
    expect(await screen.findByTestId('automations-run-step-q')).toBeInTheDocument();
    expect(screen.getByTestId('automations-run-step-create-pr')).toBeInTheDocument();
  });

  it.each(['waiting', 'running', 'failed', 'cancelled'] as const)(
    'renders a %s run without crashing',
    async (status) => {
      useAutomationsStore.setState({ definitions: [AUTOMATION], runs: [], interactions: [], catalog: [] });
      const timeline: AutomationTimelineEntry[] = [{ stepRef: 'q', stepId: 'q', kind: 'ask_me', status: 'waiting' }];
      const finishedAt = status === 'running' || status === 'waiting' ? null : Date.now();
      setup({ run: run({ id: `run-${status}`, status, finishedAt }), timeline });
      render(<RunView />);
      expect(await screen.findByTestId('automations-run-step-q')).toBeInTheDocument();
    },
  );
});

describe('RunView — repeat fan-out', () => {
  it('nests fan-out rows under the top-level repeat entry', async () => {
    const sweepAutomation: AutomationSummary = {
      ...AUTOMATION,
      id: 'auto-sweep',
      definition: {
        triggers: [],
        steps: [
          { id: 'list-open-prs', kind: 'run_action', actionId: 'github.list_prs', params: {} },
          {
            id: 'repeat-prs',
            kind: 'repeat',
            items: { stepId: 'list-open-prs', output: 'prs' },
            steps: [{ id: 'ask-review-pr', kind: 'ask_agent', prompt: [] }],
          },
        ],
      },
    };
    const timeline: AutomationTimelineEntry[] = [
      { stepRef: 'list-open-prs', stepId: 'list-open-prs', kind: 'run_action', status: 'succeeded' },
      { stepRef: 'repeat-prs', stepId: 'repeat-prs', kind: 'repeat', status: 'running' },
      { stepRef: 'ask-review-pr#1', stepId: 'ask-review-pr', kind: 'ask_agent', status: 'succeeded' },
      { stepRef: 'ask-review-pr#2', stepId: 'ask-review-pr', kind: 'ask_agent', status: 'running' },
    ];
    setup({
      run: run({ id: 'run-sweep', automationId: 'auto-sweep', status: 'running', finishedAt: null }),
      timeline,
      definitions: [sweepAutomation],
    });
    render(<RunView />);

    expect(await screen.findByTestId('automations-run-step-repeat-prs')).toBeInTheDocument();
    expect(screen.getByTestId('automations-run-step-ask-review-pr#1')).toBeInTheDocument();
    expect(screen.getByTestId('automations-run-step-ask-review-pr#2')).toBeInTheDocument();
  });
});

describe('RunView — kept going', () => {
  it('shows the Kept-going badge on a failed step whose definition has keepGoing: true', async () => {
    const spikeAutomation: AutomationSummary = {
      ...AUTOMATION,
      id: 'auto-spike',
      definition: {
        triggers: [],
        steps: [{ id: 'notify-skip', kind: 'notify', message: [], keepGoing: true }],
      },
    };
    const timeline: AutomationTimelineEntry[] = [
      { stepRef: 'notify-skip', stepId: 'notify-skip', kind: 'notify', status: 'failed', error: 'push service down' },
    ];
    setup({
      run: run({ id: 'run-spike', automationId: 'auto-spike', status: 'succeeded' }),
      timeline,
      definitions: [spikeAutomation],
    });
    render(<RunView />);

    expect(await screen.findByTestId('automations-run-step-notify-skip-kept-going')).toHaveTextContent('Kept going');
  });
});
