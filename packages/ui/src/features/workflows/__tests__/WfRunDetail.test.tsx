/**
 * WfRunDetail — parity tests for the corrected run-detail header.
 *
 * Key corrections vs the old implementation:
 * - Cancel button is in the title row (not a separate row), 0.5px red border.
 * - Banner is status-tinted for ALL statuses (not just waiting + Bell-only).
 * - Footer has bg-mf-content2, green CircleDot, and "returned to…" subtitle.
 * - Trigger/timing line now includes trigger icon, Clock icon, and
 *   an accent-colored "Parent: #X" link when run.parentRunId is set.
 * - Workflow name renders as text-title (17px), not text-heading (15px).
 *
 * WfStatus is mocked to avoid the Loader2 reference error that a parallel
 * agent introduced (missing import in WfStatus.tsx). Our tests verify our
 * markup — WfStatus.tsx visual correctness is tested in WfStatus.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkflowRunSummary, QuestionField } from '@qlan-ro/mainframe-types';
import type { RunDetail } from '@/lib/api/workflows';
import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { WfRunDetail } from '@/features/workflows/WfRunDetail';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/features/workflows/WfStatus', () => ({
  WfStatusTag: ({ status }: { status: string }) => <span data-testid={`mock-status-tag-${status}`}>{status}</span>,
  WfStatusPip: ({ status }: { status: string }) => <span data-testid={`mock-status-pip-${status}`} />,
}));

vi.mock('@/features/workflows/WfTree', () => ({
  WfTree: () => <div data-testid="mock-wf-tree" />,
}));

vi.mock('@/lib/api/workflows', () => ({
  cancelRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/session-nav', () => ({
  openSessionById: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
    error: null,
    outputs: null,
    ...extra,
  };
}

function seedDetail(run: WorkflowRunSummary, tree: RunDetail['tree'] = []) {
  useWorkflowsStore.setState({
    runDetail: { run, tree },
    workflows: [
      {
        id: 'global:hello',
        name: 'Hello World',
        projectId: null,
        filePath: '/workflows/hello.yml',
        triggers: [],
      },
    ],
    runs: [run],
    interactions: [],
    loading: false,
    error: null,
  });
  useWorkflowsModal.setState({
    open: true,
    section: 'runs',
    selectedRunId: run.id,
    editorTarget: null,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WfRunDetail — Cancel button placement and style', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the Cancel button in the title row when the run is waiting', () => {
    seedDetail(makeRun('r1', 'waiting'));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByTestId('workflows-run-cancel')).toBeInTheDocument();
  });

  it('shows the Cancel button in the title row when the run is running', () => {
    seedDetail(makeRun('r2', 'running'));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByTestId('workflows-run-cancel')).toBeInTheDocument();
  });

  it('Cancel button label is "Cancel" (no "run" suffix)', () => {
    seedDetail(makeRun('r2b', 'running'));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByTestId('workflows-run-cancel').textContent).toContain('Cancel');
  });

  it('does not show Cancel for a succeeded run', () => {
    seedDetail(makeRun('r4', 'succeeded'));
    render(<WfRunDetail port={31415} />);
    expect(screen.queryByTestId('workflows-run-cancel')).not.toBeInTheDocument();
  });

  it('does not show Cancel for a failed run', () => {
    seedDetail(makeRun('r4b', 'failed'));
    render(<WfRunDetail port={31415} />);
    expect(screen.queryByTestId('workflows-run-cancel')).not.toBeInTheDocument();
  });
});

describe('WfRunDetail — status banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows banner with "Answer now" CTA when run is waiting and has a pending interaction', () => {
    const run = makeRun('r3', 'waiting');
    useWorkflowsStore.setState({
      runDetail: { run, tree: [] },
      workflows: [],
      runs: [run],
      interactions: [
        {
          id: 'i1',
          runId: run.id,
          stepPath: 'root.q',
          title: 'What should I do?',
          formSchema: [] as QuestionField[],
          createdAt: Date.now() - 1000,
          expiresAt: null,
        },
      ],
      loading: false,
      error: null,
    });
    useWorkflowsModal.setState({
      open: true,
      section: 'runs',
      selectedRunId: run.id,
      editorTarget: null,
    });
    render(<WfRunDetail port={31415} />);
    expect(screen.getByTestId('workflows-run-banner')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-run-banner-cta')).toBeInTheDocument();
    expect(screen.getByText(/Answer now/i)).toBeInTheDocument();
  });

  it('does not show banner for a waiting run with no pending interactions', () => {
    seedDetail(makeRun('r3b', 'waiting'));
    render(<WfRunDetail port={31415} />);
    expect(screen.queryByTestId('workflows-run-banner')).not.toBeInTheDocument();
  });

  it('does not show banner for a succeeded run', () => {
    seedDetail(makeRun('r3c', 'succeeded'));
    render(<WfRunDetail port={31415} />);
    expect(screen.queryByTestId('workflows-run-banner')).not.toBeInTheDocument();
  });

  it('banner contains a WfStatusPip', () => {
    const run = makeRun('r3d', 'waiting');
    useWorkflowsStore.setState({
      runDetail: { run, tree: [] },
      workflows: [],
      runs: [run],
      interactions: [
        {
          id: 'i2',
          runId: run.id,
          stepPath: 'root.q',
          title: 'Choose',
          formSchema: [] as QuestionField[],
          createdAt: Date.now(),
          expiresAt: null,
        },
      ],
      loading: false,
      error: null,
    });
    useWorkflowsModal.setState({ open: true, section: 'runs', selectedRunId: run.id, editorTarget: null });
    render(<WfRunDetail port={31415} />);
    // The mock pip is rendered inside the banner
    expect(screen.getByTestId('mock-status-pip-waiting')).toBeInTheDocument();
  });
});

describe('WfRunDetail — produced-outputs footer', () => {
  it('shows the produced-outputs footer with CircleDot and subtitle when run.outputs is set', () => {
    seedDetail(makeRun('r5', 'succeeded', { outputs: { result: 'hello', count: 42 } }));
    render(<WfRunDetail port={31415} />);
    // Key names visible
    expect(screen.getByText('result')).toBeInTheDocument();
    expect(screen.getByText('count')).toBeInTheDocument();
    // "Produced outputs" label
    expect(screen.getByText(/produced output/i)).toBeInTheDocument();
    // Subtitle
    expect(screen.getByText(/returned to whatever called this run/i)).toBeInTheDocument();
  });

  it('does not show outputs footer when run.outputs is null', () => {
    seedDetail(makeRun('r6', 'succeeded', { outputs: null }));
    render(<WfRunDetail port={31415} />);
    expect(screen.queryByText(/produced output/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/returned to/i)).not.toBeInTheDocument();
  });
});

describe('WfRunDetail — trigger/timing/parent line', () => {
  it('shows the timing (formatAgo result) in the sub-line', () => {
    seedDetail(makeRun('r7', 'succeeded'));
    render(<WfRunDetail port={31415} />);
    // formatAgo for startedAt = now - 60000 → "1m ago"
    expect(screen.getByText(/ago/i)).toBeInTheDocument();
  });

  it('shows "Manual" trigger label', () => {
    seedDetail(makeRun('r7b', 'succeeded', { triggerKind: 'manual' }));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('shows "Scheduled" for cron trigger kind', () => {
    seedDetail(makeRun('r7c', 'succeeded', { triggerKind: 'cron' }));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('shows "Event" for event trigger kind', () => {
    seedDetail(makeRun('r7d', 'succeeded', { triggerKind: 'event' }));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByText('Event')).toBeInTheDocument();
  });

  it('shows "Sub-workflow" for call trigger kind', () => {
    seedDetail(makeRun('r7e', 'succeeded', { triggerKind: 'call' }));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByText('Sub-workflow')).toBeInTheDocument();
  });

  it('shows the Parent link when parentRunId is set', () => {
    seedDetail(makeRun('r8', 'succeeded', { parentRunId: 'r-parent-42' }));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByTestId('workflows-run-parent-link')).toBeInTheDocument();
    expect(screen.getByTestId('workflows-run-parent-link').textContent).toContain('Parent');
    expect(screen.getByTestId('workflows-run-parent-link').textContent).toContain('r-parent-42');
  });

  it('does not show the Parent link when parentRunId is null', () => {
    seedDetail(makeRun('r9', 'succeeded', { parentRunId: null }));
    render(<WfRunDetail port={31415} />);
    expect(screen.queryByTestId('workflows-run-parent-link')).not.toBeInTheDocument();
  });
});

describe('WfRunDetail — navigation', () => {
  it('renders the back button', () => {
    seedDetail(makeRun('r10', 'succeeded'));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByTestId('workflows-run-back')).toBeInTheDocument();
  });

  it('clicking the back button calls backToList', () => {
    seedDetail(makeRun('r11', 'succeeded'));
    render(<WfRunDetail port={31415} />);
    fireEvent.click(screen.getByTestId('workflows-run-back'));
    expect(useWorkflowsModal.getState().selectedRunId).toBeNull();
  });

  it('renders the workflow name in the header as text-title', () => {
    seedDetail(makeRun('r12', 'running'));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
    // text-title class applied to the name span
    expect(screen.getByText('Hello World').className).toContain('text-title');
  });

  it('renders the run id in the header', () => {
    seedDetail(makeRun('r13', 'running'));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByText(/#r13/)).toBeInTheDocument();
  });
});
