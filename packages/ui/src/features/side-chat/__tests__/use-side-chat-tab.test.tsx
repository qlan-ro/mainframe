/**
 * useSideChatTab — a side chat and its workspace tab (W9), including the upgrade
 * from the panel that used to sit beside the thread: one that was showing opens
 * as a tab, one that was folded away stays closed, and either way the side chat
 * itself is untouched.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import type { RunTab } from '@/store/run-pane';
import { useSessionListLoadState } from '@/features/sessions/runtime/list-load-state';
import { __resetSideChatRegistryForTests, registerSideChat } from '../side-chat-ids';

let chatConfig: { id: string; sideChatId?: string | null } | null = null;
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => (chatConfig ? { state: { chatConfig } } : undefined),
}));
const keptAttached = vi.fn();
vi.mock('@/features/workspace-chat/use-conversation-thread', () => ({
  useKeepAttached: (controller: unknown) => keptAttached(controller),
}));
let gatePending = false;
vi.mock('../use-side-chat-controller', () => ({
  useSideChatController: (id: string | null | undefined) => (id == null ? null : `controller:${id}`),
  useOptionalControllerState: (controller: unknown) => (controller == null ? null : { gatePending }),
  hasPendingGate: (state: { gatePending: boolean }) => state.gatePending,
}));

import { useSideChatTab } from '../use-side-chat-tab';

const PARENT = 'parent-1';
const side = (chatId: string): RunTab => ({
  id: `chat-${chatId}`,
  kind: 'chat',
  title: 'Side chat',
  chatId,
  role: 'side',
});
const open = () => useLayoutStore.getState().run?.panes.flatMap((p) => p.tabs.map((t) => t.chatId ?? t.id)) ?? [];
const front = () => useLayoutStore.getState().run?.panes[0]?.active ?? null;
const closeTab = (chatId: string) => {
  const { run, closeRunTab } = useLayoutStore.getState();
  closeRunTab(run!.panes[0]!.id, `chat-${chatId}`);
};

function follow(parentChatId: string | null = PARENT) {
  return renderHook(
    ({ parent }: { parent: string | null }) => useSideChatTab({ parentChatId: parent, sessionId: parent }),
    { initialProps: { parent: parentChatId } },
  );
}

beforeEach(() => {
  chatConfig = { id: PARENT, sideChatId: 'side-1' };
  gatePending = false;
  keptAttached.mockClear();
  localStorage.clear();
  document.body.innerHTML = '';
  __resetSideChatRegistryForTests();
  registerSideChat('side-1', PARENT);
  useSessionListLoadState.setState({ loaded: true });
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: PARENT,
  });
});

describe('upgrade from the side-chat panel', () => {
  it('opens a side chat whose panel was showing as a tab, in front', () => {
    follow();
    expect(open()).toEqual(['side-1']);
    expect(useLayoutStore.getState().layout.top).toEqual(['chat', 'workspace']);
  });

  it('opens it too when the panel had been folded and shown again', () => {
    localStorage.setItem(`mf:side-chat-collapsed:${PARENT}`, 'false');
    follow();
    expect(open()).toEqual(['side-1']);
  });

  it('leaves one that was folded away closed, and still running: the header toggle shows it', () => {
    localStorage.setItem(`mf:side-chat-collapsed:${PARENT}`, 'true');
    follow();
    expect(open()).toEqual([]);
    expect(keptAttached).toHaveBeenLastCalledWith('controller:side-1');
  });

  it('decides once: the folded one does not open on the next visit either', () => {
    localStorage.setItem(`mf:side-chat-collapsed:${PARENT}`, 'true');
    follow().unmount();
    follow();
    expect(open()).toEqual([]);
  });

  it('keeps what the workspace already held', () => {
    useLayoutStore.getState().addRunTab({ id: 'code-1', kind: 'code', title: 'a.ts', path: 'a.ts' });
    follow();
    expect(open()).toEqual(['code-1', 'side-1']);
  });
});

describe('the tab is the user’s once it opened', () => {
  it('stays closed after they close it, on every later visit', () => {
    const first = follow();
    closeTab('side-1');
    first.rerender({ parent: PARENT });
    expect(open()).toEqual([]);

    first.unmount();
    follow();
    expect(open()).toEqual([]);
  });

  it('opens a new side chat of the same parent', () => {
    const view = follow();
    closeTab('side-1');
    registerSideChat('side-2', PARENT);
    chatConfig = { id: PARENT, sideChatId: 'side-2' };
    view.rerender({ parent: PARENT });
    expect(open()).toEqual(['side-2']);
  });
});

describe('a side chat that is gone', () => {
  it('takes its tab with it when another client discards it', () => {
    const view = follow();
    chatConfig = { id: PARENT, sideChatId: null };
    view.rerender({ parent: PARENT });
    expect(open()).toEqual([]);
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
  });

  it('takes a remembered tab with it when it went while the app was closed', () => {
    __resetSideChatRegistryForTests();
    chatConfig = { id: PARENT, sideChatId: null };
    useLayoutStore.getState().addRunTab(side('side-1'));
    follow();
    expect(open()).toEqual([]);
  });

  it('is not concluded before the parent or the session list has loaded', () => {
    __resetSideChatRegistryForTests();
    useLayoutStore.getState().addRunTab(side('side-1'));

    chatConfig = null;
    const view = follow();
    expect(open()).toEqual(['side-1']);

    chatConfig = { id: PARENT, sideChatId: null };
    act(() => useSessionListLoadState.setState({ loaded: false }));
    view.rerender({ parent: PARENT });
    expect(open()).toEqual(['side-1']);
  });

  it('is not concluded for one just opened here, whose parent has not been told yet', () => {
    chatConfig = { id: PARENT, sideChatId: null };
    const view = follow();
    act(() => useLayoutStore.getState().addSessionTab(PARENT, side('side-1')));
    view.rerender({ parent: PARENT });
    expect(open()).toEqual(['side-1']);
  });

  it('is not concluded from another session’s parent having none', () => {
    const view = follow();
    const other = { id: 'parent-2', sideChatId: null };
    chatConfig = other;
    // The conversation changed; the workspace follows a commit later.
    view.rerender({ parent: 'parent-2' });
    expect(open()).toEqual(['side-1']);

    act(() => useLayoutStore.getState().setActiveSession('parent-2'));
    act(() => useLayoutStore.getState().setActiveSession(PARENT));
    expect(open()).toEqual(['side-1']);
  });
});

describe('a side chat waiting on the user', () => {
  it('comes to the front, reopened if it was closed', () => {
    const view = follow();
    closeTab('side-1');
    act(() => void useLayoutStore.getState().addRunTab({ id: 'term', kind: 'terminal', title: 'zsh' }));
    gatePending = true;
    view.rerender({ parent: PARENT });
    expect(front()).toBe('chat-side-1');
  });

  it('does not take the workspace away from the keyboard', () => {
    const view = follow();
    act(() => void useLayoutStore.getState().addRunTab({ id: 'term', kind: 'terminal', title: 'zsh' }));
    document.body.innerHTML = '<div data-surface="workspace"><button id="typing"></button></div>';
    document.getElementById('typing')!.focus();
    gatePending = true;
    view.rerender({ parent: PARENT });
    expect(front()).toBe('term');
  });
});

it('does nothing for a draft', () => {
  chatConfig = null;
  follow(null);
  expect(open()).toEqual([]);
  expect(keptAttached).toHaveBeenLastCalledWith(null);
});
