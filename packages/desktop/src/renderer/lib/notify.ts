import { toast } from './toast';
import { isAppFocused } from './app-focus';
import { useChatsStore } from '../store/chats';
import { createLogger } from './logger';

const log = createLogger('renderer:notify');

interface NotifyOptions {
  type: 'success' | 'error' | 'info';
  title: string;
  body?: string;
  chatId?: string;
}

export function notify(opts: NotifyOptions): void {
  if (isAppFocused()) {
    // Suppress in-app toast if user is already viewing this chat
    const isViewingChat = opts.chatId && useChatsStore.getState().activeChatId === opts.chatId;
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
