/**
 * WfRunsList — status filter chips, group rendering, row click.
 *
 * WfStatus is mocked to avoid the Loader2 reference error that a parallel
 * agent introduced (missing import in WfStatus.tsx). Our tests verify our
 * markup — WfStatus.tsx visual correctness is tested in WfStatus.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkflowRunSummary, WorkflowSummary } from '@qlan-ro/mainframe-types';

import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { WfRunsList } from '@/features/workflows/WfRunsList';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/features/workflows/WfStatus', () => ({
  WfStatusTag: ({ status }: { status: string }) => <span data-testid={`mock-status-tag-${status}`}>{status}</span>,
  WfStatusPip: ({ status }: { status: string }) => <span data-testid={`mock-status-pip-${status}`} />,
}));

// ── Fixtures ────────────────────────────────────────────────────────────────────

const wf: WorkflowSummary = {
  id: 'global:hello',
  name: 'Hello World',
  projectId: null,
  filePath: '/workflows/hello.yml',
  triggers: [],
};

function makeRun(
  id: string,
  status: WorkflowRunSummary['status'],
  extra?: Partial<WorkflowRunSummary>,
): WorkflowRunSummary {
  return {
    id,
    workflowId: 'global:hello',
    status,
    triggerKind: 'manual',
    parentRunId: null,
    startedAt: Date.now() - 60_000,
    finishedAt: status === 'running' || status === 'waiting' ? null : Date.now() - 1_000,
    error: status === 'failed' ? 'Something went wrong' : null,
    outputs: null,
    ...extra,
  };
}

const runRunning = makeRun('r-running', 'running');
const runWaiting = makeRun('r-waiting', 'waiting');
const runSucceeded = makeRun('r-succeeded', 'succeeded');
const runFailed = makeRun('r-failed', 'failed');
const runCancelled = makeRun('r-cancelled', 'cancelled');
const runChild = makeRun('r-child', 'succeeded', { parentRunId: 'r-running' });

function seedStore(runs: WorkflowRunSummary[], workflows: WorkflowSummary[] = [wf]) {
  useWorkflowsStore.setState({
    workflows,
    runs,
    interactions: [],
    runDetail: null,
    loading: false,
    error: null,
  });
  useWorkflowsModal.setState({
    open: true,
    section: 'runs',
    selectedRunId: null,
    editorTarget: null,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('WfRunsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "Active & waiting" group for running and waiting runs', () => {
    seedStore([runRunning, runWaiting]);
    render(<WfRunsList port={31415} />);

    expect(screen.getByText('Active & waiting')).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runRunning.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runWaiting.id}`)).toBeInTheDocument();
  });

  it('renders the "Recent" group for succeeded, failed, cancelled runs', () => {
    seedStore([runSucceeded, runFailed, runCancelled]);
    render(<WfRunsList port={31415} />);

    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runSucceeded.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runFailed.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runCancelled.id}`)).toBeInTheDocument();
  });

  it('renders both groups when there are live and recent runs', () => {
    seedStore([runRunning, runSucceeded, runFailed]);
    render(<WfRunsList port={31415} />);

    expect(screen.getByText('Active & waiting')).toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
  });

  it('shows workflow name inside each row', () => {
    seedStore([runRunning]);
    render(<WfRunsList port={31415} />);

    const row = screen.getByTestId(`workflows-run-row-${runRunning.id}`);
    expect(row.textContent).toContain('Hello World');
  });

  it('shows #runId inside each row', () => {
    seedStore([runRunning]);
    render(<WfRunsList port={31415} />);

    const row = screen.getByTestId(`workflows-run-row-${runRunning.id}`);
    expect(row.textContent).toContain(`#${runRunning.id}`);
  });

  it('shows a "child" tag when parentRunId is set', () => {
    seedStore([runChild]);
    render(<WfRunsList port={31415} />);

    const row = screen.getByTestId(`workflows-run-row-${runChild.id}`);
    expect(row.textContent).toContain('child');
  });

  it('filter chip "Running" narrows to only running rows', () => {
    seedStore([runRunning, runWaiting, runSucceeded]);
    render(<WfRunsList port={31415} />);

    fireEvent.click(screen.getByTestId('workflows-runs-filter-running'));

    expect(screen.getByTestId(`workflows-run-row-${runRunning.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`workflows-run-row-${runWaiting.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`workflows-run-row-${runSucceeded.id}`)).not.toBeInTheDocument();
  });

  it('filter chip "Waiting" shows only waiting rows', () => {
    seedStore([runRunning, runWaiting]);
    render(<WfRunsList port={31415} />);

    fireEvent.click(screen.getByTestId('workflows-runs-filter-waiting'));

    expect(screen.queryByTestId(`workflows-run-row-${runRunning.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runWaiting.id}`)).toBeInTheDocument();
  });

  it('filter chip "Failed" shows only failed rows', () => {
    seedStore([runRunning, runFailed, runSucceeded]);
    render(<WfRunsList port={31415} />);

    fireEvent.click(screen.getByTestId('workflows-runs-filter-failed'));

    expect(screen.queryByTestId(`workflows-run-row-${runRunning.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runFailed.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`workflows-run-row-${runSucceeded.id}`)).not.toBeInTheDocument();
  });

  it('filter chip "Done" shows only succeeded rows', () => {
    seedStore([runRunning, runFailed, runSucceeded]);
    render(<WfRunsList port={31415} />);

    fireEvent.click(screen.getByTestId('workflows-runs-filter-succeeded'));

    expect(screen.queryByTestId(`workflows-run-row-${runRunning.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`workflows-run-row-${runFailed.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runSucceeded.id}`)).toBeInTheDocument();
  });

  it('filter chip "All" is the default and shows everything', () => {
    seedStore([runRunning, runSucceeded, runFailed]);
    render(<WfRunsList port={31415} />);

    const allChip = screen.getByTestId('workflows-runs-filter-all');
    expect(allChip).toBeInTheDocument();

    expect(screen.getByTestId(`workflows-run-row-${runRunning.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runSucceeded.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-run-row-${runFailed.id}`)).toBeInTheDocument();
  });

  it('clicking a row calls openRun with the run id', () => {
    seedStore([runSucceeded]);
    render(<WfRunsList port={31415} />);

    fireEvent.click(screen.getByTestId(`workflows-run-row-${runSucceeded.id}`));

    expect(useWorkflowsModal.getState().selectedRunId).toBe(runSucceeded.id);
  });

  it('shows counts on each filter chip', () => {
    seedStore([runRunning, runWaiting, runFailed]);
    render(<WfRunsList port={31415} />);

    // All chip should show the total count (3)
    const allChip = screen.getByTestId('workflows-runs-filter-all');
    expect(allChip.textContent).toContain('3');
  });

  it('succeeded run row shows an outputs summary line', () => {
    const run = makeRun('r-outputs', 'succeeded', { outputs: { summary: 'x', count: 3 } });
    seedStore([run]);
    render(<WfRunsList port={31415} />);
    expect(screen.getByTestId(`workflows-run-row-${run.id}`).textContent).toMatch(/2 outputs/);
  });

  it('succeeded run row with no outputs shows "Done"', () => {
    const run = makeRun('r-nooutputs', 'succeeded');
    seedStore([run]);
    render(<WfRunsList port={31415} />);
    expect(screen.getByTestId(`workflows-run-row-${run.id}`).textContent).toContain('Done');
  });
});

describe('WfRunsList — trigger kind labels', () => {
  it('shows "Manual" for manual trigger', () => {
    seedStore([makeRun('t1', 'succeeded', { triggerKind: 'manual' })]);
    render(<WfRunsList port={31415} />);
    const row = screen.getByTestId('workflows-run-row-t1');
    expect(row.textContent).toContain('Manual');
  });

  it('shows "Scheduled" for cron trigger', () => {
    seedStore([makeRun('t2', 'succeeded', { triggerKind: 'cron' })]);
    render(<WfRunsList port={31415} />);
    const row = screen.getByTestId('workflows-run-row-t2');
    expect(row.textContent).toContain('Scheduled');
  });

  it('shows "Event" for event trigger', () => {
    seedStore([makeRun('t3', 'succeeded', { triggerKind: 'event' })]);
    render(<WfRunsList port={31415} />);
    const row = screen.getByTestId('workflows-run-row-t3');
    expect(row.textContent).toContain('Event');
  });

  it('shows "Sub-workflow" for call trigger', () => {
    seedStore([makeRun('t4', 'succeeded', { triggerKind: 'call' })]);
    render(<WfRunsList port={31415} />);
    const row = screen.getByTestId('workflows-run-row-t4');
    expect(row.textContent).toContain('Sub-workflow');
  });
});
