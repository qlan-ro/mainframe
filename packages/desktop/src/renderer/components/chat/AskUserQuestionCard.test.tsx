import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PermissionRequest } from '@mainframe/types';
import { AskUserQuestionCard } from './AskUserQuestionCard.js';

function createSingleRequest(): PermissionRequest {
  return {
    requestId: 'req-1',
    toolName: 'AskUserQuestion',
    toolUseId: 'tool-1',
    suggestions: [],
    input: {
      questions: [
        {
          header: 'Output format',
          question: 'What format should the output be?',
          options: [
            { label: 'Animated GIF', description: 'Loops automatically.' },
            { label: 'MP4 video', description: 'Higher quality.' },
          ],
          multiSelect: false,
        },
      ],
    },
  };
}

function createMultiRequest(): PermissionRequest {
  return {
    requestId: 'req-2',
    toolName: 'AskUserQuestion',
    toolUseId: 'tool-2',
    suggestions: [],
    input: {
      questions: [
        {
          header: 'Step one',
          question: 'What format should the output be?',
          options: [{ label: 'Animated GIF' }, { label: 'MP4 video' }],
          multiSelect: false,
        },
        {
          question: 'What should the asset showcase?',
          options: [{ label: 'Hero banner' }, { label: 'Feature showcase' }],
          multiSelect: false,
        },
      ],
    },
  };
}

describe('AskUserQuestionCard', () => {
  it('renders the question text', () => {
    render(<AskUserQuestionCard request={createSingleRequest()} onRespond={vi.fn()} />);
    expect(screen.getByText('What format should the output be?')).toBeInTheDocument();
  });

  it('renders option labels', () => {
    render(<AskUserQuestionCard request={createSingleRequest()} onRespond={vi.fn()} />);
    expect(screen.getByText('Animated GIF')).toBeInTheDocument();
    expect(screen.getByText('MP4 video')).toBeInTheDocument();
  });

  it('submit button is disabled until an option is selected', () => {
    render(<AskUserQuestionCard request={createSingleRequest()} onRespond={vi.fn()} />);
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  it('submit button is enabled after selection', async () => {
    render(<AskUserQuestionCard request={createSingleRequest()} onRespond={vi.fn()} />);
    await userEvent.click(screen.getByText('Animated GIF'));
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled();
  });

  it('calls onRespond with correct answers on submit', async () => {
    const onRespond = vi.fn();
    render(<AskUserQuestionCard request={createSingleRequest()} onRespond={onRespond} />);
    await userEvent.click(screen.getByText('MP4 video'));
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(
      'allow',
      undefined,
      expect.objectContaining({
        answers: { 'What format should the output be?': 'MP4 video' },
      }),
    );
  });

  it('calls onRespond("deny") when Skip is clicked', async () => {
    const onRespond = vi.fn();
    render(<AskUserQuestionCard request={createSingleRequest()} onRespond={onRespond} />);
    await userEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onRespond).toHaveBeenCalledWith('deny');
  });

  it('shows question counter for multi-question requests', () => {
    render(<AskUserQuestionCard request={createMultiRequest()} onRespond={vi.fn()} />);
    expect(screen.getByText(/question 1 of 2/i)).toBeInTheDocument();
  });

  it('navigates to next question after selecting and clicking Next', async () => {
    render(<AskUserQuestionCard request={createMultiRequest()} onRespond={vi.fn()} />);
    await userEvent.click(screen.getByText('Animated GIF'));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('What should the asset showcase?')).toBeInTheDocument();
  });

  it('navigates Back to previous question', async () => {
    render(<AskUserQuestionCard request={createMultiRequest()} onRespond={vi.fn()} />);
    await userEvent.click(screen.getByText('Animated GIF'));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('What format should the output be?')).toBeInTheDocument();
  });

  it('submits answers for all wizard steps', async () => {
    const onRespond = vi.fn();
    render(<AskUserQuestionCard request={createMultiRequest()} onRespond={onRespond} />);
    await userEvent.click(screen.getByText('Animated GIF'));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByText('Feature showcase'));
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onRespond).toHaveBeenCalledWith(
      'allow',
      undefined,
      expect.objectContaining({
        answers: {
          'What format should the output be?': 'Animated GIF',
          'What should the asset showcase?': 'Feature showcase',
        },
      }),
    );
  });
});
