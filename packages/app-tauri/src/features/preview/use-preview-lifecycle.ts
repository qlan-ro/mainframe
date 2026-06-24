import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useHost } from '@/lib/host';
import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';

interface PreviewLifecycleProps {
  status: LaunchProcessStatus | null;
  port: number | null;
  containerRef: RefObject<HTMLDivElement | null>;
  projectId?: string;
  device: 'desktop' | 'mobile';
}

export function usePreviewLifecycle({ status, port, containerRef, projectId, device }: PreviewLifecycleProps): {
  processStopped: boolean;
  handle: PreviewHandle | null;
} {
  const host = useHost();
  const [handle, setHandle] = useState<PreviewHandle | null>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const prevStatusRef = useRef<LaunchProcessStatus | null>(null);
  const [processStopped, setProcessStopped] = useState(false);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status ?? null;

    // running → stopped/failed: tear the webview down, show placeholder
    if (handleRef.current && prevStatus === 'running' && (status === 'stopped' || status === 'failed')) {
      handleRef.current.destroy();
      handleRef.current = null;
      setHandle(null);
      setProcessStopped(true);
      return;
    }

    if (status !== 'running' || port === null) return;
    setProcessStopped(false);

    const url = `http://localhost:${port}`;
    if (!handleRef.current) {
      const container = containerRef.current;
      if (!container) return;
      const h = host.preview.mount(container, url, { projectId, device });
      handleRef.current = h;
      setHandle(h);
    } else {
      void handleRef.current.navigate(url).catch((e) => console.warn('[preview] lifecycle navigate', e));
    }
  }, [status, port, containerRef, projectId, device, host]);

  useEffect(() => {
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  return { processStopped, handle };
}
