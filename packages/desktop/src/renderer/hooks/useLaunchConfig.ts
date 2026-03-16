import { useEffect, useRef, useState } from 'react';
import type { LaunchConfig } from '@qlan-ro/mainframe-types';
import { useProjectsStore } from '../store/projects';
import { useChatsStore } from '../store/chats';
import { daemonClient } from '../lib/client';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:launch-config');

export function useLaunchConfig(): LaunchConfig | null {
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null,
  );
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [config, setConfig] = useState<LaunchConfig | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeProject) {
      setConfig(null);
      return;
    }
    void window.mainframe
      ?.readFile(`${activeProject.path}/.mainframe/launch.json`)
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
  }, [activeProject?.id, refreshKey]);

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
