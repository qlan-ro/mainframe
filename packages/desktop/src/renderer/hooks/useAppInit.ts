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
import { buildLaunchScope } from '../lib/launch-scope.js';
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
        const [projectsResult, adaptersResult, providerResult, pluginsResult, chatsResult] = await Promise.allSettled([
          getProjects(),
          getAdapters(),
          getProviderSettings(),
          getPlugins(),
          getAllChats(),
        ]);

        if (projectsResult.status === 'fulfilled') {
          setProjects(projectsResult.value);
        } else {
          throw projectsResult.reason;
        }

        if (adaptersResult.status === 'fulfilled') {
          setAdapters(adaptersResult.value);
        } else {
          log.warn('adapter fetch failed', { err: String(adaptersResult.reason) });
        }

        if (providerResult.status === 'fulfilled') {
          loadProviders(providerResult.value);
        } else {
          // Keep booting even if provider settings fetch fails.
          log.warn('provider settings fetch failed', { err: String(providerResult.reason) });
        }

        if (pluginsResult.status === 'fulfilled') {
          const store = usePluginLayoutStore.getState();
          for (const plugin of pluginsResult.value) {
            const panels = plugin.panels ?? (plugin.panel ? [plugin.panel] : []);
            for (const panel of panels) {
              store.registerContribution({ pluginId: plugin.id, ...panel });
            }
            if (plugin.actions) {
              for (const action of plugin.actions) {
                store.registerAction(action);
              }
            }
          }
        } else {
          log.warn('plugin fetch failed', { err: String(pluginsResult.reason) });
        }

        if (chatsResult.status === 'fulfilled') {
          const chatsList = chatsResult.value;
          useChatsStore.getState().setChats(chatsList);

          // Restore active chat from localStorage. Archived chats are hidden
          // from the flat list but still returned by the daemon, so we must
          // skip them explicitly — otherwise activeChatId points to a chat
          // the user cannot see or switch away from.
          const lastChatId = localStorage.getItem('mf:activeChatId');
          const visibleChats = chatsList.filter((c) => c.status !== 'archived');
          let restoredChat: (typeof chatsList)[number] | undefined;
          const lastChat = lastChatId ? visibleChats.find((c) => c.id === lastChatId) : undefined;
          if (lastChat) {
            restoredChat = lastChat;
            useChatsStore.getState().setActiveChat(lastChat.id);
            daemonClient.subscribe(lastChat.id);
          } else if (visibleChats.length > 0) {
            // Fall back to most recently updated chat
            const sorted = [...visibleChats].sort(
              (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
            );
            restoredChat = sorted[0]!;
            useChatsStore.getState().setActiveChat(restoredChat.id);
            useTabsStore.getState().openChatTab(restoredChat.id, restoredChat.title);
            daemonClient.subscribe(restoredChat.id);
          } else if (lastChatId) {
            // No visible chats — clear the stale pointer so it doesn't
            // resurface on a subsequent boot once data changes.
            localStorage.removeItem('mf:activeChatId');
          }

          // setActiveChat reconciles filterProjectId on its own: it clears the
          // filter to null when the new active chat lives in a different project.
        } else {
          log.warn('chat fetch failed', { err: String(chatsResult.reason) });
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
  const activeChatId = useChatsStore((s) => s.activeChatId);

  useEffect(() => {
    if (!projectId) return;

    const syncLaunchStatuses = async () => {
      try {
        const { statuses, effectivePath } = await fetchLaunchStatuses(projectId, activeChatId ?? undefined);
        if (!effectivePath) return;
        const scopeKey = buildLaunchScope(projectId, effectivePath);
        const { setProcessStatus } = useSandboxStore.getState();
        for (const [name, status] of Object.entries(statuses)) {
          setProcessStatus(scopeKey, name, status as LaunchProcessStatus);
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
  }, [projectId, activeChatId]);

  const createChat = useCallback(
    (adapterId: string, model?: string) => {
      if (!projectId) return;
      daemonClient.createChat(projectId, adapterId, model);
    },
    [projectId],
  );

  return { chats, createChat };
}
