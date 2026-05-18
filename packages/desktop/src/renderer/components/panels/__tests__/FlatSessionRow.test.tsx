import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';

// vi.hoisted runs before vi.mock factories are executed, so these variables
// are safe to reference inside factory closures.
const {
  mockRemoveChat,
  mockAddChat,
  mockSetActiveChat,
  mockDeleteDraft,
  tabsMockCloseTab,
  tabsMockOpenChatTab,
  tabsMockUpdateTabLabel,
  getActiveChatId,
  setActiveChatIdInner,
  getChats,
  setChatsInner,
} = vi.hoisted(() => {
  let activeChatId = 'chat-1';
  let chats: any[] = [];
  return {
    mockRemoveChat: vi.fn(),
    mockAddChat: vi.fn(),
    mockSetActiveChat: vi.fn(),
    mockDeleteDraft: vi.fn(),
    tabsMockCloseTab: vi.fn(),
    tabsMockOpenChatTab: vi.fn(),
    tabsMockUpdateTabLabel: vi.fn(),
    getActiveChatId: () => activeChatId,
    setActiveChatIdInner: (id: string) => {
      activeChatId = id;
    },
    getChats: () => chats,
    setChatsInner: (c: any[]) => {
      chats = c;
    },
  };
});

// --- mock ../../lib/api ---
vi.mock('../../../lib/api', () => ({
  archiveChat: vi.fn(),
  renameChat: vi.fn().mockResolvedValue(undefined),
}));

// --- mock store ---
vi.mock('../../../store', () => ({
  useChatsStore: (sel: (s: any) => any) =>
    sel({
      get activeChatId() {
        return getActiveChatId();
      },
      get chats() {
        return getChats();
      },
      setActiveChat: mockSetActiveChat,
      removeChat: mockRemoveChat,
      addChat: mockAddChat,
      updateChat: vi.fn(),
      unreadChatIds: new Set<string>(),
      detectedPrs: new Map<string, any[]>(),
    }),
}));

// --- mock tabs store ---
vi.mock('../../../store/tabs', () => ({
  useTabsStore: Object.assign(
    vi.fn((sel: (s: any) => any) => sel({ openChatTab: tabsMockOpenChatTab })),
    {
      getState: vi.fn(() => ({
        closeTab: tabsMockCloseTab,
        openChatTab: tabsMockOpenChatTab,
        updateTabLabel: tabsMockUpdateTabLabel,
      })),
    },
  ),
}));

// --- mock tags store ---
vi.mock('../../../store/tags', () => ({
  useTagsStore: (sel: (s: any) => any) => sel({ registry: [] }),
}));

// --- mock adapters store ---
vi.mock('../../../store/adapters', () => ({
  useAdaptersStore: (sel: (s: any) => any) => sel({ adapters: [] }),
}));

// --- mock daemonClient ---
vi.mock('../../../lib/client', () => ({
  daemonClient: { resumeChat: vi.fn() },
}));

// --- mock adapters lib ---
vi.mock('../../../lib/adapters', () => ({
  getAdapterLabel: () => 'Claude',
}));

