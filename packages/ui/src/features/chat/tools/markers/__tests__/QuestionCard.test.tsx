import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ToolPart } from '../../../view-model/turn/types';
import { QuestionCard } from '../QuestionCard';

const questions = [
  { question: 'Which window first?', header: 'Reset order', options: [{ label: 'Weekly' }] },
  { question: 'Ship today?', options: [] },
];
const part = (result: unknown) =>
  ({
    type: 'tool-call',
    toolCallId: 'q',
    toolName: 'AskUserQuestion',
    args: { questions },
    result,
  }) as unknown as ToolPart;

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

it('says a question is still open', () => {
  render(<QuestionCard part={part(undefined)} />);
  expect(screen.getAllByTestId('chat-ask-header')[0]).toHaveTextContent('Reset order · waiting for your answer');
});

it('keeps what came back when no answer was recorded', () => {
  render(<QuestionCard part={part('The user dismissed the question.')} />);
  expect(screen.getAllByTestId('chat-ask-header')[0]).toHaveTextContent('not answered');
  expect(screen.getByTestId('chat-ask-reply')).toHaveTextContent('dismissed');
});
