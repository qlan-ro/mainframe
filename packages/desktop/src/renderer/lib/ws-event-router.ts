import type { DaemonEvent } from '@mainframe/types';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { useProjectsStore } from '../store/projects';
import { useSandboxStore } from '../store/sandbox';
import { createLogger } from './logger';

const log = createLogger('renderer:ws');

export function routeEvent(event: DaemonEvent): void {
  const chats = useChatsStore.getState();
  const tabs = useTabsStore.getState();

  switch (event.type) {
    case 'chat.created':
      log.info('event:chat.created', { chatId: event.chat.id, title: event.chat.title });
      chats.addChat(event.chat);
      chats.setActiveChat(event.chat.id);
      tabs.openChatTab(event.chat.id, event.chat.title);
      break;
    case 'chat.updated':
      log.debug('event:chat.updated', { chatId: event.chat.id });
      chats.updateChat(event.chat);
      if (event.chat.title) {
        tabs.updateTabLabel(`chat:${event.chat.id}`, event.chat.title);
      }
      break;
    case 'chat.ended':
      log.info('event:chat.ended', { chatId: event.chatId });
      chats.removeChat(event.chatId);
      chats.removeProcess(event.chatId);
      break;
    case 'display.message.added':
      log.debug('event:display.message.added', { chatId: event.chatId });
      chats.addMessage(event.chatId, event.message);
      break;
    case 'display.message.updated':
      log.debug('event:display.message.updated', { chatId: event.chatId, messageId: event.message.id });
      chats.updateMessage(event.chatId, event.message);
      break;
    case 'display.messages.set':
      log.debug('event:display.messages.set', { chatId: event.chatId, count: event.messages.length });
      chats.setMessages(event.chatId, event.messages);
      break;
    case 'messages.cleared':
      log.info('event:messages.cleared', { chatId: event.chatId });
      chats.setMessages(event.chatId, []);
      break;
    case 'permission.requested':
      log.info('event:permission.requested', {
        chatId: event.chatId,
        requestId: event.request.requestId,
        toolName: event.request.toolName,
      });
      chats.addPendingPermission(event.chatId, event.request);
      break;
    case 'context.updated':
      log.debug('event:context.updated', { chatId: event.chatId });
      break;
    case 'process.started':
      log.info('event:process.started', { chatId: event.chatId, processId: event.process.id });
      chats.setProcess(event.chatId, event.process);
      break;
    case 'process.ready':
      log.info('event:process.ready', { processId: event.processId, claudeSessionId: event.claudeSessionId });
      chats.updateProcessStatus(event.processId, 'ready');
      break;
    case 'process.stopped':
      log.info('event:process.stopped', { processId: event.processId });
      chats.updateProcessStatus(event.processId, 'stopped');
      break;
    case 'launch.output':
      useSandboxStore.getState().appendLog(event.projectId, event.name, event.data, event.stream);
      break;
    case 'launch.status':
      useSandboxStore.getState().setProcessStatus(event.projectId, event.name, event.status);
      break;
    case 'error':
      log.error('daemon error event', { error: event.error });
      useProjectsStore.getState().setError(event.error);
      break;
  }
}