// --- mock logger ---
vi.mock('../../../lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// --- mock composer-drafts ---
vi.mock('../../chat/assistant-ui/composer/composer-drafts.js', () => ({
  deleteDraft: mockDeleteDraft,
}));

// --- mock UI components that need complex context ---
vi.mock('../../tags/TagPill', () => ({
  TagPill: () => null,
}));
vi.mock('../../tags/TagPopover', () => ({
  TagPopover: () => null,
}));
vi.mock('../../ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import React from 'react';
import { FlatSessionRow } from '../FlatSessionRow';
import { archiveChat } from '../../../lib/api';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    projectId: 'proj-1',
    title: 'Test Session',
    status: 'active',
    adapterId: 'claude',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setActiveChatIdInner('chat-1');
  setChatsInner([]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('FlatSessionRow: non-optimistic archive', () => {
  it('does NOT call removeChat on click; row stays rendered; spinner shown', async () => {
    // archiveChat hangs — never resolves during this assertion
    let resolve!: () => void;
    vi.mocked(archiveChat).mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const chat = makeChat({ worktreePath: undefined });
    render(<FlatSessionRow chat={chat} />);

    expect(screen.getByTestId('chat-list-item')).toBeInTheDocument();

    const archiveBtn = screen.getByRole('button', { name: /archive session/i });
    await userEvent.click(archiveBtn);

    // Nothing must have been removed yet
    expect(mockRemoveChat).not.toHaveBeenCalled();
    expect(mockDeleteDraft).not.toHaveBeenCalled();
    expect(tabsMockCloseTab).not.toHaveBeenCalled();

    // Row still in the DOM
    expect(screen.getByTestId('chat-list-item')).toBeInTheDocument();

    // Spinner visible — archive button shows Loader2.animate-spin while in-flight
    expect(archiveBtn.querySelector('.animate-spin')).not.toBeNull();

    // Cleanup
    await act(async () => {
      resolve();
      await Promise.resolve();
    });
  });

  it('calls removeChat, deleteDraft, closeTab only AFTER archiveChat resolves', async () => {
    let resolve!: () => void;
    vi.mocked(archiveChat).mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const chat = makeChat({ worktreePath: undefined });
    render(<FlatSessionRow chat={chat} />);

    const archiveBtn = screen.getByRole('button', { name: /archive session/i });
    await userEvent.click(archiveBtn);

    expect(mockRemoveChat).not.toHaveBeenCalled();

    await act(async () => {
      resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRemoveChat).toHaveBeenCalledWith('chat-1');
    expect(mockDeleteDraft).toHaveBeenCalledWith('chat-1');
    expect(tabsMockCloseTab).toHaveBeenCalledWith('chat:chat-1');
  });

  it('switches to next session only AFTER resolve when archived chat was the active one', async () => {
    const nextChat: Chat = makeChat({ id: 'chat-2', title: 'Next Session', updatedAt: '2026-01-03T00:00:00Z' });
    setChatsInner([nextChat]);
    setActiveChatIdInner('chat-1');

    let resolve!: () => void;
    vi.mocked(archiveChat).mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const chat = makeChat({ worktreePath: undefined });
    render(<FlatSessionRow chat={chat} />);

    const archiveBtn = screen.getByRole('button', { name: /archive session/i });
    await userEvent.click(archiveBtn);

    // Must not have switched yet
    expect(mockSetActiveChat).not.toHaveBeenCalled();
    expect(tabsMockOpenChatTab).not.toHaveBeenCalled();

    await act(async () => {
      resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSetActiveChat).toHaveBeenCalledWith('chat-2');
    expect(tabsMockOpenChatTab).toHaveBeenCalledWith('chat-2', 'Next Session');
  });

  it('on rejection: removeChat never called, spinner gone, button re-enabled, no addChat restore', async () => {
    let reject!: (err: Error) => void;
    vi.mocked(archiveChat).mockReturnValue(
      new Promise<void>((_, r) => {
        reject = r;
      }),
    );

    const chat = makeChat({ worktreePath: undefined });
    render(<FlatSessionRow chat={chat} />);

    const archiveBtn = screen.getByRole('button', { name: /archive session/i });
    await userEvent.click(archiveBtn);

    // Spinner present while in-flight
    expect(archiveBtn.querySelector('.animate-spin')).not.toBeNull();

    await act(async () => {
      reject(new Error('network error'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Nothing was removed — row stays for retry
    expect(mockRemoveChat).not.toHaveBeenCalled();
    expect(mockAddChat).not.toHaveBeenCalled();
    expect(mockDeleteDraft).not.toHaveBeenCalled();

    // Spinner gone, button re-enabled
    expect(archiveBtn.querySelector('.animate-spin')).toBeNull();
    expect(archiveBtn).not.toBeDisabled();
  });
});
