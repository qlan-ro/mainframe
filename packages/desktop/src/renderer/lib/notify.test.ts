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
    })),
  },
}));

vi.mock('../store/tabs', () => ({
  useTabsStore: {
    getState: vi.fn(() => ({ openChatTab: vi.fn() })),
  },
}));

import { isAppFocused } from './app-focus';
import { toast } from './toast';

const mockIsAppFocused = vi.mocked(isAppFocused);

describe('notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAppFocused.mockReturnValue(true);
  });

  it('shows in-app toast when focused', () => {
    notify({ type: 'success', title: 'Done', body: 'Finished', chatId: 'chat-1' });
    expect(toast.success).toHaveBeenCalledWith('Done', 'Finished', 'chat-1');
  });

  it('shows system notification when not focused', () => {
    mockIsAppFocused.mockReturnValue(false);
    const MockNotification = vi.fn();
    vi.stubGlobal('Notification', MockNotification);

    notify({ type: 'info', title: 'Permission', body: 'Agent wants to run: Bash' });

    expect(MockNotification).toHaveBeenCalledWith('Permission', { body: 'Agent wants to run: Bash' });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('suppresses when user is viewing the triggering chat', () => {
    notify({ type: 'success', title: 'Done', chatId: 'active-chat' });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does not suppress when chatId differs from active chat', () => {
    notify({ type: 'success', title: 'Done', chatId: 'other-chat' });
    expect(toast.success).toHaveBeenCalled();
  });

  it('does not suppress when no chatId provided', () => {
    notify({ type: 'info', title: 'Plugin says hi' });
    expect(toast.info).toHaveBeenCalledWith('Plugin says hi', undefined, undefined);
  });
});
