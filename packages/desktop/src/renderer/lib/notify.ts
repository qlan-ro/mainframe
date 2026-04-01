import { toast } from './toast';
import { isAppFocused } from './app-focus';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { createLogger } from './logger';

const log = createLogger('renderer:notify');

interface NotifyOptions {
  type: 'success' | 'error' | 'info';
  title: string;
  body?: string;
  chatId?: string;
}

export function notify(opts: NotifyOptions): void {
  if (opts.chatId && useChatsStore.getState().activeChatId === opts.chatId) return;

  if (isAppFocused()) {
    toast[opts.type](opts.title, opts.body, opts.chatId);
  } else {
    showSystemNotification(opts);
  }
}

function showSystemNotification(opts: NotifyOptions): void {
  try {
    const n = new Notification(opts.title, { body: opts.body });
    if (opts.chatId) {
      const chatId = opts.chatId;
      n.onclick = (): void => {
        window.focus();
        const chat = useChatsStore.getState().chats.find((c) => c.id === chatId);
        useChatsStore.getState().setActiveChat(chatId);
        useTabsStore.getState().openChatTab(chatId, chat?.title);
      };
    }
  } catch (err) {
    log.warn('system notification failed', { error: String(err) });
  }
}
