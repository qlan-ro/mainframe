import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { useProjectsStore } from '../store/projects';
import { usePluginLayoutStore } from '../store/plugins';
import { useSandboxStore } from '../store/sandbox';
import { useAdaptersStore } from '../store/adapters';
import { createLogger } from './logger';
import { buildLaunchScope } from './launch-scope.js';
import { notify } from './notify';

const log = createLogger('renderer:ws');

export function routeEvent(event: DaemonEvent): void {
  const chats = useChatsStore.getState();
  const tabs = useTabsStore.getState();

  switch (event.type) {
    case 'chat.created':
      log.info('event:chat.created', { chatId: event.chat.id, title: event.chat.title, source: event.source });
      chats.addChat(event.chat);
      if (event.source !== 'import') {
        chats.setActiveChat(event.chat.id);
        tabs.openChatTab(event.chat.id, event.chat.title);
      }
      break;
    case 'chat.updated': {
      log.debug('event:chat.updated', { chatId: event.chat.id });
      chats.updateChat(event.chat);
      if (event.chat.title) {
        tabs.updateTabLabel(`chat:${event.chat.id}`, event.chat.title);
      }

      break;
    }
    case 'chat.notification': {
      const chat = chats.chats.find((c) => c.id === event.chatId);
      notify({
        type: event.level,
        title: chat?.title ?? event.title,
        body: event.body,
        chatId: event.chatId,
      });
      break;
    }
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
      {
        const chat = chats.chats.find((c) => c.id === event.chatId);
        notify({
          type: 'info',
          title: chat?.title ?? 'Session',
          body: 'Permission required',
          chatId: event.chatId,
        });
      }
      break;
    case 'permission.resolved': {
      log.info('event:permission.resolved', { chatId: event.chatId, requestId: event.requestId });
      const current = chats.pendingPermissions.get(event.chatId);
      if (current?.requestId === event.requestId) {
        chats.removePendingPermission(event.chatId);
      }
      break;
    }
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
      useSandboxStore
        .getState()
        .appendLog(buildLaunchScope(event.projectId, event.effectivePath), event.name, event.data, event.stream);
      break;
    case 'launch.status':
      useSandboxStore
        .getState()
        .setProcessStatus(buildLaunchScope(event.projectId, event.effectivePath), event.name, event.status);
      break;
    case 'launch.tunnel':
      log.debug('event:launch.tunnel', { projectId: event.projectId, name: event.name, url: event.url });
      break;
    case 'launch.tunnel.failed':
      log.warn('event:launch.tunnel.failed', { projectId: event.projectId, name: event.name, error: event.error });
      break;
    case 'launch.port.timeout':
      log.warn('event:launch.port.timeout', { projectId: event.projectId, name: event.name, port: event.port });
      break;
    case 'chat.compacting':
      log.debug('event:chat.compacting', { chatId: event.chatId });
      chats.setCompacting(event.chatId, true);
      break;
    case 'chat.compactDone':
      log.debug('event:chat.compactDone', { chatId: event.chatId });
      chats.setCompacting(event.chatId, false);
      break;
    case 'chat.contextUsage':
      log.debug('event:chat.contextUsage', { chatId: event.chatId, percentage: event.percentage });
      chats.setContextUsage(event.chatId, {
        percentage: event.percentage,
        totalTokens: event.totalTokens,
        maxTokens: event.maxTokens,
      });
      break;
    case 'todos.updated':
      log.debug('event:todos.updated', { chatId: event.chatId, count: event.todos.length });
      chats.setTodos(event.chatId, event.todos);
      break;
    case 'chat.prDetected':
      log.info('event:chat.prDetected', { chatId: event.chatId, prNumber: event.pr.number, repo: event.pr.repo });
      chats.addDetectedPr(event.chatId, event.pr);
      break;
    case 'sessions.external.count':
      break;
    case 'plugin.panel.registered':
      usePluginLayoutStore.getState().registerContribution({
        pluginId: event.pluginId,
        panelId: event.panelId,
        zone: event.zone,
        label: event.label,
        icon: event.icon,
      });
      break;
    case 'plugin.panel.unregistered':
      usePluginLayoutStore.getState().unregisterContribution(event.pluginId, event.panelId);
      break;
    case 'plugin.notification':
      notify({
        type:
          event.level === 'error'
            ? 'error'
            : event.level === 'warning'
              ? 'warning'
              : event.level === 'success'
                ? 'success'
                : 'info',
        title: event.title,
        body: event.body,
      });
      break;
    case 'plugin.action.registered':
      usePluginLayoutStore.getState().registerAction({
        id: event.actionId,
        pluginId: event.pluginId,
        label: event.label,
        shortcut: event.shortcut,
        icon: event.icon,
      });
      break;
    case 'plugin.action.unregistered':
      usePluginLayoutStore.getState().unregisterAction(event.pluginId, event.actionId);
      break;
    case 'message.queued':
      chats.addQueuedMessage(event.chatId, event.ref);
      break;
    case 'message.queued.processed':
      chats.removeQueuedMessage(event.chatId, event.uuid);
      break;
    case 'message.queued.cancelled':
      chats.removeQueuedMessage(event.chatId, event.uuid);
      break;
    case 'message.queued.cancel_failed':
      console.warn(`[queue] cancel failed for ${event.uuid} — CLI already processing`);
      break;
    case 'message.queued.cleared':
      chats.clearQueuedMessages(event.chatId);
      break;
    case 'message.queued.snapshot':
      chats.setQueuedMessages(event.chatId, event.refs);
      break;
    case 'adapter.models.updated':
      log.info('event:adapter.models.updated', { adapterId: event.adapterId, count: event.models.length });
      useAdaptersStore.getState().updateAdapterModels(event.adapterId, event.models);
      break;
    case 'error':
      log.error('daemon error event', { error: event.error });
      useProjectsStore.getState().setError(event.error);
      break;
  }
}
