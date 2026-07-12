import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useHost } from '@/lib/host';
import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';

interface PreviewLifecycleProps {
  status: LaunchProcessStatus | null;
  port: number | null;
  /**
   * The fully-resolved webview URL — `http://localhost:${port}` on a local
   * daemon, the Cloudflare tunnel URL on a remote one; null while a remote
   * tunnel is still pending. The hook does not derive this from `port`
   * itself; the caller resolves locality and injects it.
   */
  resolvedUrl: string | null;
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
  resolvedUrl,
  anchorRef,
  containerRef,
  projectId,
  device,
}: PreviewLifecycleProps): {
  processStopped: boolean;
  handle: PreviewHandle | null;
  pendingTunnel: boolean;
} {
  const host = useHost();
  const [handle, setHandle] = useState<PreviewHandle | null>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const mountElRef = useRef<HTMLElement | null>(null);
  const prevStatusRef = useRef<LaunchProcessStatus | null>(null);
  const [processStopped, setProcessStopped] = useState(false);
  const [pendingTunnel, setPendingTunnel] = useState(false);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status ?? null;

    // running → anything else: tear the webview down. This must cover null too
    // (the scope entry can drop from the store, e.g. on a session-scope change);
    // a status-list check would leak a live composited webview over the app.
    if (handleRef.current && prevStatus === 'running' && status !== 'running') {
      handleRef.current.destroy();
      handleRef.current = null;
      mountElRef.current = null;
      setHandle(null);
      if (status === 'stopped' || status === 'failed') setProcessStopped(true);
      return;
    }

    if (status !== 'running' || port === null) return;
    setProcessStopped(false);

    // No resolved URL yet (remote tunnel still coming up) — do not mount; the
    // body renders the pending state until the URL arrives (WS event or seed).
    if (resolvedUrl === null) {
      setPendingTunnel(true);
      return;
    }
    setPendingTunnel(false);

    // Prefer the anchor (phone-frame in mobile, inner overlay in desktop) so
    // the native webview's initial rect and subsequent refit() calls track the
    // precise frame — matching pre-Task-7 anchorRef ?? containerRef semantics.
    const mountEl = anchorRef.current ?? containerRef.current;
    if (!handleRef.current) {
      if (!mountEl) return;
      const h = host.preview.mount(mountEl, resolvedUrl, { projectId, device });
      handleRef.current = h;
      mountElRef.current = mountEl;
      setHandle(h);
    } else {
      // The device toggle (and other layout swaps) can remount the anchor node;
      // re-point the handle at the live element or its bounds reads go stale.
      if (mountEl && mountEl !== mountElRef.current) {
        handleRef.current.reanchor?.(mountEl);
        mountElRef.current = mountEl;
      }
      void handleRef.current.navigate(resolvedUrl).catch((e) => console.warn('[preview] lifecycle navigate', e));
    }
  }, [status, port, resolvedUrl, anchorRef, containerRef, projectId, device, host]);

  useEffect(() => {
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  return { processStopped, handle, pendingTunnel };
}
