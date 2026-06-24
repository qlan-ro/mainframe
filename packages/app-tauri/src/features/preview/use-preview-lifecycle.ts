import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useHost } from '@/lib/host';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';

interface PreviewLifecycleProps {
  tabId: string;
  status: LaunchProcessStatus | null;
  port: number | null;
  anchorRef: RefObject<HTMLDivElement | null>;
}

function getAnchorBounds(anchorRef: RefObject<HTMLDivElement | null>) {
  const rect = anchorRef.current?.getBoundingClientRect();
  return { x: rect?.left ?? 0, y: rect?.top ?? 0, w: rect?.width ?? 0, h: rect?.height ?? 0 };
}

export function usePreviewLifecycle({ tabId, status, port, anchorRef }: PreviewLifecycleProps): {
  processStopped: boolean;
} {
  const host = useHost();
  const createdRef = useRef(false);
  const prevStatusRef = useRef<LaunchProcessStatus | null>(null);
  const [processStopped, setProcessStopped] = useState(false);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status ?? null;

    // running → stopped/failed: server died, destroy webview, show placeholder
    if (createdRef.current && prevStatus === 'running' && (status === 'stopped' || status === 'failed')) {
      createdRef.current = false;
      setProcessStopped(true);
      host.preview.destroy(tabId).catch((e) => console.warn('[preview] lifecycle destroy on stop', e));
      return;
    }

    // Gate: only create/navigate when running with a valid port
    if (status !== 'running' || port === null) return;

    // Reset stopped state when server comes back
    setProcessStopped(false);

    if (!createdRef.current) {
      createdRef.current = true;
      host.preview
        .create(tabId, `http://localhost:${port}`, getAnchorBounds(anchorRef))
        .catch((e) => console.warn('[preview] lifecycle create', e));
    } else {
      host.preview
        .navigate(tabId, `http://localhost:${port}`)
        .catch((e) => console.warn('[preview] lifecycle navigate', e));
    }
  }, [tabId, status, port, anchorRef, host]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (createdRef.current) {
        host.preview.destroy(tabId).catch((e) => console.warn('[preview] lifecycle unmount destroy', e));
        createdRef.current = false;
      }
    };
  }, [tabId, host]);

  return { processStopped };
}
