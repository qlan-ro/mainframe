/**
 * WfNeedsYou — inbox + interaction card rendering.
 *
 * TDD: test written first, components implemented after.
 * Covers:
 * - empty inbox shows "You're all caught up"
 * - a pending interaction renders its card
 * - "View run" calls openRun with the run id
 * - expanding "Answer" shows the form
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkflowInteractionSummary, WorkflowSummary, WorkflowRunSummary } from '@qlan-ro/mainframe-types';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/api/workflows', () => ({
  respondInteraction: vi.fn(),
  listWorkflows: vi.fn().mockResolvedValue([]),
  listInteractions: vi.fn().mockResolvedValue([]),
  listRuns: vi.fn().mockResolvedValue([]),
  getRun: vi.fn().mockResolvedValue(null),
}));

import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { WfNeedsYou } from '@/features/workflows/WfNeedsYou';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeInteraction = (overrides?: Partial<WorkflowInteractionSummary>): WorkflowInteractionSummary => ({
  id: 'int-1',
  runId: 'run-99',
  stepPath: 'step/question',
  title: 'Approve deployment?',
  createdAt: Date.now() - 60_000,
  expiresAt: null,
  formSchema: [
    {
      key: 'decision',
      type: 'choice',
      label: 'What do you want to do?',
      options: ['Approve', 'Reject'],
      required: true,
    },
  ],
  ...overrides,
});

const makeWorkflow = (): WorkflowSummary => ({
  id: 'wf-deploy',
  name: 'Deploy Pipeline',
  projectId: null,
  filePath: '/workflows/deploy.yml',
  triggers: [],
});

const makeRun = (): WorkflowRunSummary => ({
  id: 'run-99',
  workflowId: 'wf-deploy',
  status: 'waiting',
  triggerKind: 'manual',
  parentRunId: null,
  startedAt: Date.now() - 120_000,
  finishedAt: null,
  error: null,
  outputs: null,
});

function seedStore({
  interactions = [],
  workflows = [],
  runs = [],
}: {
  interactions?: WorkflowInteractionSummary[];
  workflows?: WorkflowSummary[];
  runs?: WorkflowRunSummary[];
}) {
  useWorkflowsStore.setState({
    interactions,
    workflows,
    runs,
    runDetail: null,
    loading: false,
    error: null,
  });
  useWorkflowsModal.setState({
    open: true,
    section: 'needs',
    selectedRunId: null,
    editorTarget: null,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WfNeedsYou', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the empty caught-up state when there are no interactions', () => {
    seedStore({ interactions: [] });
    render(<WfNeedsYou port={31415} />);

    expect(screen.getByTestId('workflows-needsyou-empty')).toBeInTheDocument();
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it('does not show the empty state when there are pending interactions', () => {
    seedStore({ interactions: [makeInteraction()], workflows: [makeWorkflow()], runs: [makeRun()] });
    render(<WfNeedsYou port={31415} />);

    expect(screen.queryByTestId('workflows-needsyou-empty')).not.toBeInTheDocument();
  });

  it('renders the needs-you root element', () => {
    seedStore({ interactions: [makeInteraction()], workflows: [makeWorkflow()], runs: [makeRun()] });
    render(<WfNeedsYou port={31415} />);

    expect(screen.getByTestId('workflows-needsyou')).toBeInTheDocument();
  });

  it('renders a card for each pending interaction', () => {
    seedStore({
      interactions: [makeInteraction(), makeInteraction({ id: 'int-2', title: 'Review PR?' })],
      workflows: [makeWorkflow()],
      runs: [makeRun()],
    });
    render(<WfNeedsYou port={31415} />);

    expect(screen.getByText('Approve deployment?')).toBeInTheDocument();
    expect(screen.getByText('Review PR?')).toBeInTheDocument();
  });

  it('clicking "View run" calls openRun with the runId', () => {
    seedStore({ interactions: [makeInteraction()], workflows: [makeWorkflow()], runs: [makeRun()] });
    render(<WfNeedsYou port={31415} />);

    fireEvent.click(screen.getByTestId('workflows-interaction-viewrun-int-1'));

    expect(useWorkflowsModal.getState().selectedRunId).toBe('run-99');
  });

  it('clicking "Answer" expands the answer form', () => {
    seedStore({ interactions: [makeInteraction()], workflows: [makeWorkflow()], runs: [makeRun()] });
    render(<WfNeedsYou port={31415} />);

    // The first card is defaultExpanded so the form should be visible already
    expect(screen.getByTestId('workflows-answer-submit')).toBeInTheDocument();
  });

  it('non-first cards show the "Answer" button to expand the form', () => {
    seedStore({
      interactions: [makeInteraction(), makeInteraction({ id: 'int-2', title: 'Review PR?' })],
      workflows: [makeWorkflow()],
      runs: [makeRun()],
    });
    render(<WfNeedsYou port={31415} />);

    // The second card is NOT defaultExpanded — it shows the Answer button
    fireEvent.click(screen.getByTestId('workflows-interaction-answer-int-2'));

    // After clicking, the form should be visible (two submit buttons now)
    const submits = screen.getAllByTestId('workflows-answer-submit');
    expect(submits.length).toBe(2);
  });

  it('renders the prompt text when the interaction has a prompt (content-loss regression guard)', () => {
    const promptText = 'A quick read on how the day went.';
    seedStore({
      interactions: [makeInteraction({ prompt: promptText } as Parameters<typeof makeInteraction>[0])],
      workflows: [makeWorkflow()],
      runs: [makeRun()],
    });
    render(<WfNeedsYou port={31415} />);

    expect(screen.getByText(promptText)).toBeInTheDocument();
  });

  it('shows future-tense expiry copy ("expires in …") in the chip', () => {
    const expiresAt = Date.now() + 9 * 60 * 60 * 1000 + 56 * 60 * 1000; // ~9h 56m from now
    seedStore({
      interactions: [makeInteraction({ expiresAt })],
      workflows: [makeWorkflow()],
      runs: [makeRun()],
    });
    render(<WfNeedsYou port={31415} />);

    // The expiry chip text must start with "expires" (future-tense, not past)
    expect(screen.getByText(/^expires in/i)).toBeInTheDocument();
    // The chip must NOT say "ago" — that would be formatAgo() called on a future timestamp
    // (note: the sub-line uses formatAgo for createdAt which is in the past, so we
    //  narrow the assertion to the chip element whose content starts with "expires")
    const chip = screen.getByText(/^expires in/i);
    expect(chip.textContent).not.toMatch(/ago/i);
  });

  it('uses "waiting" not "waited" in the sub-line age', () => {
    seedStore({
      interactions: [makeInteraction()],
      workflows: [makeWorkflow()],
      runs: [makeRun()],
    });
    render(<WfNeedsYou port={31415} />);

    // Sub-line should say "· waiting Xm ago", not "· waited Xm ago"
    // Use getAllByText since "waiting" also appears in the header count line
    const waitingElements = screen.getAllByText(/waiting/);
    expect(waitingElements.length).toBeGreaterThan(0);
    // No element should contain the word "waited"
    expect(screen.queryByText(/waited/)).not.toBeInTheDocument();
  });
});
