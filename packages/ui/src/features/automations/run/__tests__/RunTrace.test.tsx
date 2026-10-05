/**
 * RunTrace — the step timeline ported off the old full-page `RunView`
 * (2026-10 redesign: `details/RunsColumn` replaced its header/back-button
 * shell). Self-sufficient: resolves `run`/`automation`/`interactions`/
 * `catalog`/`gateway` off the `runId` prop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AutomationRunSummary, AutomationSummary, AutomationTimelineEntry } from '../../contract';
import { createFakeGateway } from '../../data/__tests__/fake-gateway';
import { useAutomationsNav } from '../../data/use-automations-nav';
import { useAutomationsStore } from '../../data/use-automations-store';
import { EMPTY_LIBRARY } from '../../data/library-cache';
import { RunTrace } from '../RunTrace';

function seedLibrary(definitions: AutomationSummary[], runs: AutomationRunSummary[]) {
  useAutomationsStore.setState({ libraries: { all: { ...EMPTY_LIBRARY, definitions, runs } } });
}

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
  seedLibrary(overrides.definitions ?? [AUTOMATION], [overrides.run]);
  useAutomationsStore.setState({
    interactions: [],
    catalog: [],
    gateway: createFakeGateway({ getRunTimeline, ...overrides.gatewayOverrides }),
  });
  return { getRunTimeline };
}

beforeEach(() => {
  useAutomationsNav.setState({ detailsAutomationId: null, selectedRunId: null, editorTarget: null });
  useAutomationsStore.setState({ libraries: {}, interactions: [], catalog: [] });
});

describe('RunTrace — actions', () => {
  it('shows Cancel only while running or waiting', async () => {
    setup({ run: run({ status: 'running', finishedAt: null }), timeline: [] });
    render(<RunTrace runId="run-1" />);
    await screen.findByTestId('automations-run-timeline');
    expect(screen.getByTestId('automations-run-cancel')).toBeInTheDocument();
  });

  it('hides Cancel once the run has finished', async () => {
    setup({ run: run({ status: 'succeeded' }), timeline: [] });
    render(<RunTrace runId="run-1" />);
    await screen.findByTestId('automations-run-timeline');
    expect(screen.queryByTestId('automations-run-cancel')).not.toBeInTheDocument();
  });

  it('Run again starts a fresh run and selects it in the nav store', async () => {
    const user = userEvent.setup();
    const newRun = run({ id: 'run-2', status: 'running', finishedAt: null });
    const startRun = vi.fn().mockResolvedValue(newRun);
    setup({ run: run({ status: 'succeeded' }), timeline: [], gatewayOverrides: { startRun } });
    render(<RunTrace runId="run-1" />);
    await screen.findByTestId('automations-run-timeline');

    await user.click(screen.getByTestId('automations-run-again'));
    expect(startRun).toHaveBeenCalledWith('auto-1');
    await waitFor(() => expect(useAutomationsNav.getState().selectedRunId).toBe('run-2'));
  });

  it('Cancel calls gateway.cancelRun and refreshes the run status', async () => {
    const user = userEvent.setup();
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    const getRun = vi.fn().mockResolvedValue(run({ status: 'cancelled', finishedAt: Date.now() }));
    setup({ run: run({ status: 'running', finishedAt: null }), timeline: [], gatewayOverrides: { cancelRun, getRun } });
    render(<RunTrace runId="run-1" />);
    await screen.findByTestId('automations-run-timeline');

    await user.click(screen.getByTestId('automations-run-cancel'));
    expect(cancelRun).toHaveBeenCalledWith('run-1');
    await waitFor(() => expect(screen.queryByTestId('automations-run-cancel')).not.toBeInTheDocument());
  });
});

describe('RunTrace — live updates', () => {
  it('refetches the timeline when the open run is patched with a new status (e.g. a live automation.run.updated WS event)', async () => {
    const { getRunTimeline } = setup({ run: run({ status: 'running', finishedAt: null }), timeline: [] });
    render(<RunTrace runId="run-1" />);
    await screen.findByTestId('automations-run-timeline');
    expect(getRunTimeline).toHaveBeenCalledTimes(1);

    useAutomationsStore.getState().patchRun(run({ status: 'succeeded', finishedAt: Date.now() }));

    await waitFor(() => expect(getRunTimeline).toHaveBeenCalledTimes(2));
  });
});

describe('RunTrace — not found', () => {
  it('renders a not-found state instead of crashing when the run id is unknown', () => {
    seedLibrary([AUTOMATION], []);
    useAutomationsStore.setState({ interactions: [], catalog: [] });
    render(<RunTrace runId="missing-run" />);
    expect(screen.getByTestId('automations-run-not-found')).toBeInTheDocument();
  });
});

describe('RunTrace — timeline states', () => {
  it('renders a top-level row per timeline entry, across every status', async () => {
    const timeline: AutomationTimelineEntry[] = [
      { stepRef: 'q', stepId: 'q', kind: 'ask_me', status: 'succeeded', outputPreview: 'Create new' },
      { stepRef: 'create-pr', stepId: 'create-pr', kind: 'run_action', status: 'skipped' },
    ];
    setup({ run: run({ status: 'succeeded' }), timeline });
    render(<RunTrace runId="run-1" />);
    expect(await screen.findByTestId('automations-run-step-q')).toBeInTheDocument();
    expect(screen.getByTestId('automations-run-step-create-pr')).toBeInTheDocument();
  });

  it('a step with a disclosure starts collapsed by default (succeeded, no forceOpenDefault)', async () => {
    const timeline: AutomationTimelineEntry[] = [
      { stepRef: 'q', stepId: 'q', kind: 'ask_me', status: 'succeeded', outputPreview: 'Create new' },
    ];
    setup({ run: run({ status: 'succeeded' }), timeline });
    render(<RunTrace runId="run-1" />);
    await screen.findByTestId('automations-run-step-q');
    expect(screen.queryByTestId('automations-run-step-q-output')).not.toBeInTheDocument();
  });

  it("forceOpenDefault starts every step expanded, even a succeeded one — the automation's most recent run", async () => {
    const timeline: AutomationTimelineEntry[] = [
      { stepRef: 'q', stepId: 'q', kind: 'ask_me', status: 'succeeded', outputPreview: 'Create new' },
    ];
    setup({ run: run({ status: 'succeeded' }), timeline });
    render(<RunTrace runId="run-1" forceOpenDefault />);
    await screen.findByTestId('automations-run-step-q');
    expect(screen.getByTestId('automations-run-step-q-output')).toBeInTheDocument();
  });
});

describe('RunTrace — repeat fan-out', () => {
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
    render(<RunTrace runId="run-sweep" />);

    expect(await screen.findByTestId('automations-run-step-repeat-prs')).toBeInTheDocument();
    expect(screen.getByTestId('automations-run-step-ask-review-pr#1')).toBeInTheDocument();
    expect(screen.getByTestId('automations-run-step-ask-review-pr#2')).toBeInTheDocument();
  });
});
