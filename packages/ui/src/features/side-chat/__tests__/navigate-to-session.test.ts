// @vitest-environment jsdom
/**
 * navigateToSession — routes a session-navigation request to its real target:
 * a side chat id resolves to its parent and expands the panel; anything else
 * switches directly (todo #344, UI rule 2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { __resetSideChatRegistryForTests, registerSideChat } from '../side-chat-ids';
import { useSideChatCollapseStore } from '../side-chat-collapse-store';
import { navigateToSession } from '../navigate-to-session';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-x',
    adapterId: 'claude',
    projectId: 'p1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    temporary: false,
    noProject: false,
    ...overrides,
  };
}

afterEach(() => {
  __resetSideChatRegistryForTests();
  window.localStorage.clear();
  useSideChatCollapseStore.setState({ collapsedByParent: {} });
});

describe('navigateToSession — a registered side chat id', () => {
  it('activates the parent, expands the panel, and never calls getChat', async () => {
    registerSideChat('chat-side-1', 'chat-parent');
    const switchToThread = vi.fn();
    const getChat = vi.fn();

    await navigateToSession('chat-side-1', { switchToThread, getChat });

    expect(switchToThread).toHaveBeenCalledWith('chat-parent');
    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent')).toBe(false);
    expect(getChat).not.toHaveBeenCalled();
  });
});

describe('navigateToSession — an unregistered id resolved via getChat', () => {
  it('routes to the parent when getChat reveals a side chat', async () => {
    const switchToThread = vi.fn();
    const getChat = vi
      .fn()
      .mockResolvedValue(makeChat({ id: 'chat-side-2', temporary: true, parentChatId: 'chat-parent-2' }));

    await navigateToSession('chat-side-2', { switchToThread, getChat });

    expect(getChat).toHaveBeenCalledWith('chat-side-2');
    expect(switchToThread).toHaveBeenCalledWith('chat-parent-2');
    expect(useSideChatCollapseStore.getState().isCollapsed('chat-parent-2')).toBe(false);
  });

  it('switches to the id directly when getChat reveals a regular chat', async () => {
    const switchToThread = vi.fn();
    const getChat = vi.fn().mockResolvedValue(makeChat({ id: 'chat-regular' }));

    await navigateToSession('chat-regular', { switchToThread, getChat });

    expect(switchToThread).toHaveBeenCalledWith('chat-regular');
  });

  it('falls back to a plain switch when getChat rejects (unknown id or unreachable daemon)', async () => {
    const switchToThread = vi.fn();
    const getChat = vi.fn().mockRejectedValue(new Error('not found'));

    await navigateToSession('chat-unknown', { switchToThread, getChat });

    expect(switchToThread).toHaveBeenCalledWith('chat-unknown');
  });
});
