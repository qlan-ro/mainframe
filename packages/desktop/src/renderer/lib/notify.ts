import { toast } from './toast';
import { isAppFocused } from './app-focus';
import { useChatsStore } from '../store/chats';
import { createLogger } from './logger';

const log = createLogger('renderer:notify');

interface NotifyOptions {
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  body?: string;
  chatId?: string;
}

export function notify(opts: NotifyOptions): void {
  const store = useChatsStore.getState();
  const isViewingChat = opts.chatId && isAppFocused() && store.activeChatId === opts.chatId;

  // Mark as unread unless the user is focused and viewing this exact chat
  if (opts.chatId && !isViewingChat) {
    store.markUnread(opts.chatId);
  }

  if (isAppFocused()) {
    if (!isViewingChat) {
      toast[opts.type](opts.title, opts.body, opts.chatId);
    }
  } else {
    showSystemNotification(opts);
  }
}

function showSystemNotification(opts: NotifyOptions): void {
  try {
    const mf = (window as { mainframe?: { showNotification?: (t: string, b?: string) => Promise<void> } }).mainframe;
    if (mf?.showNotification) {
      mf.showNotification(opts.title, opts.body);
    } else {
      // Fallback for web-only mode (dev:web without Electron shell)
      new Notification(opts.title, { body: opts.body });
    }
  } catch (err) {
    log.warn('system notification failed', { error: String(err) });
  }
}
