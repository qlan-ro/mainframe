/**
 * WfRunDetail — run header, cancel button, waiting banner, outputs footer.
 *
 * TDD: tests written first, component implemented after.
 * Covers:
 * - a waiting run shows Cancel button + "Answer now" banner
 * - a succeeded run with outputs shows produced-outputs footer
 * - back button calls backToList
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkflowRunSummary } from '@qlan-ro/mainframe-types';
import type { RunDetail } from '@/lib/api/workflows';
import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { WfRunDetail } from '@/features/workflows/WfRunDetail';

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

describe('WfRunDetail — waiting run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the Cancel button when the run is waiting', () => {
    seedDetail(makeRun('r1', 'waiting'));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByTestId('workflows-run-cancel')).toBeInTheDocument();
  });

  it('shows the Cancel button when the run is running', () => {
    seedDetail(makeRun('r2', 'running'));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByTestId('workflows-run-cancel')).toBeInTheDocument();
  });

  it('shows the "Answer now" banner when a run has a pending interaction', () => {
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
          formSchema: [],
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
    expect(screen.getByText(/Answer now/i)).toBeInTheDocument();
  });

  it('does not show Cancel for a succeeded run', () => {
    seedDetail(makeRun('r4', 'succeeded'));
    render(<WfRunDetail port={31415} />);
    expect(screen.queryByTestId('workflows-run-cancel')).not.toBeInTheDocument();
  });
});

describe('WfRunDetail — succeeded run with outputs', () => {
  it('shows the produced-outputs footer when run.outputs is set', () => {
    seedDetail(makeRun('r5', 'succeeded', { outputs: { result: 'hello', count: 42 } }));
    render(<WfRunDetail port={31415} />);
    // Footer shows key/value rows
    expect(screen.getByText('result')).toBeInTheDocument();
    expect(screen.getByText('count')).toBeInTheDocument();
  });

  it('does not show outputs footer when run.outputs is null', () => {
    seedDetail(makeRun('r6', 'succeeded', { outputs: null }));
    render(<WfRunDetail port={31415} />);
    expect(screen.queryByText(/produced output/i)).not.toBeInTheDocument();
  });
});

describe('WfRunDetail — navigation', () => {
  it('renders the back button', () => {
    seedDetail(makeRun('r7', 'succeeded'));
    render(<WfRunDetail port={31415} />);
    expect(screen.getByTestId('workflows-run-back')).toBeInTheDocument();
  });

  it('clicking the back button calls backToList', () => {
    seedDetail(makeRun('r8', 'succeeded'));
    render(<WfRunDetail port={31415} />);
    fireEvent.click(screen.getByTestId('workflows-run-back'));
    expect(useWorkflowsModal.getState().selectedRunId).toBeNull();
  });

  it('renders the workflow name and run id in the header', () => {
    seedDetail(makeRun('r9', 'running'));
    render(<WfRunDetail port={31415} />);
    // Workflow name from the store
    expect(screen.getByText('Hello World')).toBeInTheDocument();
    // Run id
    expect(screen.getByText(/#r9/)).toBeInTheDocument();
  });
});
