/**
 * useOffloadRelease — React glue around OffloadRelease (#178).
 *
 * Mounted beside `useSessionListRouter()` under <AssistantRuntimeProvider>.
 * Created once per `threads` scope identity (survives a main-thread switch,
 * same rationale as SessionListRouter); a separate effect calls `recheck()`
 * whenever the on-screen set changes (main thread or the zones pair), so a
 * chat deferred while on screen is released as soon as it scrolls off.
 */
import { useEffect, useRef } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { daemonWs } from '../../../lib/daemon/ws-client';
import { useZonesStore } from '../../chat/zones/zones-store';
import { chatControllerRegistry } from './chat-controller-registry';
import { markForStash } from '../../chat/runtime/draft-stash';
import { createOffloadRelease, type OffloadRelease } from './offload-release';

export function useOffloadRelease(): void {
  // The `threads` SCOPE, not the client — see useSessionListRouter for why
  // (a fresh client on every main-thread switch would tear this down).
  const threads = useAui().threads;
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const zones = useZonesStore((s) => s.zones);
  const releaseRef = useRef<OffloadRelease | null>(null);

  useEffect(() => {
    const release = createOffloadRelease(daemonWs, {
      getThreadItems: () => threads.getState().threadItems,
      getMainThreadId: () => threads.getState().mainThreadId ?? null,
      getZones: () => useZonesStore.getState().zones,
      detachItem: (id) => threads.item({ id }).detach(),
      disposeController: (chatId) => chatControllerRegistry.dispose(chatId),
      markForStash,
    });
    releaseRef.current = release;
    return () => {
      releaseRef.current = null;
      release.dispose();
    };
  }, [threads]);

  useEffect(() => {
    releaseRef.current?.recheck();
  }, [mainThreadId, zones]);
}
