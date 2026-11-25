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
import type { PermissionOption } from '@qlan-ro/mainframe-types';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import type { ReplyFn } from '../gate-types';
import { AskUserQuestionGate } from '../AskUserQuestionGate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// AskUserQuestionGate has its own bespoke wizard UI and never reads `options`
// (gate presentation from the adapter-supplied option list is PermissionGate's
// concern) — this fixture only satisfies `ChatPermissionEntry`'s shape.
const OPTIONS: PermissionOption[] = [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
];

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
  options: OPTIONS,
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
  options: OPTIONS,
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
  options: OPTIONS,
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
  options: OPTIONS,
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
  // 3b. Indicators follow the shadcn questionnaire kit's choice recipe: the
  //     shared v2 Checkbox for multi-select, a size-4 filled dot for single.
  // -------------------------------------------------------------------------

  it('multi-select option row renders the shared Checkbox primitive as its indicator', () => {
    wrap(<AskUserQuestionGate entry={multi()} reply={reply} />);

    const option = screen.getByTestId('chat-question-option-0-a');
    const indicator = option.querySelector('button[role="checkbox"]');
    expect(indicator).not.toBeNull();
  });

  it('single-select option row radio indicator fills when selected', () => {
    wrap(<AskUserQuestionGate entry={single()} reply={reply} />);

    const option = screen.getByTestId('chat-question-option-0-MP4');
    const indicator = option.querySelector('[data-radio-indicator]');
    expect(indicator).not.toBeNull();
    expect(indicator).toHaveClass('size-4', 'border-muted-foreground');

    fireEvent.click(option);
    expect(indicator).toHaveClass('border-[5px]', 'border-accent-fill');
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

  it('the question is the title, and its header is the context line under it', () => {
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
      options: OPTIONS,
    };
    wrap(<AskUserQuestionGate entry={entry} reply={reply} />);

    const title = screen.getByTestId('chat-question-text');
    expect(title.tagName).toBe('H3');
    expect(title).toHaveTextContent('Which auth approach?');
    expect(screen.getByTestId('chat-question-context')).toHaveTextContent('Auth method');
  });

  // -------------------------------------------------------------------------
  // 8. No header, no context: the title stands alone, with no label above it
  // -------------------------------------------------------------------------

  it('without a header or context there is no context line', () => {
    wrap(<AskUserQuestionGate entry={singleNoHeader()} reply={reply} />);

    expect(screen.getByTestId('chat-question-text')).toHaveTextContent('Which auth approach?');
    expect(screen.queryByTestId('chat-question-context')).toBeNull();
    expect(screen.queryByText('Question')).toBeNull();
  });

  it('adds "select all that apply" to the context line of a multi-select question', () => {
    wrap(<AskUserQuestionGate entry={multi()} reply={reply} />);

    expect(screen.getByTestId('chat-question-context')).toHaveTextContent('select all that apply');
  });

  it('names the asker and how many more wait, after the header', () => {
    wrap(
      <AskUserQuestionGate
        entry={single()}
        reply={reply}
        context={{ asker: 'code-reviewer', title: 'Review the diff', more: 2 }}
      />,
    );

    expect(screen.getByTestId('chat-question-context').textContent).toBe(
      'Format · code-reviewer · Review the diff · 2 more waiting',
    );
  });

  it('shows no "more waiting" when nothing waits behind it', () => {
    wrap(<AskUserQuestionGate entry={single()} reply={reply} context={{ asker: 'code-reviewer', more: 0 }} />);

    expect(screen.getByTestId('chat-question-context').textContent).toBe('Format · code-reviewer');
  });

  it('spells out what hides in the asker, and keeps its order', () => {
    wrap(
      <AskUserQuestionGate
        entry={single()}
        reply={reply}
        context={{ asker: 'a\u202Eb', title: 'c\u200Bd', more: 0 }}
      />,
    );

    expect(screen.getByTestId('chat-question-context').textContent).toBe('Format · a⟨U+202E⟩b · c⟨U+200B⟩d');
    expect(screen.getByText(/a⟨U\+202E⟩b/)).toHaveClass('stored-order');
  });

  it('spells out what hides in the agent’s question, header and options, and answers with them as written', () => {
    const entry = single();
    entry.request.input = {
      questions: [
        {
          question: 'Delete \u202Egnihton\u202C?',
          header: 'Cle\u200Ban',
          options: [{ label: 'Ye\u200Bs', description: 'all\u2066' }, { label: 'No' }],
        },
      ],
    };
    const reply = vi.fn().mockResolvedValue(undefined);
    wrap(<AskUserQuestionGate entry={entry} reply={reply} />);

    expect(screen.getByTestId('chat-question-text')).toHaveTextContent('Delete ⟨U+202E⟩gnihton⟨U+202C⟩?');
    expect(screen.getByTestId('chat-question-context')).toHaveTextContent('Cle⟨U+200B⟩an');
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Delete ⟨U+202E⟩gnihton⟨U+202C⟩?');
    const [yes] = screen.getAllByRole('radio');
    expect(yes).toHaveTextContent('Ye⟨U+200B⟩sall⟨U+2066⟩');

    fireEvent.click(yes!);
    fireEvent.click(screen.getByTestId('chat-question-submit'));
    expect(reply).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        updatedInput: expect.objectContaining({ answers: { 'Delete \u202Egnihton\u202C?': 'Ye\u200Bs' } }),
      }),
    );
  });

  it('tags an option ending in "(Recommended)" and drops the suffix from its label', () => {
    const entry = single();
    (entry.request.input.questions as { options: { label: string }[] }[])[0]!.options = [
      { label: 'MP4 (Recommended)' },
      { label: 'GIF' },
    ];
    wrap(<AskUserQuestionGate entry={entry} reply={reply} />);

    const option = screen.getByTestId('chat-question-option-0-MP4 (Recommended)');
    expect(screen.getByTestId('chat-question-option-0-MP4 (Recommended)-recommended')).toHaveTextContent('Recommended');
    expect(option.textContent).toContain('MP4');
    expect(option.textContent).not.toContain('(Recommended)');
    expect(screen.queryByTestId('chat-question-option-0-GIF-recommended')).toBeNull();
  });

  it('answers with the label as the model wrote it, suffix included, when a recommended option is chosen', () => {
    const entry = single();
    (entry.request.input.questions as { options: { label: string }[] }[])[0]!.options = [
      { label: 'MP4 (Recommended)' },
      { label: 'GIF' },
    ];
    wrap(<AskUserQuestionGate entry={entry} reply={reply} />);

    fireEvent.click(screen.getByTestId('chat-question-option-0-MP4 (Recommended)'));
    fireEvent.click(screen.getByTestId('chat-question-submit'));

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: 'allow',
        updatedInput: expect.objectContaining({ answers: { 'Pick a format': 'MP4 (Recommended)' } }),
      }),
    );
  });

  it('exposes single-select rows as a radiogroup and multi-select rows as checkboxes', () => {
    const { unmount } = wrap(<AskUserQuestionGate entry={single()} reply={reply} />);
    expect(screen.getByRole('radiogroup', { name: 'Pick a format' })).toBeInTheDocument();
    expect(screen.getByTestId('chat-question-option-0-MP4')).toHaveAttribute('role', 'radio');
    expect(screen.getByTestId('chat-question-option-0-MP4')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('chat-question-option-0-MP4'));
    expect(screen.getByTestId('chat-question-option-0-MP4')).toHaveAttribute('aria-checked', 'true');
    unmount();

    wrap(<AskUserQuestionGate entry={multi()} reply={reply} />);
    expect(screen.getByRole('group', { name: 'Pick tags' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
  });
});
