import { useEffect, useCallback, useRef } from 'react';
import { daemonClient } from '../lib/client';
import {
  getProjects,
  getAdapters,
  getProviderSettings,
  getChats,
  getChatMessages,
  getPendingPermission,
  uploadAttachments,
} from '../lib/api';
import { useProjectsStore } from '../store/projects';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { useSkillsStore } from '../store/skills';
import { useSettingsStore } from '../store/settings';
import { useAdaptersStore } from '../store/adapters';
import type { DaemonEvent } from '@mainframe/types';

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
          addChat(event.chat);
          setActiveChat(event.chat.id);
          useTabsStore.getState().openChatTab(event.chat.id, event.chat.title);
          break;
        case 'chat.updated':
          updateChat(event.chat);
          if (event.chat.title) {
            useTabsStore.getState().updateTabLabel(`chat:${event.chat.id}`, event.chat.title);
          }
          break;
        case 'chat.ended':
          removeChat(event.chatId);
          removeProcess(event.chatId);
          break;
        case 'message.added':
          addMessage(event.chatId, event.message);
          break;
        case 'messages.cleared':
          useChatsStore.getState().setMessages(event.chatId, []);
          break;
        case 'permission.requested':
          addPendingPermission(event.chatId, event.request);
          break;
        case 'context.updated':
          break;
        case 'process.started':
          setProcess(event.chatId, event.process);
          break;
        case 'process.ready':
          updateProcessStatus(event.processId, 'ready');
          break;
        case 'process.stopped':
          updateProcessStatus(event.processId, 'stopped');
          break;
        case 'error':
          setError(event.error);
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
          console.warn('[useDaemon] adapter fetch failed:', err);
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

export function useChat(chatId: string | null) {
  const { messages, pendingPermissions } = useChatsStore();
  const chatMessages = chatId ? messages.get(chatId) || [] : [];
  const pendingPermission = chatId ? pendingPermissions.get(chatId) : undefined;

  useEffect(() => {
    if (!chatId) return;

    // resumeChat starts the adapter process (loads history + spawns CLI) and subscribes.
    // If the process is already running, startChat returns early — this is a safe no-op.
    daemonClient.resumeChat(chatId);

    // Load cached messages from daemon (survives desktop reloads)
    const existing = useChatsStore.getState().messages.get(chatId);
    if (!existing || existing.length === 0) {
      getChatMessages(chatId)
        .then((msgs) => {
          if (msgs.length > 0) {
            useChatsStore.getState().setMessages(chatId, msgs);
          }
        })
        .catch((err) => console.warn('[useChat] message fetch failed:', err));
    }

    // Restore pending permission from daemon (survives desktop reloads)
    if (!useChatsStore.getState().pendingPermissions.has(chatId)) {
      getPendingPermission(chatId)
        .then((permission) => {
          if (permission) {
            useChatsStore.getState().addPendingPermission(chatId, permission);
          }
        })
        .catch((err) => console.warn('[useChat] permission fetch failed:', err));
    }

    // On daemon reconnect, reload messages from daemon.
    // Delay slightly so the daemon's loadChat() (triggered by chat.resume) has time to
    // populate its message cache before we fetch via REST.
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubConnection = daemonClient.subscribeConnection(() => {
      if (daemonClient.connected) {
        daemonClient.resumeChat(chatId);
        reconnectTimer = setTimeout(() => {
          getChatMessages(chatId)
            .then((msgs) => {
              if (msgs.length > 0) {
                useChatsStore.getState().setMessages(chatId, msgs);
              }
            })
            .catch((err) => console.warn('[useChat] reconnect message fetch failed:', err));
          getPendingPermission(chatId)
            .then((permission) => {
              if (permission) {
                useChatsStore.getState().addPendingPermission(chatId, permission);
              }
            })
            .catch((err) => console.warn('[useChat] reconnect permission fetch failed:', err));
        }, 500);
      }
    });

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      daemonClient.unsubscribe(chatId);
      unsubConnection();
    };
  }, [chatId]);

  const sendMessage = useCallback(
    async (
      content: string,
      attachments?: {
        name: string;
        mediaType: string;
        sizeBytes: number;
        kind: 'image' | 'file';
        data: string;
        originalPath?: string;
      }[],
    ) => {
      if (!chatId) return;
      let attachmentIds: string[] | undefined;
      if (attachments?.length) {
        const uploaded = await uploadAttachments(chatId, attachments);
        attachmentIds = uploaded.map((a) => a.id);
      }
      daemonClient.sendMessage(chatId, content, attachmentIds);
    },
    [chatId],
  );

  const respondToPermission = useCallback(
    (
      behavior: 'allow' | 'deny',
      alwaysAllow?: string[],
      overrideInput?: Record<string, unknown>,
      message?: string,
      executionMode?: string,
      clearContext?: boolean,
    ) => {
      if (!chatId || !pendingPermission) return;
      daemonClient.respondToPermission(chatId, {
        requestId: pendingPermission.requestId,
        toolUseId: pendingPermission.toolUseId,
        toolName: pendingPermission.toolName,
        behavior,
        updatedInput: overrideInput ?? pendingPermission.input,
        updatedPermissions: alwaysAllow,
        message,
        executionMode: executionMode as 'default' | 'acceptEdits' | 'yolo' | undefined,
        clearContext,
      });
      useChatsStore.getState().removePendingPermission(chatId);
    },
    [chatId, pendingPermission],
  );

  return { messages: chatMessages, pendingPermission, sendMessage, respondToPermission };
}
