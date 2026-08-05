/**
 * A `url` workspace tab: the same native webview the preview tab drives, pointed at an
 * arbitrary address instead of a launch config (#281). Everything process-shaped
 * — run/stop, console, launch status — is absent by construction; the tunnel
 * resolver in `useUrlTabTunnel` takes the place of the launch lifecycle.
 */
import { useEffect, useRef, useState } from 'react';
import { useWebviewMount } from '@/features/preview/use-webview-mount';
import { usePreviewGeometry } from '@/features/preview/use-preview-geometry';
import { usePreviewVisibility } from '@/features/preview/use-preview-visibility';
import { usePreviewOcclusion } from '@/features/preview/use-preview-occlusion';
import { usePreviewCapture } from '@/features/preview/use-preview-capture';
import { CaptureAnnotationPopover } from '@/features/preview/CaptureAnnotationPopover';
import { useLayoutStore } from '@/store/layout';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { UrlTabToolbar } from './UrlTabToolbar';
import { UrlTabBodyState } from './UrlTabBodyState';
import { useUrlTabTunnel } from './use-url-tab-tunnel';
import { urlTabTitle } from './url-tab-id';

interface UrlTabInstanceProps {
  tabId: string;
  /** The tab's committed address — what the user typed, not what it resolves to. */
  url: string;
  visible: boolean;
  /** Accepted for call-site parity with `PreviewInstance`; a URL tab has no launch scope to read. */
  scopeKey?: string;
  projectId?: string;
}

export function UrlTabInstance({ tabId, url, visible, projectId }: UrlTabInstanceProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const identity = useActiveIdentity();
  const effectiveProjectId = projectId ?? identity.projectId;
  const setUrlTabTarget = useLayoutStore((s) => s.setUrlTabTarget);

  // A rehydrated tab must stay unmounted and tunnel-free until it is first shown
  // (spec: "rehydrate unmounted and load on first activation") — latch true on
  // first `visible` and never back, so switching away doesn't tear it down again.
  const [hasBeenVisible, setHasBeenVisible] = useState(visible);
  useEffect(() => {
    if (visible) setHasBeenVisible(true);
  }, [visible]);

  const { target, retry, reloadNonce } = useUrlTabTunnel({ tabId, url, active: hasBeenVisible });
  const loadUrl = hasBeenVisible && (target.kind === 'direct' || target.kind === 'tunnelled') ? target.url : null;

  const handle = useWebviewMount({
    url: loadUrl,
    anchorRef,
    containerRef,
    projectId: effectiveProjectId,
    device,
  });
  usePreviewGeometry({ handle, anchorRef, containerRef, active: visible, mounted: loadUrl !== null });
  const occluded = usePreviewOcclusion(anchorRef, loadUrl !== null && (handle?.compositesAboveDom ?? false));
  const [, setOverlayMounted] = usePreviewVisibility(handle, visible, occluded);

  const {
    pendingCaptures,
    regionSelectActive,
    annotationPopoverOpen,
    annotationBackdrop,
    inspectActive,
    onCaptureClick,
    onRegionClick,
    onInspectClick,
    onAnnotationChange,
    onAnnotationSubmit,
    onAnnotationCancel,
  } = usePreviewCapture(handle, setOverlayMounted);

  // The tunnel's edge DNS resolved after this tab already loaded, so what the
  // webview is showing is a 404 until it navigates again (D11).
  useEffect(() => {
    if (reloadNonce === 0 || !handle || loadUrl === null) return;
    void handle.navigate(loadUrl).catch((e: unknown) => {
      console.warn('[url-tab] DNS reload navigate failed', e);
    });
  }, [reloadNonce, handle, loadUrl]);

  return (
    <div
      data-testid={`url-tab-instance-${tabId}`}
      className="absolute inset-0 flex flex-col"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
    >
      <UrlTabToolbar
        url={url}
        handle={handle}
        device={device}
        onDeviceChange={setDevice}
        onCommitUrl={(next) => setUrlTabTarget(tabId, next, urlTabTitle(next))}
        onCaptureClick={onCaptureClick}
        onRegionClick={onRegionClick}
        onInspectClick={onInspectClick}
        inspectActive={inspectActive}
        regionActive={regionSelectActive}
      />
      <div ref={containerRef} className="relative min-h-0 flex-1">
        <UrlTabBodyState
          target={target}
          device={device}
          inspectActive={inspectActive}
          anchorRef={anchorRef}
          onRetry={retry}
        />
        {annotationBackdrop && (
          <img
            data-testid="url-tab-annotation-backdrop"
            src={annotationBackdrop}
            alt=""
            className="pointer-events-none absolute inset-0 z-40 h-full w-full object-contain"
          />
        )}
      </div>

      {annotationPopoverOpen && (
        <CaptureAnnotationPopover
          captures={pendingCaptures}
          onAnnotationChange={onAnnotationChange}
          onSubmit={onAnnotationSubmit}
          onCancel={onAnnotationCancel}
        />
      )}
    </div>
  );
}
