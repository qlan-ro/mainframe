import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { auiState, entry, setSessions, switchToThread } from './fixtures';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: typeof auiState) => unknown) => sel(auiState),
  useAui: () => ({ threads: { switchToThread } }),
}));

import { ChatHeaderTasksChip } from '../ChatHeaderTasksChip';

beforeEach(() => switchToThread.mockReset());

describe('ChatHeaderTasksChip', () => {
  it('renders nothing for a chat that never delegated', () => {
    setSessions(entry('parent'), [entry('fork', { parentChatId: 'parent' })]);
    render(<ChatHeaderTasksChip />);
    expect(screen.queryByTestId('chat-header-tasks-chip')).toBeNull();
  });

  it('counts running and waiting tasks and opens a child from the menu', async () => {
    setSessions(entry('parent'), [
      entry('kid-a', { parentChatId: 'parent', delegation: { taskId: 'task_a', role: 'review', status: 'running' } }),
      entry('kid-b', { parentChatId: 'parent', delegation: { taskId: 'task_b', role: 'test', status: 'waiting' } }),
      entry('kid-c', {
        parentChatId: 'parent',
        delegation: { taskId: 'task_c', role: 'general', status: 'completed' },
      }),
    ]);
    render(<ChatHeaderTasksChip />);

    const chip = screen.getByTestId('chat-header-tasks-chip');
    expect(chip).toHaveTextContent('1 task running · 1 waiting');
    await userEvent.click(chip);
    const row = await screen.findByTestId('chat-header-task-row-task_b');
    expect(row).toHaveTextContent('Chat kid-b');
    expect(row).toHaveTextContent('waiting');
    expect(screen.getByTestId('chat-header-task-row-task_c')).toHaveTextContent('completed');

    await userEvent.click(row);
    expect(switchToThread).toHaveBeenCalledWith('kid-b');
  });
});
