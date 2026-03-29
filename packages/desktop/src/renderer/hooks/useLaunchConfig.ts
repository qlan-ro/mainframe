import { useEffect, useRef, useState } from 'react';
import type { LaunchConfig } from '@qlan-ro/mainframe-types';
import { useChatsStore } from '../store/chats';
import { useActiveProjectId } from './useActiveProjectId.js';
import { fetchLaunchConfigs } from '../lib/launch';
import { daemonClient } from '../lib/client';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:launch-config');

export function useLaunchConfig(): LaunchConfig | null {
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [config, setConfig] = useState<LaunchConfig | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeProjectId) {
      setConfig(null);
      return;
    }
    fetchLaunchConfigs(activeProjectId, activeChatId ?? undefined)
      .then((configurations) => {
        if (configurations.length === 0) {
          setConfig(null);
          return;
        }
        setConfig({ version: '1', configurations });
      })
      .catch((err) => {
        log.warn('failed to fetch launch configs', { err: String(err) });
        setConfig(null);
      });
  }, [activeProjectId, activeChatId, refreshKey]);

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
