import { useState, useCallback, useEffect } from 'react';
import type { InspectResult, Region, PreviewHandle } from '@qlan-ro/mainframe-types';
import { useSandboxStore } from '@/store/sandbox';
import { useSendCaptures } from './use-send-captures';
import type { CaptureLike } from '@/features/run/format-captures';

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return `data:image/png;base64,${btoa(binary)}`;
}

const PAD = 20;

export function usePreviewCapture(handle: PreviewHandle | null, setOverlayMounted: (v: boolean) => void) {
  const [regionOverlayOpen, setRegionOverlayOpen] = useState(false);
  const [annotationPopoverOpen, setAnnotationPopoverOpen] = useState(false);
  const [inspectActive, setInspectActive] = useState(false);
  const [annotations, setAnnotations] = useState<Map<string, string>>(new Map());
  const pendingCaptures = useSandboxStore((s) => s.captures);
  const sendCapturesFn = useSendCaptures();

  useEffect(() => {
    if (!handle) return;
    const handleInspectResult = (result: InspectResult) => {
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
      handle
        .capture(region)
        .then((bytes) => {
          useSandboxStore.getState().addCapture({
            type: 'element',
            imageDataUrl: bytesToDataUrl(bytes),
            selector: result.selector ?? undefined,
          });
          setAnnotationPopoverOpen(true);
        })
        .catch((e: unknown) => console.warn('[preview] capture failed', e));
    };
    const unsub = handle.onInspect(handleInspectResult);
    return () => unsub();
  }, [handle]);

  useEffect(() => {
    setOverlayMounted(regionOverlayOpen || annotationPopoverOpen);
  }, [regionOverlayOpen, annotationPopoverOpen, setOverlayMounted]);

  const onCaptureClick = useCallback(() => {
    handle
      ?.capture()
      .then((bytes) => {
        useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: bytesToDataUrl(bytes) });
        setAnnotationPopoverOpen(true);
      })
      .catch((e: unknown) => console.warn('[preview] capture failed', e));
  }, [handle]);

  const onRegionClick = useCallback(() => setRegionOverlayOpen((prev) => !prev), []);

  const onInspectClick = useCallback(() => {
    setInspectActive((prev) => {
      const next = !prev;
      if (next) handle?.startInspect().catch((e: unknown) => console.warn('[preview] inspect failed', e));
      return next;
    });
  }, [handle]);

  const onRegionSelect = useCallback(
    (region: Region) => {
      setRegionOverlayOpen(false);
      handle
        ?.capture(region)
        .then((bytes) => {
          useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: bytesToDataUrl(bytes) });
          setAnnotationPopoverOpen(true);
        })
        .catch((e: unknown) => console.warn('[preview] capture failed', e));
    },
    [handle],
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
