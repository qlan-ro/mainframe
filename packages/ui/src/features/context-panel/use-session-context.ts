'use client';

/**
 * Fetches the active chat's SessionContext and refetches (debounced 500ms) on
 * the `context.updated` WS event filtered to the active chat. Mirrors desktop's
 * ContextTab fetch+subscribe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionContext } from '@qlan-ro/mainframe-types';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { getSessionContext } from '@/lib/api/context';
import { daemonWs } from '@/lib/daemon/ws-client';

export function useSessionContext(): { context: SessionContext | null; chatId: string | undefined } {
  const port = useDaemonPort();
  const { chatId } = useActiveIdentity();
  const [context, setContext] = useState<SessionContext | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchContext = useCallback(() => {
    if (!chatId) return;
    getSessionContext(port, chatId)
      .then(setContext)
      .catch((err) => console.warn('[context-panel] fetch failed', err));
  }, [port, chatId]);

  useEffect(() => {
    setContext(null);
    fetchContext();
  }, [fetchContext]);

  useEffect(() => {
    const off = daemonWs.onEvent((event) => {
      if (event.type !== 'context.updated' || event.chatId !== chatId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(fetchContext, 500);
    });
    return () => {
      off();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [chatId, fetchContext]);

  return { context, chatId };
}
