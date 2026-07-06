/**
 * WfInteractionCard — expand/collapse + the real WfAnswerForm composition.
 *
 * Regression: `onDone={() => setOpen(false)}` collapsed the card in the same
 * batch as WfAnswerForm's own `setState('done')`, unmounting the form before
 * its "Answer submitted…" confirmation ever painted. The card must keep
 * showing that confirmation after a successful submit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WorkflowInteractionSummary } from '@qlan-ro/mainframe-types';

vi.mock('@/lib/api/workflows', () => ({
  respondInteraction: vi.fn(),
}));

import * as wfApi from '@/lib/api/workflows';
import { useWorkflowsStore } from '@/features/workflows/use-workflows-store';
import { useWorkflowsModal } from '@/features/workflows/use-workflows-modal';
import { WfInteractionCard } from '@/features/workflows/WfInteractionCard';

const makeInteraction = (): WorkflowInteractionSummary => ({
  id: 'int-1',
  runId: 'run-99',
  stepPath: 'step/question',
  title: 'Evening check-in',
  createdAt: Date.now() - 60_000,
  expiresAt: null,
  formSchema: [{ key: 'feeling', type: 'choice', label: 'How are you feeling?', options: ['Good'], required: true }],
});

describe('WfInteractionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkflowsStore.setState({ runs: [], workflows: [], interactions: [makeInteraction()] });
    useWorkflowsModal.setState({ open: true, section: 'needs', selectedRunId: null, editorTarget: null });
  });

  it('keeps showing the success confirmation after a successful submit, instead of unmounting the form', async () => {
    vi.mocked(wfApi.respondInteraction).mockResolvedValue(undefined);
    render(<WfInteractionCard port={31415} interaction={makeInteraction()} defaultExpanded />);

    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    fireEvent.click(screen.getByTestId('workflows-answer-submit'));

    await waitFor(() => {
      expect(screen.getByText('Answer submitted — the run will continue.')).toBeInTheDocument();
    });
  });

  it('keeps showing the already-answered message after a rejected submit', async () => {
    vi.mocked(wfApi.respondInteraction).mockRejectedValue(new Error('Interaction already answered'));
    render(<WfInteractionCard port={31415} interaction={makeInteraction()} defaultExpanded />);

    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    fireEvent.click(screen.getByTestId('workflows-answer-submit'));

    await waitFor(() => {
      expect(screen.getByText('Already answered on another device.')).toBeInTheDocument();
    });
  });
});
