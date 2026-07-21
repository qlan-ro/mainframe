/**
 * Behavior tests for AskUserQuestionGate — the observable contract for the
 * Back/Next wizard component:
 *
 *  1. Single question: renders root, question text, option testids; submit
 *     shown (not Next); submit disabled until an option is selected.
 *  2. Single-select submit: selects an option and submits → reply called once
 *     with the full ControlResponse including answers.
 *  3. Multi-select submit: two options selected → answers contains an array.
 *  4. Other row: clicking __other__ shows a text input; typing and submitting
 *     uses the typed text as the answer.
 *  5. Two-question wizard: step counter shown; Next (not Submit) on Q1; Back
 *     visible on Q2; Q1 selection preserved on Back; Submit on Q2; full
 *     answers on submit.
 *  6. Skip: reply called with behavior:'deny' regardless of selections.
 *
 * All expected values are hardcoded; reply call shapes are the contract.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import type { ReplyFn } from '../gate-types';
import { AskUserQuestionGate } from '../AskUserQuestionGate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const single = (): ChatPermissionEntry => ({
  requestId: 'r1',
  askedAt: 1,
  request: {
    requestId: 'r1',
    toolName: 'AskUserQuestion',
    toolUseId: 'tu1',
    suggestions: [],
    input: {
      questions: [{ question: 'Pick a format', header: 'Format', options: [{ label: 'MP4' }, { label: 'GIF' }] }],
    },
  },
});

const multi = (): ChatPermissionEntry => ({
  requestId: 'r1',
  askedAt: 1,
  request: {
    requestId: 'r1',
    toolName: 'AskUserQuestion',
    toolUseId: 'tu1',
    suggestions: [],
    input: {
      questions: [
        { question: 'Pick tags', header: 'Tags', multiSelect: true, options: [{ label: 'a' }, { label: 'b' }] },
      ],
    },
  },
});

const two = (): ChatPermissionEntry => ({
  requestId: 'r1',
  askedAt: 1,
  request: {
    requestId: 'r1',
    toolName: 'AskUserQuestion',
    toolUseId: 'tu1',
    suggestions: [],
    input: {
      questions: [
        { question: 'Q1', options: [{ label: 'a1' }, { label: 'a2' }] },
        { question: 'Q2', options: [{ label: 'b1' }, { label: 'b2' }] },
      ],
    },
  },
});

/** Single question with NO header — question text is the title. */
const singleNoHeader = (): ChatPermissionEntry => ({
  requestId: 'r2',
  askedAt: 1,
  request: {
    requestId: 'r2',
    toolName: 'AskUserQuestion',
    toolUseId: 'tu2',
    suggestions: [],
    input: {
      questions: [{ question: 'Which auth approach?', options: [{ label: 'OAuth' }, { label: 'PAT' }] }],
    },
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AskUserQuestionGate', () => {
  let reply: Mock<ReplyFn>;

  beforeEach(() => {
    reply = vi.fn<ReplyFn>();
  });

  // -------------------------------------------------------------------------
  // 1. Single question: root, question text, options present; submit shown and
  //    disabled until an option is selected.
  // -------------------------------------------------------------------------

  it('renders root testid, question text, and option testids; submit disabled until selection', () => {
    wrap(<AskUserQuestionGate entry={single()} reply={reply} />);

    expect(screen.getByTestId('chat-question-gate')).toBeInTheDocument();
    expect(screen.getByText('Pick a format')).toBeInTheDocument();
    expect(screen.getByTestId('chat-question-option-0-MP4')).toBeInTheDocument();
    expect(screen.getByTestId('chat-question-option-0-GIF')).toBeInTheDocument();

    // On a single question, submit is shown and Next is not.
    expect(screen.getByTestId('chat-question-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-question-next')).toBeNull();

    // Submit must be disabled before any selection.
    expect(screen.getByTestId('chat-question-submit')).toBeDisabled();

    // After selecting an option, submit becomes enabled.
    fireEvent.click(screen.getByTestId('chat-question-option-0-MP4'));
    expect(screen.getByTestId('chat-question-submit')).not.toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // 2. Single-select submit → reply called with full ControlResponse
  // -------------------------------------------------------------------------

  it('single-select submit calls reply with the selected answer in updatedInput.answers', () => {
    wrap(<AskUserQuestionGate entry={single()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-question-option-0-MP4'));
    fireEvent.click(screen.getByTestId('chat-question-submit'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'AskUserQuestion',
      behavior: 'allow',
      updatedInput: expect.objectContaining({
        questions: expect.anything(),
        answers: { 'Pick a format': 'MP4' },
      }),
    });
    // answers must be exact
    const calledWith = reply.mock.calls[0]![0];
    expect((calledWith.updatedInput as { answers: unknown }).answers).toEqual({ 'Pick a format': 'MP4' });
  });

  // -------------------------------------------------------------------------
  // 3. Multi-select submit → answers contains an array of selected labels
  // -------------------------------------------------------------------------

  it('multi-select submit calls reply with an array of all selected labels in answers', () => {
    wrap(<AskUserQuestionGate entry={multi()} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-question-option-0-a'));
    fireEvent.click(screen.getByTestId('chat-question-option-0-b'));
    fireEvent.click(screen.getByTestId('chat-question-submit'));

    expect(reply).toHaveBeenCalledTimes(1);
    const calledWith = reply.mock.calls[0]![0];
    expect((calledWith.updatedInput as { answers: unknown }).answers).toEqual({ 'Pick tags': ['a', 'b'] });
  });

  // -------------------------------------------------------------------------
  // 3b. Multi-select checkbox indicator reuses the shared pixel-accurate
  //     Checkbox primitive (17x17, real checkmark icon) instead of a bespoke,
  //     undersized dot indicator.
  // -------------------------------------------------------------------------

  it('multi-select option row renders the shared Checkbox primitive as its indicator', () => {
    wrap(<AskUserQuestionGate entry={multi()} reply={reply} />);

    const option = screen.getByTestId('chat-question-option-0-a');
    const indicator = option.querySelector('button[role="checkbox"]');
    expect(indicator).not.toBeNull();
    expect(indicator).toHaveClass('h-[17px]', 'w-[17px]');
  });

  it('single-select option row radio indicator grows its border to 5px when selected (no fill)', () => {
    wrap(<AskUserQuestionGate entry={single()} reply={reply} />);

    const option = screen.getByTestId('chat-question-option-0-MP4');
    const indicator = option.querySelector('[data-radio-indicator]');
    expect(indicator).not.toBeNull();
    expect(indicator).toHaveClass('size-[17px]', 'border-[1.5px]', 'border-input');

    fireEvent.click(option);
    expect(indicator).toHaveClass('border-[5px]', 'border-primary');
  });

  // -------------------------------------------------------------------------
  // 4. Other row: clicking __other__ shows text input; typing and submitting
  //    uses the typed text as the answer.
  // -------------------------------------------------------------------------

  it('clicking the __other__ option shows a text input; typing and submitting uses the typed text as the answer', () => {
    wrap(<AskUserQuestionGate entry={single()} reply={reply} />);

    // The Other option is always rendered.
    expect(screen.getByTestId('chat-question-option-0-__other__')).toBeInTheDocument();

    // Text input is not visible until Other is selected.
    expect(screen.queryByTestId('chat-question-other-input-0')).toBeNull();

    fireEvent.click(screen.getByTestId('chat-question-option-0-__other__'));

    // Text input appears, with an enter-transition on reveal.
    const input = screen.getByTestId('chat-question-other-input-0');
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass('animate-in', 'fade-in-0');

    fireEvent.change(input, { target: { value: 'custom answer' } });
    fireEvent.click(screen.getByTestId('chat-question-submit'));

    expect(reply).toHaveBeenCalledTimes(1);
    const calledWith = reply.mock.calls[0]![0];
    expect((calledWith.updatedInput as { answers: unknown }).answers).toEqual({ 'Pick a format': 'custom answer' });
  });

  // -------------------------------------------------------------------------
  // 5. Two-question wizard: counter, Next/Back navigation, answers on submit
  // -------------------------------------------------------------------------

  it('two-question wizard shows counter, navigates with Next/Back preserving selections, submits both answers', () => {
    wrap(<AskUserQuestionGate entry={two()} reply={reply} />);

    // Step 1 of 2 counter is shown.
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();

    // Submit is absent on step 1; Next is present.
    expect(screen.queryByTestId('chat-question-submit')).toBeNull();
    expect(screen.getByTestId('chat-question-next')).toBeInTheDocument();

    // Next is disabled until Q1 has a selection.
    expect(screen.getByTestId('chat-question-next')).toBeDisabled();

    // Select Q1 option — Next becomes enabled.
    fireEvent.click(screen.getByTestId('chat-question-option-0-a1'));
    expect(screen.getByTestId('chat-question-next')).not.toBeDisabled();

    // Advance to Q2.
    fireEvent.click(screen.getByTestId('chat-question-next'));

    // Q2 options are now visible.
    expect(screen.getByTestId('chat-question-option-1-b1')).toBeInTheDocument();
    expect(screen.getByTestId('chat-question-option-1-b2')).toBeInTheDocument();

    // Back button is shown on Q2.
    expect(screen.getByTestId('chat-question-back')).toBeInTheDocument();

    // Submit is present on the last question.
    expect(screen.getByTestId('chat-question-submit')).toBeInTheDocument();

    // Go back to Q1.
    fireEvent.click(screen.getByTestId('chat-question-back'));

    // Q1 selection is preserved — Next must be enabled (a1 is still selected).
    expect(screen.getByTestId('chat-question-next')).not.toBeDisabled();

    // Advance to Q2 again and complete the wizard.
    fireEvent.click(screen.getByTestId('chat-question-next'));
    fireEvent.click(screen.getByTestId('chat-question-option-1-b1'));
    fireEvent.click(screen.getByTestId('chat-question-submit'));

    expect(reply).toHaveBeenCalledTimes(1);
    const calledWith = reply.mock.calls[0]![0];
    expect((calledWith.updatedInput as { answers: unknown }).answers).toEqual({ Q1: 'a1', Q2: 'b1' });
  });

  // -------------------------------------------------------------------------
  // 6. Skip → reply called with behavior:'deny'
  // -------------------------------------------------------------------------

  it('clicking skip calls reply with behavior deny and no updatedInput', () => {
    wrap(<AskUserQuestionGate entry={single()} reply={reply} />);

    expect(screen.getByTestId('chat-question-skip')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-question-skip'));

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'AskUserQuestion',
      behavior: 'deny',
    });
  });

  // -------------------------------------------------------------------------
  // 7. Header present: GateHead title = header; question text in body element
  // -------------------------------------------------------------------------

  it('with header "Auth method" the head title is the header and question text is in chat-question-text', () => {
    const entry: ChatPermissionEntry = {
      requestId: 'r3',
      askedAt: 1,
      request: {
        requestId: 'r3',
        toolName: 'AskUserQuestion',
        toolUseId: 'tu3',
        suggestions: [],
        input: {
          questions: [{ question: 'Which auth approach?', header: 'Auth method', options: [{ label: 'OAuth' }] }],
        },
      },
    };
    wrap(<AskUserQuestionGate entry={entry} reply={reply} />);

    // The header is the title shown in GateHead.
    expect(screen.getByText('Auth method')).toBeInTheDocument();

    // The question text is demoted to the body paragraph.
    const body = screen.getByTestId('chat-question-text');
    expect(body).toBeInTheDocument();
    expect(body).toHaveTextContent('Which auth approach?');

    // Body row left-aligns under the head title (px-3.5 tile-inset + tile + gap = 49px = pl-[49px]).
    expect(body).toHaveClass('pl-[49px]');
  });

  // -------------------------------------------------------------------------
  // 8. No header: question text IS the title; no chat-question-text element
  // -------------------------------------------------------------------------

  it('without a header the question text is the title and chat-question-text is absent', () => {
    wrap(<AskUserQuestionGate entry={singleNoHeader()} reply={reply} />);

    // The question text should appear as the head title (no header to displace it).
    expect(screen.getByText('Which auth approach?')).toBeInTheDocument();

    // No separate body paragraph element should be present.
    expect(screen.queryByTestId('chat-question-text')).toBeNull();
  });
});
