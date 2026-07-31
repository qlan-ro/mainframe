import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useHost } from '@/lib/host';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';

interface WebviewMountProps {
  /**
   * The URL the webview should be showing, or `null` for "nothing should be
   * mounted". This is the ONLY mount gate: a launch-config preview tab derives
   * it from its process status and resolved tunnel, a URL tab from its own
   * address — neither owns the handle lifecycle itself.
   */
  url: string | null;
  /**
   * The precise inner frame the webview should cover (the phone frame in MOBILE
   * mode, the inner overlay div in DESKTOP mode). Preferred as the mount target
   * so `refit()` reads its rect.
   */
  anchorRef: RefObject<HTMLDivElement | null>;
  /** The always-present body wrapper — the mount target while the anchor is unmounted. */
  containerRef: RefObject<HTMLDivElement | null>;
  projectId?: string;
  device: 'desktop' | 'mobile';
}

/**
 * Owns one native webview handle: mount on the first URL, navigate on a change,
 * re-anchor when the mount node is replaced, destroy when the URL goes away or
 * the caller unmounts.
 */
export function useWebviewMount({
  url,
  anchorRef,
  containerRef,
  projectId,
  device,
}: WebviewMountProps): PreviewHandle | null {
  const host = useHost();
  const [handle, setHandle] = useState<PreviewHandle | null>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const mountElRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // No URL: tear the webview down. Leaving it up would keep a native child
    // webview composited over the app with nothing driving it.
    if (url === null) {
      if (!handleRef.current) return;
      handleRef.current.destroy();
      handleRef.current = null;
      mountElRef.current = null;
      setHandle(null);
      return;
    }

    const mountEl = anchorRef.current ?? containerRef.current;
    if (!handleRef.current) {
      if (!mountEl) return;
      const h = host.preview.mount(mountEl, url, { projectId, device });
      handleRef.current = h;
      mountElRef.current = mountEl;
      setHandle(h);
      return;
    }

    // The device toggle (and other layout swaps) can remount the anchor node;
    // re-point the handle at the live element or its bounds reads go stale.
    if (mountEl && mountEl !== mountElRef.current) {
      handleRef.current.reanchor?.(mountEl);
      mountElRef.current = mountEl;
    }
    void handleRef.current.navigate(url).catch((e) => console.warn('[preview] mount navigate', e));
  }, [url, anchorRef, containerRef, projectId, device, host]);

  useEffect(() => {
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  return handle;
}
