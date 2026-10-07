import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { auiState, entry, setSessions, switchToThread } from './fixtures';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: typeof auiState) => unknown) => sel(auiState),
  useAui: () => ({ threads: { switchToThread } }),
}));

import { DelegateTaskCard } from '../DelegateTaskCard';

const ARGS = { task: 'Review the diff for races', role: 'review' };

function renderCard(props: { result?: unknown; isError?: boolean }) {
  const part = {
    type: 'tool-call',
    toolCallId: 'tu-1',
    toolName: 'mcp__mainframe__delegate_task',
    args: ARGS,
    argsText: JSON.stringify(ARGS),
    status: { type: 'complete' },
    addResult: () => {},
    resume: () => {},
    ...props,
  } as unknown as ToolCallMessagePartProps;
  return render(
    <TooltipProvider>
      <DelegateTaskCard {...part} />
    </TooltipProvider>,
  );
}

beforeEach(() => switchToThread.mockReset());

describe('DelegateTaskCard', () => {
  it('follows the child row: its title, its live status, and an open link', async () => {
    setSessions(entry('parent'), [
      entry('kid', { delegation: { taskId: 'task_kid', role: 'review', status: 'waiting' } }, 'Race review'),
    ]);
    const result = JSON.stringify({ taskId: 'task_kid', childChatId: 'kid', title: 'Task: Review', status: 'running' });
    renderCard({ result });

    const card = screen.getByTestId('chat-tool-delegate-task-card');
    expect(card).toHaveTextContent('Delegate');
    expect(card).toHaveTextContent('Race review');
    expect(screen.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'waiting');

    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-open-task_kid'));
    expect(switchToThread).toHaveBeenCalledWith('kid');
  });

  it('falls back to the result while the child row has not loaded, with the link disabled', () => {
    setSessions(entry('parent'));
    renderCard({ result: JSON.stringify({ taskId: 'task_x', childChatId: 'x', title: 'Task: X', status: 'queued' }) });
    expect(screen.getByTestId('chat-tool-delegate-task-card')).toHaveTextContent('Task: X');
    expect(screen.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'queued');
    expect(screen.getByTestId('chat-tool-delegate-task-open-task_x')).toBeDisabled();
  });

  it('shows the error text and no link for a refused call', async () => {
    setSessions(entry('parent'));
    renderCard({ result: 'Too many delegated tasks for this chat.', isError: true });
    expect(screen.queryByTestId('chat-tool-delegate-task-status')).toBeNull();
    await userEvent.click(screen.getByTestId('chat-tool-delegate-task-trigger'));
    expect(screen.getByTestId('chat-tool-delegate-task-error')).toHaveTextContent('Too many delegated tasks');
  });
});
