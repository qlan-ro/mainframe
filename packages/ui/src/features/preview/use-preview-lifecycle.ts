import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useHost } from '@/lib/host';
import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';

interface PreviewLifecycleProps {
  status: LaunchProcessStatus | null;
  port: number | null;
  /**
   * The precise inner frame the webview should cover (e.g. the phone frame in
   * MOBILE mode, or the inner overlay div in DESKTOP mode). When present, mount()
   * anchors the native webview to this element so refit() reads its rect — restoring
   * pre-Task-7 anchor-based positioning parity.
   */
  anchorRef: RefObject<HTMLDivElement | null>;
  /**
   * The always-present body wrapper. Used as the mount target only when anchorRef
   * has not yet mounted (fallback, same semantics as anchorRef ?? containerRef).
   */
  containerRef: RefObject<HTMLDivElement | null>;
  projectId?: string;
  device: 'desktop' | 'mobile';
}

export function usePreviewLifecycle({
  status,
  port,
  anchorRef,
  containerRef,
  projectId,
  device,
}: PreviewLifecycleProps): {
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
      // Prefer the anchor (phone-frame in mobile, inner overlay in desktop) so
      // the native webview's initial rect and subsequent refit() calls track the
      // precise frame — matching pre-Task-7 anchorRef ?? containerRef semantics.
      const mountEl = anchorRef.current ?? containerRef.current;
      if (!mountEl) return;
      const h = host.preview.mount(mountEl, url, { projectId, device });
      handleRef.current = h;
      setHandle(h);
    } else {
      void handleRef.current.navigate(url).catch((e) => console.warn('[preview] lifecycle navigate', e));
    }
  }, [status, port, anchorRef, containerRef, projectId, device, host]);

  useEffect(() => {
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  return { processStopped, handle };
}
