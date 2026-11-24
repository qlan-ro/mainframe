/**
 * ChatTabBody — a listed chat in a workspace tab: what its header offers for a
 * fork, a session and a delegated task, and what stands in while it has no chat
 * to show. The thread binding is stubbed; DraftKeeper.test runs the real one.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { ChatTabRole, RunTab } from '@/store/run-pane';
import { onSurfaceIntent } from '@/store/surface-intents';

interface Item {
  id: string;
  remoteId?: string;
  title?: string;
  status: string;
  custom: Partial<SessionCustom>;
}
let items: Item[] = [];
let mainThreadId = 'main';
const switchToThread = vi.fn();
vi.mock('@assistant-ui/react', () => ({
  AuiProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useAui: () => ({ threads: { switchToThread } }),
  useAuiState: (select: (s: unknown) => unknown) =>
    select({ threads: { threadItems: items, mainThreadId }, threadListItem: items[0] }),
}));
const cancelDelegatedTask = vi.fn(async (..._args: string[]) => undefined);
vi.mock('@/lib/api/background-tasks', () => ({
  cancelDelegatedTask: (...args: string[]) => cancelDelegatedTask(...args),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
const getOrCreate = vi.fn((_id: string) => ({}));
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { getOrCreate: (id: string) => getOrCreate(id) },
}));
let identity: { worktreePath?: string; projectPath?: string } = {};
vi.mock('@/features/sessions/use-active-identity', () => ({ useActiveIdentity: () => identity }));
vi.mock('../use-conversation-thread', () => ({ useConversationThread: () => ({}) }));
vi.mock('../DraftKeeper', () => ({
  DraftKeeper: ({ chatId }: { chatId: string }) => <div data-testid={`keeper-${chatId}`} />,
}));
vi.mock('@/features/chat/thread/ChatThread', async () => {
  const { useOpenFile } = await import('@/features/chat/tools/chat-tool-context');
  return {
    ChatThread: () => {
      const { openFile } = useOpenFile();
      return <button type="button" data-testid="thread" onClick={() => openFile('src/a.ts')} />;
    },
  };
});
vi.mock('@/features/chat/thread/ChatHeaderParentLink', () => ({
  ChatHeaderParentLink: () => <span>Forked from Main</span>,
}));
vi.mock('@/features/side-chat/SideChatToggle', () => ({ SideChatToggle: () => <div data-testid="side-toggle" /> }));
vi.mock('@/features/side-chat/use-side-chat-tab', () => ({ useSideChatTab: () => undefined }));

import { ChatTabBody } from '../ChatTabBody';
import { useMountedConversations } from '../mounted-conversations';

const tab = (role: ChatTabRole): RunTab => ({
  id: 'chat-kid',
  kind: 'chat',
  title: 'Saved title',
  chatId: 'kid',
  role,
});
function list(custom: Partial<SessionCustom> = {}, over: Partial<Item> = {}) {
  items = [
    {
      id: 'kid',
      remoteId: 'kid',
      title: 'Race review',
      status: 'regular',
      custom: { adapterId: 'codex', ...custom },
      ...over,
    },
  ];
}
function show(role: ChatTabRole = 'fork', active = true) {
  return render(
    <TooltipProvider>
      <ChatTabBody tab={tab(role)} chatId="kid" active={active} />
    </TooltipProvider>,
  );
}
const header = () => screen.getByTestId('workspace-chat-header-kid');

beforeEach(() => {
  items = [];
  mainThreadId = 'main';
  identity = {};
  switchToThread.mockClear();
  cancelDelegatedTask.mockClear();
  getOrCreate.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('a fork', () => {
  it('is the whole chat, under its live title, naming its parent', () => {
    list({ parentChatId: 'main' });
    show('fork');
    expect(header()).toHaveTextContent('Race review');
    expect(header()).toHaveTextContent('Forked from Main');
    expect(screen.getByTestId('thread')).toBeInTheDocument();
    expect(screen.getByTestId('keeper-kid')).toBeInTheDocument();
    expect(screen.getByTestId('side-toggle')).toBeInTheDocument();
  });

  it('can move to the chat column', () => {
    list();
    show('fork');
    fireEvent.click(screen.getByTestId('workspace-chat-promote-kid'));
    expect(switchToThread).toHaveBeenCalledWith('kid');
  });
});

describe('a delegated task (T1c)', () => {
  const task = (status: string): Partial<SessionCustom> =>
    ({ parentChatId: 'main', delegation: { taskId: 'task-1', role: 'review', status } }) as Partial<SessionCustom>;

  it('names its provider and its status, and stops on its parent’s behalf', () => {
    list(task('running'));
    show('task');
    expect(header()).toHaveTextContent('Delegated task · codex');
    expect(screen.getByTestId('workspace-chat-status-kid').dataset.status).toBe('running');

    fireEvent.click(screen.getByTestId('workspace-chat-stop-kid'));
    expect(cancelDelegatedTask).toHaveBeenCalledWith('main', 'task-1');
  });

  it.each([
    ['queued', {}, 'queued', true],
    ['waiting', {}, 'needs-you', true],
    ['running', { hasPending: true }, 'needs-you', true],
    ['completed', {}, 'completed', false],
    ['failed', {}, 'failed', false],
    ['interrupted', {}, 'stopped', false],
  ])('%s %j reads as %s', (status, extra, shown, stoppable) => {
    list({ ...task(status), ...extra });
    show('task');
    expect(screen.getByTestId('workspace-chat-status-kid').dataset.status).toBe(shown);
    expect(screen.queryByTestId('workspace-chat-stop-kid') != null).toBe(stoppable);
  });

  it('has no side chat of its own', () => {
    list(task('running'));
    show('task');
    expect(screen.queryByTestId('side-toggle')).toBeNull();
  });
});

describe('with no chat to show', () => {
  it('waits for a new fork to reach the list, then calls it gone', () => {
    vi.useFakeTimers();
    show();
    expect(screen.getByRole('status')).toHaveTextContent('Opening the chat…');
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole('status')).toHaveTextContent('This chat is no longer here.');
  });

  it('shows the chat as soon as it is listed', () => {
    const view = show();
    list();
    view.rerender(
      <TooltipProvider>
        <ChatTabBody tab={tab('fork')} chatId="kid" active />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('thread')).toBeInTheDocument();
  });

  it('steps aside once the chat is the conversation', () => {
    list();
    mainThreadId = 'kid';
    show();
    expect(screen.queryByTestId('thread')).toBeNull();
    expect(useMountedConversations.getState().composing.has('kid')).toBe(false);
  });
});

describe('a file link in its transcript', () => {
  it('opens this chat’s own file, not the conversation’s file at the same path', () => {
    identity = { worktreePath: '/wt/kid', projectPath: '/proj' };
    const paths: string[] = [];
    const stop = onSurfaceIntent((intent) => intent.type === 'open-file' && paths.push(intent.path));
    list();
    show();
    fireEvent.click(screen.getByTestId('thread'));
    stop();
    expect(paths).toEqual(['/wt/kid/src/a.ts']);
  });
});

describe('what it declares', () => {
  it('has the composer and is viewed while in front, under both ids', () => {
    list({}, { id: '__LOCALID_1', remoteId: 'kid' });
    const view = show();
    const { composing, viewed, held } = useMountedConversations.getState();
    for (const set of [composing, viewed, held]) expect([...set].sort()).toEqual(['__LOCALID_1', 'kid']);
    view.unmount();
    expect(useMountedConversations.getState().composing.size).toBe(0);
  });

  it('keeps the composer, but is not viewed, behind another tab', () => {
    list();
    show('fork', false);
    expect(useMountedConversations.getState().composing.has('kid')).toBe(true);
    expect(useMountedConversations.getState().viewed.has('kid')).toBe(false);
  });
});
