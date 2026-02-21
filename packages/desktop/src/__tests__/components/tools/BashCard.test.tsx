import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BashCard } from '../../../renderer/components/chat/assistant-ui/parts/tools/BashCard.js';

describe('BashCard', () => {
  it('renders the command from args.command', () => {
    render(<BashCard args={{ command: 'echo hello' }} result={undefined} isError={undefined} />);
    expect(screen.getByText(/echo hello/)).toBeInTheDocument();
  });

  it('accepts args.input as fallback for command', () => {
    render(<BashCard args={{ input: 'npm install' }} result={undefined} isError={undefined} />);
    expect(screen.getByText(/npm install/)).toBeInTheDocument();
  });

  it('truncates long commands to 80 characters with ellipsis', () => {
    const longCmd = 'x'.repeat(100);
    render(<BashCard args={{ command: longCmd }} result={undefined} isError={undefined} />);
    // truncated version shows in the header span
    const truncated = longCmd.slice(0, 80) + '...';
    expect(screen.getByTitle(longCmd)).toHaveTextContent(truncated);
  });

  it('shows pulsing status dot when result is undefined (running)', () => {
    const { container } = render(<BashCard args={{ command: 'sleep 5' }} result={undefined} isError={undefined} />);
    // The pulsing dot has the animate-pulse class
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeInTheDocument();
  });

  it('does not show pulsing dot when result is provided', () => {
    const { container } = render(<BashCard args={{ command: 'ls' }} result="file.txt\n" isError={false} />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).not.toBeInTheDocument();
  });

  it('shows result output when card is expanded', async () => {
    render(<BashCard args={{ command: 'ls' }} result="my-output-text" isError={false} />);
    // Initially collapsed, result not visible
    expect(screen.queryByText(/my-output-text/)).not.toBeInTheDocument();
    // Click the header button to expand
    const toggleBtn = screen.getByRole('button');
    await userEvent.click(toggleBtn);
    expect(screen.getByText(/my-output-text/)).toBeInTheDocument();
  });

  it('shows full command in expanded section after opening', async () => {
    render(<BashCard args={{ command: 'echo hello' }} result="hello" isError={false} />);
    await userEvent.click(screen.getByRole('button'));
    // expanded pre shows "$ echo hello"
    expect(screen.getByText(/\$ echo hello/)).toBeInTheDocument();
  });
});
