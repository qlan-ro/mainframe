import { useEffect, useCallback } from 'react';
import { daemonClient } from '../lib/client';
import { getProjects, getAdapters, getProviderSettings, getAllChats, getPlugins } from '../lib/api';
import { useProjectsStore } from '../store/projects';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { useSkillsStore } from '../store/skills';
import { useSettingsStore } from '../store/settings';
import { useAdaptersStore } from '../store/adapters';
import { usePluginLayoutStore } from '../store';
import { routeEvent } from '../lib/ws-event-router';
import { createLogger } from '../lib/logger';
import { fetchLaunchStatuses } from '../lib/launch';
import { useSandboxStore } from '../store/sandbox';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';

export { useChatSession } from './useChatSession.js';

const log = createLogger('renderer:init');

export function useAppInit(): void {
  const { setProjects, setLoading, setError } = useProjectsStore();
  const loadProviders = useSettingsStore((s) => s.loadProviders);
  const setAdapters = useAdaptersStore((s) => s.setAdapters);

  useEffect(() => {
    // One-time cleanup of removed localStorage keys from unified session view migration
    if (localStorage.getItem('mf:activeProjectId') !== null) {
      localStorage.removeItem('mf:activeProjectId');
      localStorage.removeItem('mf:projectTabs');
    }

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

        // Fetch all chats across all projects
        try {
          const chatsList = await getAllChats();
          useChatsStore.getState().setChats(chatsList);

          // Restore active chat from localStorage
          const lastChatId = localStorage.getItem('mf:activeChatId');
          if (lastChatId && chatsList.some((c) => c.id === lastChatId)) {
            useChatsStore.getState().setActiveChat(lastChatId);
            daemonClient.subscribe(lastChatId);
          } else if (chatsList.length > 0) {
            // Fall back to most recently updated chat
            const sorted = [...chatsList].sort(
              (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
            );
            const mostRecent = sorted[0]!;
            useChatsStore.getState().setActiveChat(mostRecent.id);
            useTabsStore.getState().openChatTab(mostRecent.id, mostRecent.title);
            daemonClient.subscribe(mostRecent.id);
          }
        } catch (err) {
          log.warn('chat fetch failed', { err: String(err) });
        }
      } catch {
        setError('Failed to connect to daemon');
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Re-fetch when daemon reconnects (e.g. daemon restart during dev)
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
  const chats = useChatsStore((s) => s.chats);

  useEffect(() => {
    if (!projectId) return;

    const syncLaunchStatuses = async () => {
      try {
        const activeChatId = useChatsStore.getState().activeChatId ?? undefined;
        const { statuses } = await fetchLaunchStatuses(projectId, activeChatId);
        const { setProcessStatus } = useSandboxStore.getState();
        for (const [name, status] of Object.entries(statuses)) {
          setProcessStatus(projectId, name, status as LaunchProcessStatus);
        }
      } catch (err) {
        log.warn('launch status fetch failed', { err: String(err) });
      }
    };

    syncLaunchStatuses();

    // Eagerly load skills, agents & commands so menus (/ and @) work immediately
    const project = useProjectsStore.getState().projects.find((p) => p.id === projectId);
    if (project) {
      useSkillsStore.getState().fetchSkills('claude', project.path);
      useSkillsStore.getState().fetchAgents('claude', project.path);
      useSkillsStore.getState().fetchCommands();
    }

    // Re-fetch project context when daemon reconnects
    const unsubConnection = daemonClient.subscribeConnection(() => {
      if (daemonClient.connected) {
        syncLaunchStatuses();
      }
    });

    return () => {
      unsubConnection();
    };
  }, [projectId]);

  const createChat = useCallback(
    (adapterId: string, model?: string) => {
      if (!projectId) return;
      daemonClient.createChat(projectId, adapterId, model);
    },
    [projectId],
  );

  return { chats, createChat };
}
