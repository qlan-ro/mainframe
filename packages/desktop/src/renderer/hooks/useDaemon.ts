import { useEffect, useCallback, useRef } from 'react';
import { daemonClient } from '../lib/client';
import { getProjects, getAdapters, getProviderSettings, getChats } from '../lib/api';
import { useProjectsStore } from '../store/projects';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { useSkillsStore } from '../store/skills';
import { useSettingsStore } from '../store/settings';
import { useAdaptersStore } from '../store/adapters';
import { usePluginLayoutStore } from '../store';
import type { DaemonEvent } from '@mainframe/types';
import { createLogger } from '../lib/logger';

export { useChat } from './useChat.js';

const log = createLogger('daemon');

export function useDaemon(): void {
  const { setProjects, setLoading, setError } = useProjectsStore();
  const loadProviders = useSettingsStore((s) => s.loadProviders);
  const setAdapters = useAdaptersStore((s) => s.setAdapters);
  const {
    addChat,
    updateChat,
    removeChat,
    setActiveChat,
    addMessage,
    addPendingPermission,
    setProcess,
    updateProcessStatus,
    removeProcess,
  } = useChatsStore();

  const handleEvent = useCallback(
    (event: DaemonEvent) => {
      switch (event.type) {
        case 'chat.created':
          log.info('event:chat.created', { chatId: event.chat.id, title: event.chat.title });
          addChat(event.chat);
          setActiveChat(event.chat.id);
          useTabsStore.getState().openChatTab(event.chat.id, event.chat.title);
          break;
        case 'chat.updated':
          log.debug('event:chat.updated', { chatId: event.chat.id });
          updateChat(event.chat);
          if (event.chat.title) {
            useTabsStore.getState().updateTabLabel(`chat:${event.chat.id}`, event.chat.title);
          }
          break;
        case 'chat.ended':
          log.info('event:chat.ended', { chatId: event.chatId });
          removeChat(event.chatId);
          removeProcess(event.chatId);
          break;
        case 'message.added':
          log.debug('event:message.added', { chatId: event.chatId, type: event.message.type });
          addMessage(event.chatId, event.message);
          break;
        case 'messages.cleared':
          log.info('event:messages.cleared', { chatId: event.chatId });
          useChatsStore.getState().setMessages(event.chatId, []);
          break;
        case 'permission.requested':
          log.info('event:permission.requested', {
            chatId: event.chatId,
            requestId: event.request.requestId,
            toolName: event.request.toolName,
          });
          addPendingPermission(event.chatId, event.request);
          break;
        case 'context.updated':
          log.debug('event:context.updated', { chatId: event.chatId });
          break;
        case 'process.started':
          log.info('event:process.started', { chatId: event.chatId, processId: event.process.id });
          setProcess(event.chatId, event.process);
          break;
        case 'process.ready':
          log.info('event:process.ready', { processId: event.processId, claudeSessionId: event.claudeSessionId });
          updateProcessStatus(event.processId, 'ready');
          break;
        case 'process.stopped':
          log.info('event:process.stopped', { processId: event.processId });
          updateProcessStatus(event.processId, 'stopped');
          break;
        case 'error':
          log.error('daemon error event', { error: event.error });
          setError(event.error);
          break;
        case 'plugin.panel.registered':
          log.info('event:plugin.panel.registered', { pluginId: event.pluginId, zone: event.zone });
          usePluginLayoutStore.getState().registerContribution({
            pluginId: event.pluginId,
            zone: event.zone,
            label: event.label,
            icon: event.icon,
          });
          break;
        case 'plugin.panel.unregistered':
          log.info('event:plugin.panel.unregistered', { pluginId: event.pluginId });
          usePluginLayoutStore.getState().unregisterContribution(event.pluginId);
          break;
      }
    },
    [
      addChat,
      updateChat,
      removeChat,
      setActiveChat,
      addMessage,
      addPendingPermission,
      setProcess,
      updateProcessStatus,
      removeProcess,
      setError,
    ],
  );

  useEffect(() => {
    daemonClient.connect();
    const unsubscribe = daemonClient.onEvent(handleEvent);

    const loadData = async () => {
      setLoading(true);
      try {
        const projects = await getProjects();
        setProjects(projects);
        try {
          const adapters = await getAdapters();
          setAdapters(adapters);
        } catch (err) {
          log.warn('adapter fetch failed', { err: String(err) });
        }
        try {
          const providerSettings = await getProviderSettings();
          loadProviders(providerSettings);
        } catch {
          // Keep booting even if provider settings fetch fails.
        }
        const lastId = localStorage.getItem('mf:activeProjectId');
        if (lastId && projects.some((p) => p.id === lastId)) {
          useProjectsStore.getState().setActiveProject(lastId);
        }
      } catch {
        setError('Failed to connect to daemon');
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Re-fetch projects when daemon reconnects (e.g. daemon restart during dev)
    const unsubConnection = daemonClient.subscribeConnection(() => {
      if (daemonClient.connected) loadData();
    });

    return () => {
      unsubscribe();
      unsubConnection();
      daemonClient.disconnect();
    };
  }, [handleEvent, setProjects, setLoading, setError, loadProviders, setAdapters]);
}

export function useProject(projectId: string | null) {
  const { chats, setChats } = useChatsStore();
  const prevProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    useTabsStore.getState().switchProject(prevProjectIdRef.current, projectId);
    prevProjectIdRef.current = projectId;

    const hasRestoredTabs = useTabsStore.getState().tabs.length > 0;

    // Sync activeChatId from restored tabs so the sidebar highlights correctly
    if (hasRestoredTabs) {
      const tabState = useTabsStore.getState();
      const activeTab = tabState.tabs.find((t) => t.id === tabState.activePrimaryTabId);
      if (activeTab?.type === 'chat') {
        useChatsStore.getState().setActiveChat(activeTab.chatId);
      }
    }

    const loadChats = async () => {
      const chatsList = await getChats(projectId);
      setChats(chatsList);

      if (!hasRestoredTabs && chatsList.length > 0) {
        const sorted = [...chatsList].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const mostRecent = sorted[0]!;
        useChatsStore.getState().setActiveChat(mostRecent.id);
        useTabsStore.getState().openChatTab(mostRecent.id, mostRecent.title);
        daemonClient.subscribe(mostRecent.id);
      }
    };

    loadChats();

    // Eagerly load skills & agents so menus (/ and @) work immediately
    const project = useProjectsStore.getState().projects.find((p) => p.id === projectId);
    if (project) {
      useSkillsStore.getState().fetchSkills('claude', project.path);
      useSkillsStore.getState().fetchAgents('claude', project.path);
    }

    // Re-fetch chats when daemon reconnects (e.g. daemon restart during dev)
    const unsubConnection = daemonClient.subscribeConnection(() => {
      if (daemonClient.connected) loadChats();
    });

    return () => {
      unsubConnection();
    };
  }, [projectId, setChats]);

  const createChat = useCallback(
    (adapterId: string, model?: string) => {
      if (!projectId) return;
      daemonClient.createChat(projectId, adapterId, model);
    },
    [projectId],
  );

  return { chats, createChat };
}
