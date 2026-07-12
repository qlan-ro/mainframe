/**
 * DegradedChatCard — behavior tests.
 *
 * The unified degraded-chat card renders in the thread area when the chat's
 * transcript file was deleted (`transcriptMissing`) and/or its worktree is gone
 * (`worktreeMissing`), one section per cause, each with its recovery actions:
 *  - transcript: Continue here (chat-degraded-continue) — hidden when the
 *    worktree is ALSO missing (recovery merges into the worktree actions);
 *  - worktree: Recreate worktree (chat-degraded-recreate-worktree) +
 *    Continue in project root (chat-degraded-project-root);
 *  - always: Delete chat (chat-degraded-delete).
 * A failed recreate shows the error and falls back to project-root only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Chat } from '@qlan-ro/mainframe-types';

let __chatConfig: Partial<Chat> | null = null;

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => (__chatConfig === null ? undefined : { state: { chatConfig: __chatConfig } }),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/lib/api/chats', () => ({
  continueChatHere: vi.fn().mockResolvedValue(undefined),
  recreateChatWorktree: vi.fn().mockResolvedValue(undefined),
  continueChatInProjectRoot: vi.fn().mockResolvedValue(undefined),
  archiveChat: vi.fn().mockResolvedValue(undefined),
}));

import { continueChatHere, recreateChatWorktree, continueChatInProjectRoot, archiveChat } from '@/lib/api/chats';
import { DegradedChatCard } from '../DegradedChatCard';

function chat(overrides: Partial<Chat>): Partial<Chat> {
  return { id: 'chat-9', worktreeMissing: false, transcriptMissing: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  __chatConfig = null;
});

describe('DegradedChatCard — visibility', () => {
  it('renders nothing when neither flag is set', () => {
    __chatConfig = chat({});
    render(<DegradedChatCard />);
    expect(screen.queryByTestId('chat-degraded-card')).toBeNull();
  });

  it('renders nothing when extras are unavailable', () => {
    __chatConfig = null;
    render(<DegradedChatCard />);
    expect(screen.queryByTestId('chat-degraded-card')).toBeNull();
  });
});

describe('DegradedChatCard — transcript missing only', () => {
  beforeEach(() => {
    __chatConfig = chat({ transcriptMissing: true });
  });

  it('shows the card with Continue here + Delete chat, and no worktree actions', () => {
    render(<DegradedChatCard />);
    expect(screen.getByTestId('chat-degraded-card')).toBeInTheDocument();
    expect(screen.getByTestId('chat-degraded-continue')).toBeInTheDocument();
    expect(screen.getByTestId('chat-degraded-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-degraded-recreate-worktree')).toBeNull();
    expect(screen.queryByTestId('chat-degraded-project-root')).toBeNull();
  });

  it('Continue here POSTs the continue-here reset for this chat', async () => {
    render(<DegradedChatCard />);
    fireEvent.click(screen.getByTestId('chat-degraded-continue'));
    await waitFor(() => expect(continueChatHere).toHaveBeenCalledWith(31415, 'chat-9'));
  });

  it('Delete chat archives the chat', async () => {
    render(<DegradedChatCard />);
    fireEvent.click(screen.getByTestId('chat-degraded-delete'));
    await waitFor(() => expect(archiveChat).toHaveBeenCalledWith(31415, 'chat-9', true));
  });
});

describe('DegradedChatCard — worktree missing only', () => {
  beforeEach(() => {
    __chatConfig = chat({ worktreeMissing: true, worktreePath: '/repo/.worktrees/feat-x', branchName: 'feat-x' });
  });

  it('shows Recreate worktree + Continue in project root + Delete, and no Continue here', () => {
    render(<DegradedChatCard />);
    expect(screen.getByTestId('chat-degraded-card')).toBeInTheDocument();
    expect(screen.getByTestId('chat-degraded-recreate-worktree')).toBeInTheDocument();
    expect(screen.getByTestId('chat-degraded-project-root')).toBeInTheDocument();
    expect(screen.getByTestId('chat-degraded-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-degraded-continue')).toBeNull();
  });

  it('Recreate worktree POSTs the recreate route', async () => {
    render(<DegradedChatCard />);
    fireEvent.click(screen.getByTestId('chat-degraded-recreate-worktree'));
    await waitFor(() => expect(recreateChatWorktree).toHaveBeenCalledWith(31415, 'chat-9'));
  });

  it('Continue in project root POSTs the detach route', async () => {
    render(<DegradedChatCard />);
    fireEvent.click(screen.getByTestId('chat-degraded-project-root'));
    await waitFor(() => expect(continueChatInProjectRoot).toHaveBeenCalledWith(31415, 'chat-9'));
  });

  it('a failed recreate shows the error and falls back to project-root only', async () => {
    vi.mocked(recreateChatWorktree).mockRejectedValueOnce(new Error('Branch "feat-x" no longer exists'));
    render(<DegradedChatCard />);
    fireEvent.click(screen.getByTestId('chat-degraded-recreate-worktree'));

    await waitFor(() => expect(screen.getByTestId('chat-degraded-error')).toBeInTheDocument());
    expect(screen.getByTestId('chat-degraded-error').textContent).toContain('Branch "feat-x" no longer exists');
    expect(screen.queryByTestId('chat-degraded-recreate-worktree')).toBeNull();
    expect(screen.getByTestId('chat-degraded-project-root')).toBeInTheDocument();
  });
});

describe('DegradedChatCard — both causes', () => {
  beforeEach(() => {
    __chatConfig = chat({
      transcriptMissing: true,
      worktreeMissing: true,
      worktreePath: '/repo/.worktrees/feat-x',
      branchName: 'feat-x',
    });
  });

  it('lists both causes but merges Continue here into the worktree actions', () => {
    render(<DegradedChatCard />);
    expect(screen.getByTestId('chat-degraded-card')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-degraded-continue')).toBeNull();
    expect(screen.getByTestId('chat-degraded-recreate-worktree')).toBeInTheDocument();
    expect(screen.getByTestId('chat-degraded-project-root')).toBeInTheDocument();
    expect(screen.getByTestId('chat-degraded-delete')).toBeInTheDocument();
  });
});
