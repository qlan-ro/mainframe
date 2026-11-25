/**
 * SideChatTabBody — the side chat in its workspace tab: the identity its thread
 * reads, and the one action that deletes it, which asks first.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useConfirmBridge } from '@/lib/confirm-bridge';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useLayoutStore } from '@/store/layout';
import { onSurfaceIntent } from '@/store/surface-intents';

vi.mock('@assistant-ui/react', () => ({
  AuiProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useAui: () => ({}),
  useAuiState: (select: (s: unknown) => unknown) =>
    select({
      thread: {},
      threads: {
        threadItems: [
          { id: 'parent-1', title: 'Fix the parser', custom: { projectId: 'p1', worktreePath: '/wt/parent' } },
        ],
      },
    }),
}));
vi.mock('@/features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [{ id: 'p1', path: '/proj' }] }),
}));
const discardChat = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/lib/api/chats', () => ({ discardChat: (...args: unknown[]) => discardChat(...args) }));
const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({ mfToast: { error: (message: string) => toastError(message) } }));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { getOrCreate: () => ({}) },
}));
vi.mock('../use-conversation-thread', () => ({ useConversationThread: () => ({}) }));
vi.mock('../DraftKeeper', () => ({
  DraftKeeper: ({ chatId }: { chatId: string }) => <div data-testid={`keeper-${chatId}`} />,
}));
vi.mock('@/features/side-chat/SideChatNotice', () => ({
  SideChatNotice: ({ parentChatId }: { parentChatId: string }) => <div data-testid={`notice-${parentChatId}`} />,
}));
vi.mock('@/features/chat/thread/ChatThread', async () => {
  const { useSideChatScope } = await import('@/features/side-chat/side-chat-scope');
  const { useOpenFile } = await import('@/features/chat/tools/chat-tool-context');
  return {
    ChatThread: ({ variant }: { variant?: string }) => {
      const scope = useSideChatScope();
      const { openFile } = useOpenFile();
      return (
        <button type="button" data-testid="thread" onClick={() => openFile('src/a.ts')}>
          {`${variant}:${scope?.parentChatId}:${scope?.sideChatId}`}
        </button>
      );
    },
  };
});

import {
  __resetSideChatRegistryForTests,
  isRegisteredSideChatId,
  registerSideChat,
} from '@/features/side-chat/side-chat-ids';
import { SideChatTabBody } from '../SideChatTabBody';

const open = () => useLayoutStore.getState().run?.panes.flatMap((p) => p.tabs.map((t) => t.chatId)) ?? [];

function show() {
  render(
    <TooltipProvider>
      <SideChatTabBody chatId="side-1" active />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  discardChat.mockReset().mockResolvedValue(undefined);
  toastError.mockClear();
  __resetSideChatRegistryForTests();
  registerSideChat('side-1', 'parent-1');
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: 'parent-1',
  });
  useLayoutStore
    .getState()
    .addRunTab({ id: 'chat-side-1', kind: 'chat', title: 'Side chat', chatId: 'side-1', role: 'side' });
});

it('gives its thread the side chat’s identity, and names its parent', () => {
  show();
  expect(screen.getByTestId('thread')).toHaveTextContent('side:parent-1:side-1');
  expect(screen.getByTestId('side-chat-header-side-1')).toHaveTextContent('Beside “Fix the parser”');
  expect(screen.getByTestId('keeper-side-1')).toBeInTheDocument();
  expect(screen.getByTestId('notice-parent-1')).toBeInTheDocument();
});

it('takes the session on screen for its parent until the list names it', () => {
  __resetSideChatRegistryForTests();
  show();
  expect(screen.getByTestId('thread')).toHaveTextContent('side:parent-1:side-1');
});

it('opens its parent’s files, whichever worktree the conversation is in', () => {
  useActiveBasesStore.setState({ bases: { worktreePath: '/wt/column', projectPath: '/proj' }, scopeKey: null });
  const paths: string[] = [];
  const stop = onSurfaceIntent((intent) => intent.type === 'open-file' && paths.push(intent.path));
  show();
  fireEvent.click(screen.getByTestId('thread'));
  stop();
  expect(paths).toEqual(['/wt/parent/src/a.ts']);
});

describe('Discard', () => {
  const press = () => fireEvent.click(screen.getByTestId('side-chat-discard-side-1'));
  const answer = (ok: boolean) => act(async () => useConfirmBridge.getState().resolve(ok));

  it('deletes the side chat and its tab once confirmed', async () => {
    show();
    press();
    expect(discardChat).not.toHaveBeenCalled();
    await answer(true);
    expect(discardChat).toHaveBeenCalledWith(31415, 'side-1');
    expect(isRegisteredSideChatId('side-1')).toBe(false);
    expect(open()).toEqual([]);
  });

  it('keeps everything when cancelled', async () => {
    show();
    press();
    await answer(false);
    expect(discardChat).not.toHaveBeenCalled();
    expect(open()).toEqual(['side-1']);
  });

  it('keeps the tab and says why when it fails', async () => {
    discardChat.mockRejectedValue(new Error('daemon is away'));
    show();
    press();
    await answer(true);
    expect(toastError).toHaveBeenCalledWith('daemon is away');
    expect(open()).toEqual(['side-1']);
    expect(isRegisteredSideChatId('side-1')).toBe(true);
  });
});
