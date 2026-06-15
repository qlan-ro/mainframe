import { useState, useCallback, useEffect } from 'react';
import { previewCapture, previewEval, onInspectResult } from '@/lib/tauri/preview';
import type { InspectResult, Region } from '@/lib/tauri/preview';
import { useSandboxStore } from '@/store/sandbox';
import { useSendCaptures } from './use-send-captures';
import type { CaptureLike } from '@/features/run/format-captures';

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return `data:image/png;base64,${btoa(binary)}`;
}

const PAD = 20;

export function usePreviewCapture(tabId: string, setOverlayMounted: (v: boolean) => void) {
  const [regionOverlayOpen, setRegionOverlayOpen] = useState(false);
  const [annotationPopoverOpen, setAnnotationPopoverOpen] = useState(false);
  const [inspectActive, setInspectActive] = useState(false);
  const [annotations, setAnnotations] = useState<Map<string, string>>(new Map());
  const pendingCaptures = useSandboxStore((s) => s.captures);
  const sendCapturesFn = useSendCaptures();

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const handleInspectResult = (result: InspectResult) => {
      if (result.tabId !== tabId) return;
      if (result.selector === null) {
        setInspectActive(false);
        return;
      }
      const { rect, viewport } = result;
      if (!rect || !viewport) return;
      const x = Math.max(0, rect.x - PAD);
      const y = Math.max(0, rect.y - PAD);
      const right = Math.min(viewport.w, rect.x + rect.w + PAD);
      const bottom = Math.min(viewport.h, rect.y + rect.h + PAD);
      const region: Region = { x, y, w: right - x, h: bottom - y };
      previewCapture(tabId, region)
        .then((bytes) => {
          const imageDataUrl = bytesToDataUrl(bytes);
          useSandboxStore.getState().addCapture({
            type: 'element',
            imageDataUrl,
            selector: result.selector ?? undefined,
          });
          setAnnotationPopoverOpen(true);
        })
        .catch((e: unknown) => console.warn('[preview] capture failed', e));
    };
    onInspectResult(handleInspectResult)
      .then((fn) => { unlisten = fn; })
      .catch((e: unknown) => console.warn('[preview] inspect listener failed', e));
    return () => { unlisten?.(); };
  }, [tabId]);

  useEffect(() => {
    setOverlayMounted(regionOverlayOpen || annotationPopoverOpen);
  }, [regionOverlayOpen, annotationPopoverOpen, setOverlayMounted]);

  const onCaptureClick = useCallback(() => {
    previewCapture(tabId)
      .then((bytes) => {
        const imageDataUrl = bytesToDataUrl(bytes);
        useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl });
        setAnnotationPopoverOpen(true);
      })
      .catch((e: unknown) => console.warn('[preview] capture failed', e));
  }, [tabId]);

  const onRegionClick = useCallback(() => {
    setRegionOverlayOpen((prev) => !prev);
  }, []);

  const onInspectClick = useCallback(() => {
    setInspectActive((prev) => {
      const next = !prev;
      if (next) {
        const installScript = `window.__mfInspectInstall && window.__mfInspectInstall('${tabId}')`;
        previewEval(tabId, installScript).catch((e: unknown) =>
          console.warn('[preview] inspect eval failed', e),
        );
      }
      return next;
    });
  }, [tabId]);

  const onRegionSelect = useCallback(
    (region: Region) => {
      setRegionOverlayOpen(false);
      previewCapture(tabId, region)
        .then((bytes) => {
          const imageDataUrl = bytesToDataUrl(bytes);
          useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl });
          setAnnotationPopoverOpen(true);
        })
        .catch((e: unknown) => console.warn('[preview] capture failed', e));
    },
    [tabId],
  );

  const onAnnotationChange = useCallback((id: string, annotation: string) => {
    setAnnotations((prev) => new Map(prev).set(id, annotation));
  }, []);

  const onAnnotationSubmit = useCallback(async () => {
    const capturesWithAnnotations: CaptureLike[] = pendingCaptures.map((c) => ({
      ...c,
      annotation: annotations.get(c.id) ?? c.annotation,
    }));
    await sendCapturesFn(capturesWithAnnotations).catch((e: unknown) =>
      console.warn('[preview] send captures failed', e),
    );
    useSandboxStore.getState().clearCaptures();
    setAnnotationPopoverOpen(false);
    setAnnotations(new Map());
  }, [pendingCaptures, annotations, sendCapturesFn]);

  const onAnnotationCancel = useCallback(() => {
    useSandboxStore.getState().clearCaptures();
    setAnnotationPopoverOpen(false);
    setAnnotations(new Map());
  }, []);

  return {
    pendingCaptures,
    regionOverlayOpen,
    annotationPopoverOpen,
    inspectActive,
    onCaptureClick,
    onRegionClick,
    onInspectClick,
    onRegionSelect,
    onAnnotationChange,
    onAnnotationSubmit,
    onAnnotationCancel,
  };
}
