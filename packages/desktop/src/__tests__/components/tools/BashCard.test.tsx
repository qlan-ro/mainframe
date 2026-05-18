import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BashCard } from '../../../renderer/components/chat/assistant-ui/parts/tools/BashCard.js';
import { TooltipProvider } from '../../../renderer/components/ui/tooltip.js';

describe('BashCard', () => {
  it('renders the command from args.command', () => {
    render(
      <TooltipProvider>
        <BashCard args={{ command: 'echo hello' }} result={undefined} isError={undefined} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/echo hello/)).toBeInTheDocument();
  });

  it('accepts args.input as fallback for command', () => {
    render(
      <TooltipProvider>
        <BashCard args={{ input: 'npm install' }} result={undefined} isError={undefined} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/npm install/)).toBeInTheDocument();
  });

  it('renders the full command and lets CSS truncate based on available width', () => {
    const longCmd = 'x'.repeat(100);
    render(
      <TooltipProvider>
        <BashCard args={{ command: longCmd }} result={undefined} isError={undefined} />
      </TooltipProvider>,
    );
    const span = screen.getByText(longCmd);
    expect(span).toBeInTheDocument();
    expect(span.className).toMatch(/truncate/);
  });

  it('shows pulsing status dot when result is undefined (running)', () => {
    const { container } = render(
      <TooltipProvider>
        <BashCard args={{ command: 'sleep 5' }} result={undefined} isError={undefined} />
      </TooltipProvider>,
    );
    // The pulsing dot has the animate-pulse class
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeInTheDocument();
  });

  it('does not show pulsing dot when result is provided', () => {
    const { container } = render(
      <TooltipProvider>
        <BashCard args={{ command: 'ls' }} result="file.txt\n" isError={false} />
      </TooltipProvider>,
    );
    const dot = container.querySelector('.animate-pulse');
    expect(dot).not.toBeInTheDocument();
  });

  it('shows result output when card is expanded', async () => {
    render(
      <TooltipProvider>
        <BashCard args={{ command: 'ls' }} result="my-output-text" isError={false} />
      </TooltipProvider>,
    );
    // Initially collapsed, result not visible
    expect(screen.queryByText(/my-output-text/)).not.toBeInTheDocument();
    // Click the header button to expand
    const toggleBtn = screen.getByRole('button');
    await userEvent.click(toggleBtn);
    expect(screen.getByText(/my-output-text/)).toBeInTheDocument();
  });

  it('shows command output in expanded section after opening', async () => {
    render(
      <TooltipProvider>
        <BashCard args={{ command: 'echo hello' }} result="hello" isError={false} />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByRole('button'));
    // The expanded body shows ONLY the command output. The command itself is
    // already in the always-visible header; echoing "$ command" was redundant.
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
