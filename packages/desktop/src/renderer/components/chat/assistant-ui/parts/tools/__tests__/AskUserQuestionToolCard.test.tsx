import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ASK_USER_QUESTION_FIXTURE } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '../../../../../ui/tooltip.js';
import { AskUserQuestionToolCard } from '../AskUserQuestionToolCard.js';

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>;

const args = {
  questions: [
    { question: 'Which DB?', header: 'DB choice', options: [{ label: 'Postgres' }, { label: 'MySQL' }] },
    { question: 'Pick', header: 'Color', options: [{ label: 'Red' }, { label: 'Blue' }], multiSelect: true },
  ],
};

describe('AskUserQuestionToolCard', () => {
  it('renders question texts, answers, and notes from structured askUserQuestion field', () => {
    const result = {
      content: 'User answered the questions.',
      isError: false,
      askUserQuestion: ASK_USER_QUESTION_FIXTURE,
    };

    const { getByText, getByRole } = render(wrap(<AskUserQuestionToolCard args={args} result={result} />));
    fireEvent.click(getByRole('button'));

    expect(getByText('Which DB?')).toBeTruthy();
    expect(getByText('Pick')).toBeTruthy();
    expect(getByText('Postgres')).toBeTruthy();
    expect(getByText('Red')).toBeTruthy();
    expect(getByText('Blue')).toBeTruthy();
    expect(getByText('dense')).toBeTruthy();
  });

  it('renders without throwing and shows no answer rows when askUserQuestion is undefined', () => {
    const result = { content: 'No structured data.', isError: false };

    const { container } = render(wrap(<AskUserQuestionToolCard args={args} result={result} />));

    expect(container).toBeTruthy();
  });
});
