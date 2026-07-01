/**
 * WfLibrary — scope filter, row rendering, run action.
 *
 * TDD: test written first, component implemented after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WorkflowSummary, WorkflowRunSummary } from '@qlan-ro/mainframe-types';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/api/workflows', () => ({
  startRun: vi.fn(),
  rescanWorkflows: vi.fn(),
}));

import * as wfApi from '@/lib/api/workflows';

import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { WfLibrary } from '@/features/workflows/WfLibrary';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const globalWf: WorkflowSummary = {
  id: 'global:hello',
  name: 'Hello World',
  description: 'A global greeting workflow',
  projectId: null,
  filePath: '/workflows/hello.yml',
  triggers: [{ kind: 'schedule', detail: '0 9 * * *' }],
};

const projectWf: WorkflowSummary = {
  id: 'proj:deploy',
  name: 'Deploy to Staging',
  description: 'Deploys the app to staging',
  projectId: 'proj-123',
  filePath: '/projects/my-app/.workflows/deploy.yml',
  triggers: [{ kind: 'event', detail: 'push' }],
};

const globalRun: WorkflowRunSummary = {
  id: 'run-1',
  workflowId: 'global:hello',
  status: 'succeeded',
  triggerKind: 'manual',
  parentRunId: null,
  startedAt: Date.now() - 60_000,
  finishedAt: Date.now() - 50_000,
  error: null,
  outputs: null,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function seedStore(workflows: WorkflowSummary[], runs: WorkflowRunSummary[] = []) {
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
    section: 'library',
    selectedRunId: null,
    editorTarget: null,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WfLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders both rows when the store has two workflows', () => {
    seedStore([globalWf, projectWf]);
    render(<WfLibrary port={31415} />);

    expect(screen.getByTestId('workflows-library')).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-library-row-${globalWf.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-library-row-${projectWf.id}`)).toBeInTheDocument();
  });

  it('shows workflow names, descriptions, and scope pill', () => {
    seedStore([globalWf, projectWf]);
    render(<WfLibrary port={31415} />);

    expect(screen.getByText('Hello World')).toBeInTheDocument();
    expect(screen.getByText('Deploy to Staging')).toBeInTheDocument();
    // scope pill on the global row (multiple "Global" texts exist: filter button + pill)
    const globalPills = screen.getAllByText('Global');
    expect(globalPills.length).toBeGreaterThanOrEqual(2);
  });

  it('scope filter "Global" shows only the global workflow', () => {
    seedStore([globalWf, projectWf]);
    render(<WfLibrary port={31415} />);

    fireEvent.click(screen.getByTestId('workflows-library-scope-global'));

    expect(screen.getByTestId(`workflows-library-row-${globalWf.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`workflows-library-row-${projectWf.id}`)).not.toBeInTheDocument();
  });

  it('scope filter "This project" shows only project workflows', () => {
    seedStore([globalWf, projectWf]);
    render(<WfLibrary port={31415} />);

    fireEvent.click(screen.getByTestId('workflows-library-scope-project'));

    expect(screen.queryByTestId(`workflows-library-row-${globalWf.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`workflows-library-row-${projectWf.id}`)).toBeInTheDocument();
  });

  it('scope filter "All" restores all rows after narrowing', () => {
    seedStore([globalWf, projectWf]);
    render(<WfLibrary port={31415} />);

    fireEvent.click(screen.getByTestId('workflows-library-scope-global'));
    fireEvent.click(screen.getByTestId('workflows-library-scope-all'));

    expect(screen.getByTestId(`workflows-library-row-${globalWf.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`workflows-library-row-${projectWf.id}`)).toBeInTheDocument();
  });

  it('clicking Run calls startRun and then openRun with the new run id', async () => {
    const newRun: WorkflowRunSummary = { ...globalRun, id: 'run-new' };
    (wfApi.startRun as ReturnType<typeof vi.fn>).mockResolvedValue(newRun);
    seedStore([globalWf], []);

    render(<WfLibrary port={31415} />);
    fireEvent.click(screen.getByTestId(`workflows-library-run-${globalWf.id}`));

    await waitFor(() => {
      expect(wfApi.startRun).toHaveBeenCalledWith(31415, globalWf.id);
    });
    await waitFor(() => {
      expect(useWorkflowsModal.getState().selectedRunId).toBe('run-new');
    });
  });

  it('clicking Edit calls openEditor with mode=edit and the workflow id', () => {
    seedStore([globalWf]);
    render(<WfLibrary port={31415} />);

    fireEvent.click(screen.getByTestId(`workflows-library-edit-${globalWf.id}`));

    expect(useWorkflowsModal.getState().editorTarget).toEqual({
      mode: 'edit',
      workflowId: globalWf.id,
    });
  });

  it('clicking "New workflow" calls openEditor with mode=new', () => {
    seedStore([]);
    render(<WfLibrary port={31415} />);

    fireEvent.click(screen.getByTestId('workflows-library-new'));

    expect(useWorkflowsModal.getState().editorTarget).toEqual({ mode: 'new' });
  });

  it('shows the last-run status dot when runs exist for a workflow', () => {
    seedStore([globalWf], [globalRun]);
    render(<WfLibrary port={31415} />);

    // The row for the global workflow should mention last-run info
    const row = screen.getByTestId(`workflows-library-row-${globalWf.id}`);
    expect(row.textContent).toMatch(/Last run/i);
  });

  // ── Trigger chip kind mapping ────────────────────────────────────────────────

  it('renders "Schedule" chip label for schedule triggers', () => {
    // No detail — chip must fall back to the kind label "Schedule"
    const wf: WorkflowSummary = { ...globalWf, triggers: [{ kind: 'schedule' }] };
    seedStore([wf]);
    render(<WfLibrary port={31415} />);
    expect(screen.getByTestId(`workflows-library-row-${wf.id}`).textContent).toMatch(/Schedule/i);
  });

  it('renders "Event" chip label for event triggers', () => {
    const wf: WorkflowSummary = { ...globalWf, triggers: [{ kind: 'event' }] };
    seedStore([wf]);
    render(<WfLibrary port={31415} />);
    expect(screen.getByTestId(`workflows-library-row-${wf.id}`).textContent).toMatch(/Event/i);
  });

  it('renders "Manual" chip label for manual triggers', () => {
    const wf: WorkflowSummary = { ...globalWf, triggers: [{ kind: 'manual' }] };
    seedStore([wf]);
    render(<WfLibrary port={31415} />);
    expect(screen.getByTestId(`workflows-library-row-${wf.id}`).textContent).toMatch(/Manual/i);
  });

  it('renders "Webhook" chip label for webhook triggers', () => {
    const wf: WorkflowSummary = { ...globalWf, triggers: [{ kind: 'webhook' }] };
    seedStore([wf]);
    render(<WfLibrary port={31415} />);
    expect(screen.getByTestId(`workflows-library-row-${wf.id}`).textContent).toMatch(/Webhook/i);
  });

  // ── Global scope pill uses muted purple (#7a4d9e), NOT bright purple-600 ────

  it('global scope pill carries the muted purple token, not bright purple-600', () => {
    seedStore([globalWf]);
    render(<WfLibrary port={31415} />);
    const row = screen.getByTestId(`workflows-library-row-${globalWf.id}`);
    // The scope pill element text is "Global" and should carry the muted color class
    const pill = Array.from(row.querySelectorAll('span')).find(
      (el) => el.textContent?.trim() === 'Global' && el.className.includes('rounded'),
    );
    expect(pill).toBeTruthy();
    // Must use the muted arbitrary color, not the bright purple-600 tailwind class
    expect(pill?.className).not.toContain('text-purple-600');
    expect(pill?.className).toContain('#7a4d9e');
  });
});
