import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import type { ToolPart } from '../../../view-model/turn/types';
import { TranscriptScopeProvider, type TranscriptScope } from '../../../messages/turn/transcript-scope';
import { QuestionCard } from '../QuestionCard';

const questions = [
  { question: 'Which window first?', header: 'Reset order', options: [{ label: 'Weekly' }] },
  { question: 'Ship today?', options: [] },
];
const part = (result: unknown, acpStatus = 'completed') =>
  ({
    type: 'tool-call',
    toolCallId: 'q',
    toolName: 'AskUserQuestion',
    args: { questions },
    result,
    status: { type: 'complete' },
    providerMetadata: { mainframe: { acpStatus } },
  }) as unknown as ToolPart;
const within = (scope: Partial<TranscriptScope>, card: ReactNode) => (
  <TranscriptScopeProvider value={{ rootThreadId: 'r', ancestors: [], pendingToolIds: new Set(), ...scope }}>
    {card}
  </TranscriptScopeProvider>
);

it('records each question, the chosen answers and the note', () => {
  const askUserQuestion = [
    { question: 'Which window first?', answer: ['Weekly', 'Daily'], notes: 'in that order' },
    { question: 'Ship today?', answer: ['Yes'] },
  ];
  render(<QuestionCard part={part({ content: '', askUserQuestion })} />);
  expect(screen.getByRole('group', { name: 'Question, answered: Which window first?' })).toBeVisible();
  expect(screen.getAllByTestId('chat-ask-header').map((el) => el.textContent)).toEqual([
    'Reset order · answered',
    'Question · answered',
  ]);
  expect(screen.getAllByTestId('chat-ask-answer').map((el) => el.textContent)).toEqual(['Weekly', 'Daily', 'Yes']);
  expect(screen.getByTestId('chat-ask-answer-notes')).toHaveTextContent('Note: “in that order”');
  expect(screen.getByTestId('chat-ask-card').parentElement).toHaveAttribute('data-activity-id', 'q');
});

it.each<[string, Partial<TranscriptScope>, string]>([
  ['in a running turn', { live: true }, 'Reset order · waiting for your answer'],
  [
    'with its request pending',
    { live: false, pendingToolIds: new Set(['q']) },
    'Reset order · waiting for your answer',
  ],
  // A killed or interrupted session: nothing waits for an answer any more.
  ['in a turn that ended', { live: false }, 'Reset order · stopped, not answered'],
])('says how a question without an answer stands %s', (_when, scope, text) => {
  render(within(scope, <QuestionCard part={part(undefined, 'in_progress')} />));
  expect(screen.getAllByTestId('chat-ask-header')[0]).toHaveTextContent(text);
});

it('keeps what came back when no answer was recorded', () => {
  render(<QuestionCard part={part('The user dismissed the question.')} />);
  expect(screen.getAllByTestId('chat-ask-header')[0]).toHaveTextContent('not answered');
  expect(screen.getByTestId('chat-ask-reply')).toHaveTextContent('dismissed');
});
