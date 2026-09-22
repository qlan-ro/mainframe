'use client';

/**
 * Fetches the active chat's SessionContext and refetches (debounced 500ms) on
 * the `context.updated` WS event filtered to the active chat. Mirrors desktop's
 * ContextTab fetch+subscribe.
 */
import { useEffect, useState } from 'react';
import type { SessionContext } from '@qlan-ro/mainframe-types';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { getSessionContext } from '@/lib/api/context';
import { daemonWs } from '@/lib/daemon/ws-client';

export function useSessionContext(): { context: SessionContext | null; chatId: string | undefined } {
  const port = useDaemonPort();
  const { chatId } = useActiveIdentity();
  const [context, setContext] = useState<SessionContext | null>(null);
  useEffect(() => {
    let cancelled = false;
    let request = 0;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const fetchContext = () => {
      if (!chatId) return;
      const current = ++request;
      getSessionContext(port, chatId)
        .then((value) => {
          if (!cancelled && current === request) setContext(value);
        })
        .catch((err) => console.warn('[session-context] fetch failed', err));
    };
    setContext(null);
    fetchContext();
    const off = daemonWs.onEvent((event) => {
      if (event.type !== 'context.updated' || event.chatId !== chatId) return;
      clearTimeout(debounce);
      debounce = setTimeout(fetchContext, 500);
    });
    return () => {
      cancelled = true;
      off();
      clearTimeout(debounce);
    };
  }, [port, chatId]);

  return { context, chatId };
}
