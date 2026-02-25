import { useEffect, useCallback, useRef } from 'react';
import { daemonClient } from '../lib/client';
import { getProjects, getAdapters, getProviderSettings, getChats, getPlugins } from '../lib/api';
import { useProjectsStore } from '../store/projects';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { useSkillsStore } from '../store/skills';
import { useSettingsStore } from '../store/settings';
import { useAdaptersStore } from '../store/adapters';
import { usePluginLayoutStore } from '../store';
import { routeEvent } from '../lib/ws-event-router';
import { createLogger } from '../lib/logger';

export { useChatSession } from './useChatSession.js';

const log = createLogger('renderer:init');

export function useAppInit(): void {
  const { setProjects, setLoading, setError } = useProjectsStore();
  const loadProviders = useSettingsStore((s) => s.loadProviders);
  const setAdapters = useAdaptersStore((s) => s.setAdapters);

  useEffect(() => {
    daemonClient.connect();
    const unsubscribe = daemonClient.onEvent(routeEvent);

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
        try {
          const plugins = await getPlugins();
          const store = usePluginLayoutStore.getState();
          for (const plugin of plugins) {
            if (plugin.panel) {
              store.registerContribution({ pluginId: plugin.id, ...plugin.panel });
            }
          }
        } catch (err) {
          log.warn('plugin fetch failed', { err: String(err) });
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
  }, [setProjects, setLoading, setError, loadProviders, setAdapters]);
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
