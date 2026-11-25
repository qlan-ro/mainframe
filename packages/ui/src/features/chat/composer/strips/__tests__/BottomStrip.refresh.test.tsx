import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConversationVisibility } from '../../../runtime/conversation-visibility';
import { BottomStrip } from '../BottomStrip';

const readBranch = vi.fn<(port: number, projectId: string, chatId?: string) => Promise<{ branch: string | null }>>();
let chat: Partial<Chat>;

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (state: unknown) => unknown) =>
    select({ thread: { messages: [], isRunning: false }, threads: { threadItems: [], mainThreadId: 'main' } }),
}));
vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtrasSelector: (select: (extras: unknown) => unknown) => select({ state: { chatConfig: chat } }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 1 }));
vi.mock('@/features/sessions/use-active-identity', () => ({ useActiveIdentity: () => ({ projectPath: '/repo' }) }));
vi.mock('@/features/git/BranchPopover', () => ({
  BranchPopover: ({ children }: { children: React.ReactElement }) => children,
}));
vi.mock('@/lib/api/git', () => ({
  getGitBranch: (...args: Parameters<typeof readBranch>) => readBranch(...args),
  getProjectWorktrees: async () => [],
}));
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => false }));

function strip(visible = true) {
  return (
    <TooltipProvider>
      <ConversationVisibility.Provider value={visible}>
        <BottomStrip />
      </ConversationVisibility.Provider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  chat = { id: 'chat', projectId: 'project', worktreePath: '/wt', branchName: 'topic', baseBranch: 'release' };
  readBranch.mockReset().mockResolvedValue({ branch: 'topic' });
});

it.each(['focus', 'popover open'])('rechecks an external checkout on %s', async (trigger) => {
  render(strip());
  await screen.findByText('topic from release');
  readBranch.mockResolvedValue({ branch: 'other/topic' });
  if (trigger === 'focus') {
    fireEvent.focus(window);
  } else {
    fireEvent.click(screen.getByTestId('composer-worktree-trigger'));
  }
  await waitFor(() => expect(screen.getByTestId('composer-branch')).toHaveTextContent('other/topic'));
  expect(screen.queryByText('topic from release')).not.toBeInTheDocument();
  if (trigger === 'popover open') {
    const info = within(await screen.findByTestId('composer-worktree-active-info'));
    expect(info.getByText('other/topic')).toBeVisible();
    expect(info.queryByText('From')).not.toBeInTheDocument();
  }
  expect(readBranch).toHaveBeenCalledTimes(2);
});

it('keeps the original read schedule for a chat without a recorded base', async () => {
  chat.baseBranch = undefined;
  const view = render(strip(false));
  await waitFor(() => expect(readBranch).toHaveBeenCalledExactlyOnceWith(1, 'project', 'chat'));
  chat = { ...chat, worktreePath: '/wt/moved' };
  view.rerender(strip());
  fireEvent.focus(window);
  fireEvent.click(screen.getByTestId('composer-worktree-trigger'));
  await screen.findByTestId('composer-worktree-active-info');
  expect(readBranch).toHaveBeenCalledTimes(1);
});

it('keeps an inactive base-bearing conversation from reading on focus', async () => {
  const view = render(strip(false));
  fireEvent.focus(window);
  expect(readBranch).not.toHaveBeenCalled();
  view.rerender(strip());
  await screen.findByText('topic from release');
  expect(readBranch).toHaveBeenCalledExactlyOnceWith(1, 'project', 'chat');
});
