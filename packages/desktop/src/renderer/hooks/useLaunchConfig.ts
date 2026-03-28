import { useEffect, useRef, useState } from 'react';
import type { LaunchConfig } from '@qlan-ro/mainframe-types';
import { useProjectsStore } from '../store/projects';
import { useChatsStore } from '../store/chats';
import { useActiveProjectId } from './useActiveProjectId.js';
import { daemonClient } from '../lib/client';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:launch-config');

export function useLaunchConfig(): LaunchConfig | null {
  const activeProjectId = useActiveProjectId();
  const projects = useProjectsStore((s) => s.projects);
  const activeProject = activeProjectId ? (projects.find((p) => p.id === activeProjectId) ?? null) : null;
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const activeChat = useChatsStore((s) => s.chats.find((c) => c.id === s.activeChatId));
  const effectivePath = activeChat?.worktreePath ?? activeProject?.path;
  const [config, setConfig] = useState<LaunchConfig | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!effectivePath) {
      setConfig(null);
      return;
    }
    void window.mainframe
      ?.readFile(`${effectivePath}/.mainframe/launch.json`)
      .then((content) => {
        if (!content) {
          setConfig(null);
          return;
        }
        setConfig(JSON.parse(content) as LaunchConfig);
      })
      .catch((err) => {
        log.warn('failed to read launch.json', { err: String(err) });
        setConfig(null);
      });
  }, [effectivePath, refreshKey]);

  useEffect(() => {
    if (!activeChatId) return;
    const unsub = daemonClient.onEvent((event) => {
      if (event.type === 'context.updated' && event.chatId === activeChatId) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 500);
      }
    });
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeChatId]);

  useEffect(() => {
    const onFocus = (): void => setRefreshKey((k) => k + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return config;
}
