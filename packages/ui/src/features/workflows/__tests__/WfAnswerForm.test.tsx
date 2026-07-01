/**
 * WfAnswerForm — conditional fields, required-field gating, submit flow,
 * and already-answered error handling.
 *
 * TDD: tests written first, components implemented after.
 * Covers:
 * - a choice pill selects on click
 * - selecting a choice reveals a conditional text follow-up field
 * - submit calls respondInteraction with the collected values
 * - success shows "Answer submitted — the run will continue."
 * - a reject with "already" in the message shows "Already answered on another device."
 * - submit is disabled when a required field has no value
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WorkflowInteractionSummary } from '@qlan-ro/mainframe-types';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/api/workflows', () => ({
  respondInteraction: vi.fn(),
}));

import * as wfApi from '@/lib/api/workflows';
import { WfAnswerForm } from '@/features/workflows/WfAnswerForm';

// ── Fixtures ───────────────────────────────────────────────────────────────────

/**
 * A two-field interaction:
 * - "feeling": choice with required=true; options ["Good", "Tired"]
 * - "notes": text (optional) visible only when feeling === "Tired"
 */
const makeInteraction = (): WorkflowInteractionSummary => ({
  id: 'int-1',
  runId: 'run-99',
  stepPath: 'step/question',
  title: 'Evening check-in',
  createdAt: Date.now() - 60_000,
  expiresAt: null,
  formSchema: [
    {
      key: 'feeling',
      type: 'choice',
      label: 'How are you feeling?',
      options: ['Good', 'Tired'],
      required: true,
    },
    {
      key: 'notes',
      type: 'text',
      label: 'What is going on?',
      required: false,
      when: { key: 'feeling', equals: 'Tired' },
    },
  ],
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const respondMock = () => wfApi.respondInteraction as ReturnType<typeof vi.fn>;

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WfAnswerForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the choice pills for the first field', () => {
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} />);
    expect(screen.getByTestId('workflows-field-feeling')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Good' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tired' })).toBeInTheDocument();
  });

  it('does not show the conditional notes field when no choice is selected', () => {
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} />);
    expect(screen.queryByTestId('workflows-field-notes')).not.toBeInTheDocument();
  });

  it('reveals the conditional notes field after selecting the triggering choice', () => {
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tired' }));
    expect(screen.getByTestId('workflows-field-notes')).toBeInTheDocument();
  });

  it('does not reveal the conditional field when a non-matching choice is selected', () => {
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    expect(screen.queryByTestId('workflows-field-notes')).not.toBeInTheDocument();
  });

  it('submit is disabled when a required field has no value', () => {
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} />);
    expect(screen.getByTestId('workflows-answer-submit')).toBeDisabled();
  });

  it('submit becomes enabled after filling the required field', () => {
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    expect(screen.getByTestId('workflows-answer-submit')).not.toBeDisabled();
  });

  it('submit calls respondInteraction with the collected values', async () => {
    respondMock().mockResolvedValue(undefined);
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    fireEvent.click(screen.getByTestId('workflows-answer-submit'));

    await waitFor(() => {
      expect(wfApi.respondInteraction).toHaveBeenCalledWith(31415, 'int-1', { feeling: 'Good' });
    });
  });

  it('shows success message and calls onDone after a successful submit', async () => {
    respondMock().mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    fireEvent.click(screen.getByTestId('workflows-answer-submit'));

    await waitFor(() => {
      expect(screen.getByText('Answer submitted — the run will continue.')).toBeInTheDocument();
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('shows already-answered message when the API rejects with "already" in the message', async () => {
    respondMock().mockRejectedValue(new Error('Interaction already answered'));
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    fireEvent.click(screen.getByTestId('workflows-answer-submit'));

    await waitFor(() => {
      expect(screen.getByText('Already answered on another device.')).toBeInTheDocument();
    });
  });

  it('submit includes values from the visible conditional field', async () => {
    respondMock().mockResolvedValue(undefined);
    render(<WfAnswerForm port={31415} interaction={makeInteraction()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tired' }));
    fireEvent.change(screen.getByTestId('workflows-field-notes'), { target: { value: 'Rough day' } });
    fireEvent.click(screen.getByTestId('workflows-answer-submit'));

    await waitFor(() => {
      expect(wfApi.respondInteraction).toHaveBeenCalledWith(31415, 'int-1', {
        feeling: 'Tired',
        notes: 'Rough day',
      });
    });
  });
});
