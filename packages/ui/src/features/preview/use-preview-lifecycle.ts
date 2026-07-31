import type { RefObject } from 'react';
import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';
import { useWebviewMount } from './use-webview-mount';

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

/**
 * The launch-config preview tab's mount gate: a webview exists only while the
 * process is running on a known port with a resolved URL. The handle lifecycle
 * itself belongs to {@link useWebviewMount}, shared with the URL tab.
 */
export function usePreviewLifecycle({
  status,
  port,
  resolvedUrl,
  anchorRef,
  containerRef,
  projectId,
  device,
}: PreviewLifecycleProps): {
  handle: PreviewHandle | null;
  pendingTunnel: boolean;
} {
  const live = status === 'running' && port !== null;
  const handle = useWebviewMount({
    url: live ? resolvedUrl : null,
    anchorRef,
    containerRef,
    projectId,
    device,
  });

  return { handle, pendingTunnel: live && resolvedUrl === null };
}
