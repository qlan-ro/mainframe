/**
 * AskUserQuestionCard — behavior tests.
 *
 * Strategy:
 *  - No hook mocks needed: AskUserQuestionCard reads only from props.
 *  - Wrap renders in TooltipProvider for Radix compatibility.
 *  - Assert hardcoded expected values; never re-run the card's own answer
 *    assembly logic in assertions.
 *
 * Behaviors covered:
 *  - done state: header shows question header + inline short answer for
 *    single-question flow; body shows answered entry after expand
 *  - pending state (result === undefined): header shows first question header,
 *    body shows question text in pending list
 *  - error state (isError=true)
 *  - multi-question flow: no inline short answer; body shows all entries
 *  - notes and preview fields in answered entries
 *  - known vs unknown option pill styling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { AskUserQuestionCard } from '../AskUserQuestionCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

/** Build a minimal ToolCallMessagePartProps for AskUserQuestionCard. */
function makePart(overrides: {
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  toolCallId?: string;
}): ToolCallMessagePartProps {
  return {
    type: 'tool-call' as const,
    toolName: 'AskUserQuestion',
    toolCallId: overrides.toolCallId ?? 'tc-ask-1',
    args: (overrides.args ?? { questions: [] }) as ToolCallMessagePartProps['args'],
    argsText: '',
    result: overrides.result,
    isError: overrides.isError,
    status: { type: 'complete' as const },
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
  };
}

