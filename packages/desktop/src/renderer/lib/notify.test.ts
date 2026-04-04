import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notify } from './notify';

vi.mock('./app-focus', () => ({
  isAppFocused: vi.fn(() => true),
}));

vi.mock('./toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../store/chats', () => ({
  useChatsStore: {
    getState: vi.fn(() => ({
      activeChatId: 'active-chat',
      chats: [{ id: 'chat-1', title: 'My Chat' }],
      setActiveChat: vi.fn(),
      markUnread: vi.fn(),
    })),
  },
}));

import { isAppFocused } from './app-focus';
import { toast } from './toast';
import { useChatsStore } from '../store/chats';

const mockIsAppFocused = vi.mocked(isAppFocused);

describe('notify', () => {
  const mockShowNotification = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAppFocused.mockReturnValue(true);
    (window as { mainframe?: unknown }).mainframe = { showNotification: mockShowNotification };
  });

  it('shows in-app toast when focused', () => {
    notify({ type: 'success', title: 'Done', body: 'Finished', chatId: 'chat-1' });
    expect(toast.success).toHaveBeenCalledWith('Done', 'Finished', 'chat-1');
  });

  it('uses IPC showNotification when not focused', () => {
    mockIsAppFocused.mockReturnValue(false);

    notify({ type: 'info', title: 'Permission', body: 'Agent wants to run: Bash' });

    expect(mockShowNotification).toHaveBeenCalledWith('Permission', 'Agent wants to run: Bash');
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('falls back to Web Notification API without Electron', () => {
    mockIsAppFocused.mockReturnValue(false);
    (window as { mainframe?: unknown }).mainframe = {};
    const MockNotification = vi.fn();
    vi.stubGlobal('Notification', MockNotification);

    notify({ type: 'info', title: 'Permission', body: 'Agent wants to run: Bash' });

    expect(MockNotification).toHaveBeenCalledWith('Permission', { body: 'Agent wants to run: Bash' });
  });

  it('suppresses toast when user is viewing the triggering chat', () => {
    notify({ type: 'success', title: 'Done', chatId: 'active-chat' });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('still sends system notification for active chat when unfocused', () => {
    mockIsAppFocused.mockReturnValue(false);
    notify({ type: 'success', title: 'Done', chatId: 'active-chat' });
    expect(mockShowNotification).toHaveBeenCalledWith('Done', undefined);
  });

  it('does not suppress when chatId differs from active chat', () => {
    notify({ type: 'success', title: 'Done', chatId: 'other-chat' });
    expect(toast.success).toHaveBeenCalled();
  });

  it('does not suppress when no chatId provided', () => {
    notify({ type: 'info', title: 'Plugin says hi' });
    expect(toast.info).toHaveBeenCalledWith('Plugin says hi', undefined, undefined);
  });

  it('marks chat as unread when notifying', () => {
    const mockMarkUnread = vi.fn();
    vi.mocked(useChatsStore.getState).mockReturnValue({
      activeChatId: null,
      chats: [],
      setActiveChat: vi.fn(),
      markUnread: mockMarkUnread,
    } as any);
    mockIsAppFocused.mockReturnValue(true);

    notify({ type: 'success', title: 'Done', chatId: 'chat-1' });
    expect(mockMarkUnread).toHaveBeenCalledWith('chat-1');
  });

  it('does not mark unread when viewing that chat and focused', () => {
    const mockMarkUnread = vi.fn();
    vi.mocked(useChatsStore.getState).mockReturnValue({
      activeChatId: 'active-chat',
      chats: [],
      setActiveChat: vi.fn(),
      markUnread: mockMarkUnread,
    } as any);
    mockIsAppFocused.mockReturnValue(true);

    notify({ type: 'success', title: 'Done', chatId: 'active-chat' });
    expect(mockMarkUnread).not.toHaveBeenCalled();
  });

  it('marks unread even when app is unfocused', () => {
    const mockMarkUnread = vi.fn();
    vi.mocked(useChatsStore.getState).mockReturnValue({
      activeChatId: 'active-chat',
      chats: [],
      setActiveChat: vi.fn(),
      markUnread: mockMarkUnread,
    } as any);
    mockIsAppFocused.mockReturnValue(false);

    notify({ type: 'success', title: 'Done', chatId: 'chat-1' });
    expect(mockMarkUnread).toHaveBeenCalledWith('chat-1');
  });
});