function renderCard(props: ReturnType<typeof makePart>) {
  return render(
    <TooltipProvider>
      <AskUserQuestionCard {...props} />
    </TooltipProvider>,
  );
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const SINGLE_QUESTION_ARGS = {
  questions: [
    {
      question: 'Which framework should we use?',
      header: 'Framework choice',
      options: [{ label: 'React' }, { label: 'Vue' }, { label: 'Svelte' }],
    },
  ],
};

const MULTI_QUESTION_ARGS = {
  questions: [
    {
      question: 'Preferred language?',
      header: 'Language',
      options: [{ label: 'TypeScript' }, { label: 'JavaScript' }],
    },
    {
      question: 'Testing framework?',
      header: 'Testing',
      options: [{ label: 'Vitest' }, { label: 'Jest' }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AskUserQuestionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Root element ---

  it('renders the card root with data-testid="chat-ask-card"', () => {
    renderCard(makePart({ args: SINGLE_QUESTION_ARGS }));
    expect(screen.getByTestId('chat-ask-card')).toBeInTheDocument();
  });

  it('renders the trigger with data-testid="chat-ask-trigger"', () => {
    renderCard(makePart({ args: SINGLE_QUESTION_ARGS }));
    expect(screen.getByTestId('chat-ask-trigger')).toBeInTheDocument();
  });

  // --- Header: uses firstQuestion.header ---

  it('shows the first question header text', () => {
    renderCard(makePart({ args: SINGLE_QUESTION_ARGS }));
    expect(screen.getByTestId('chat-ask-header')).toHaveTextContent('Framework choice');
  });

  it('falls back to "Question" when no header is provided on the first question', () => {
    renderCard(
      makePart({
        args: {
          questions: [{ question: 'Pick one', options: [{ label: 'A' }] }],
        },
      }),
    );
    expect(screen.getByTestId('chat-ask-header')).toHaveTextContent('Question');
  });

  it('shows "Question" header when questions array is empty', () => {
    renderCard(makePart({ args: { questions: [] } }));
    expect(screen.getByTestId('chat-ask-header')).toHaveTextContent('Question');
  });

  // --- Pending state (result === undefined, questions provided) ---

  it('renders a pulsing status dot when result is undefined', () => {
    renderCard(makePart({ args: SINGLE_QUESTION_ARGS, result: undefined }));
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('does NOT render an inline short answer in pending state', () => {
    renderCard(makePart({ args: SINGLE_QUESTION_ARGS, result: undefined }));
    // " — " separator only appears when there is a short answer
    expect(screen.getByTestId('chat-ask-header')).not.toHaveTextContent(' — ');
  });

  it('body shows the pending question text after clicking trigger', () => {
    renderCard(makePart({ args: SINGLE_QUESTION_ARGS, result: undefined }));
    fireEvent.click(screen.getByTestId('chat-ask-trigger'));
    // PendingQuestion renders the raw question.question field
    expect(screen.getByTestId('chat-ask-body')).toHaveTextContent('Which framework should we use?');
  });

  it('trigger has data-disabled in pending state when questions list is empty', () => {
    // No questions + no result → hasBody = false → disabled
    renderCard(makePart({ args: { questions: [] }, result: undefined }));
    expect(screen.getByTestId('chat-ask-trigger')).toHaveAttribute('data-disabled');
  });

  // --- Done state (result carries askUserQuestion answers) ---

  it('does NOT render a pulsing dot when answers are present', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [{ question: 'Which framework should we use?', answer: ['React'] }],
        },
        isError: false,
      }),
    );
    expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('shows inline short answer in header for single-question flow', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [{ question: 'Which framework should we use?', answer: ['React'] }],
        },
        isError: false,
      }),
    );
    // Header reads: "Framework choice — React"
    const header = screen.getByTestId('chat-ask-header');
    expect(header).toHaveTextContent('Framework choice');
    expect(header).toHaveTextContent('React');
  });

  it('shows comma-separated inline answer when multiple options are selected in a single-question flow', () => {
    renderCard(
      makePart({
        args: {
          questions: [
            {
              question: 'Which packages?',
              header: 'Packages',
              options: [{ label: 'React' }, { label: 'Vite' }],
              multiSelect: true,
            },
          ],
        },
        result: {
          askUserQuestion: [{ question: 'Which packages?', answer: ['React', 'Vite'] }],
        },
        isError: false,
      }),
    );
    const header = screen.getByTestId('chat-ask-header');
    expect(header).toHaveTextContent('React, Vite');
  });

  it('does NOT show inline short answer for multi-question flow', () => {
    renderCard(
      makePart({
        args: MULTI_QUESTION_ARGS,
        result: {
          askUserQuestion: [
            { question: 'Preferred language?', answer: ['TypeScript'] },
            { question: 'Testing framework?', answer: ['Vitest'] },
          ],
        },
        isError: false,
      }),
    );
    // " — " only appears in single-question flows
    expect(screen.getByTestId('chat-ask-header')).not.toHaveTextContent(' — ');
  });

  it('body shows answered question text on initial render (answered cards open by default)', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [{ question: 'Which framework should we use?', answer: ['Vue'] }],
        },
        isError: false,
      }),
    );
    // Answered cards default to open — no trigger click needed
    expect(screen.getByTestId('chat-ask-question-text')).toHaveTextContent('Which framework should we use?');
  });

  it('body shows answer notes when present', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [
            {
              question: 'Which framework should we use?',
              answer: ['React'],
              notes: 'Team is most familiar with it',
            },
          ],
        },
        isError: false,
      }),
    );
    // Answered cards default to open — body visible without clicking
    expect(screen.getByTestId('chat-ask-answer-notes')).toHaveTextContent('Team is most familiar with it');
  });

  it('does NOT render notes element when notes field is absent', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [{ question: 'Which framework should we use?', answer: ['React'] }],
        },
        isError: false,
      }),
    );
    // Answered cards default to open — body is visible, notes element simply absent
    expect(screen.queryByTestId('chat-ask-answer-notes')).not.toBeInTheDocument();
  });

  it('body shows answer preview when present', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [
            {
              question: 'Which framework should we use?',
              answer: ['Svelte'],
              preview: 'Svelte compiles at build time',
            },
          ],
        },
        isError: false,
      }),
    );
    // Answered cards default to open — body visible without clicking
    expect(screen.getByTestId('chat-ask-answer-preview')).toHaveTextContent('Svelte compiles at build time');
  });

  it('does NOT render preview element when preview field is absent', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [{ question: 'Which framework should we use?', answer: ['React'] }],
        },
        isError: false,
      }),
    );
    // Answered cards default to open — body is visible, preview element simply absent
    expect(screen.queryByTestId('chat-ask-answer-preview')).not.toBeInTheDocument();
  });

  // --- Multi-question answered body ---

  it('body shows both answered question texts in a multi-question flow', () => {
    renderCard(
      makePart({
        args: MULTI_QUESTION_ARGS,
        result: {
          askUserQuestion: [
            { question: 'Preferred language?', answer: ['TypeScript'] },
            { question: 'Testing framework?', answer: ['Vitest'] },
          ],
        },
        isError: false,
      }),
    );
    // Answered cards default to open — body visible without clicking
    const questionTexts = screen.getAllByTestId('chat-ask-question-text');
    expect(questionTexts).toHaveLength(2);
    expect(questionTexts[0]).toHaveTextContent('Preferred language?');
    expect(questionTexts[1]).toHaveTextContent('Testing framework?');
  });

  // --- Body visible by default for answered cards (defaultOpen=answered) ---

  it('shows the body on initial render when answers are present', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [{ question: 'Which framework should we use?', answer: ['React'] }],
        },
        isError: false,
      }),
    );
    expect(screen.getByTestId('chat-ask-body')).toBeInTheDocument();
  });

  it('hides then shows the body on two consecutive trigger clicks (answered card starts open)', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [{ question: 'Which framework should we use?', answer: ['React'] }],
        },
        isError: false,
      }),
    );
    const trigger = screen.getByTestId('chat-ask-trigger');
    // First click collapses the already-open body
    fireEvent.click(trigger);
    expect(screen.queryByTestId('chat-ask-body')).not.toBeInTheDocument();
    // Second click re-expands it
    fireEvent.click(trigger);
    expect(screen.getByTestId('chat-ask-body')).toBeInTheDocument();
  });

  // --- Error state ---

  it('renders without crashing when isError=true', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [{ question: 'Which framework should we use?', answer: ['React'] }],
        },
        isError: true,
      }),
    );
    expect(screen.getByTestId('chat-ask-card')).toBeInTheDocument();
  });

  it('still shows the header label when isError=true and result is defined', () => {
    renderCard(
      makePart({
        args: SINGLE_QUESTION_ARGS,
        result: {
          askUserQuestion: [{ question: 'Which framework should we use?', answer: ['React'] }],
        },
        isError: true,
      }),
    );
    expect(screen.getByTestId('chat-ask-header')).toHaveTextContent('Framework choice');
  });
});
