import { useState, useCallback, useEffect } from 'react';
import type { InspectResult, Region, PreviewHandle, RegionSelectResult } from '@qlan-ro/mainframe-types';
import { useSandboxStore } from '@/store/sandbox';
import { useAddToDraft } from '@/features/chat/composer/draft-content/use-add-to-draft';

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return `data:image/png;base64,${btoa(binary)}`;
}

const PAD = 20;

export function usePreviewCapture(handle: PreviewHandle | null, setOverlayMounted: (v: boolean) => void) {
  const [regionSelectActive, setRegionSelectActive] = useState(false);
  const [annotationPopoverOpen, setAnnotationPopoverOpen] = useState(false);
  const [annotationBackdrop, setAnnotationBackdrop] = useState<string | null>(null);
  const [inspectActive, setInspectActive] = useState(false);
  const [annotations, setAnnotations] = useState<Map<string, string>>(new Map());
  const pendingCaptures = useSandboxStore((s) => s.captures);
  const addToDraft = useAddToDraft();

  const openAnnotation = useCallback(async () => {
    if (handle?.compositesAboveDom) {
      try {
        const bytes = await handle.capture();
        setAnnotationBackdrop(bytesToDataUrl(bytes));
      } catch (e: unknown) {
        console.warn('[preview] backdrop capture failed', e);
        setAnnotationBackdrop(null);
      }
    }
    setAnnotationPopoverOpen(true);
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    const handleInspectResult = (result: InspectResult) => {
      // Any result ends the pick — the child-side picker self-removes on both
      // click and Escape, so the toolbar button must not stay lit.
      setInspectActive(false);
      if (result.selector === null) return;
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
          void openAnnotation();
        })
        .catch((e: unknown) => console.warn('[preview] capture failed', e));
    };
    const handleRegionResult = (result: RegionSelectResult) => {
      setRegionSelectActive(false);
      if (!result.region) return;
      const { w, h } = result.region;
      handle
        .capture(result.region)
        .then((bytes) => {
          useSandboxStore
            .getState()
            .addCapture({ type: 'screenshot', imageDataUrl: bytesToDataUrl(bytes), region: { w, h } });
          void openAnnotation();
        })
        .catch((e: unknown) => console.warn('[preview] capture failed', e));
    };
    const unsubInspect = handle.onInspect(handleInspectResult);
    const unsubRegion = handle.onRegionSelect(handleRegionResult);
    return () => {
      unsubInspect();
      unsubRegion();
    };
  }, [handle, openAnnotation]);

  useEffect(() => {
    setOverlayMounted(annotationPopoverOpen);
  }, [annotationPopoverOpen, setOverlayMounted]);

  const onCaptureClick = useCallback(() => {
    handle
      ?.capture()
      .then((bytes) => {
        useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: bytesToDataUrl(bytes) });
        void openAnnotation();
      })
      .catch((e: unknown) => console.warn('[preview] capture failed', e));
  }, [handle, openAnnotation]);

  // Inspect and region are mutually exclusive toggles: at most one is active,
  // selecting one cancels the other, and clicking the active one turns it off.
  const onInspectClick = useCallback(() => {
    if (inspectActive) {
      setInspectActive(false);
      handle?.cancelInspect?.().catch((e: unknown) => console.warn('[preview] inspect cancel failed', e));
      return;
    }
    if (regionSelectActive) {
      setRegionSelectActive(false);
      handle?.cancelRegionSelect?.().catch((e: unknown) => console.warn('[preview] region cancel failed', e));
    }
    setInspectActive(true);
    handle?.startInspect().catch((e: unknown) => {
      setInspectActive(false);
      console.warn('[preview] inspect failed', e);
    });
  }, [handle, inspectActive, regionSelectActive]);

  const onRegionClick = useCallback(() => {
    if (!handle) return;
    if (regionSelectActive) {
      setRegionSelectActive(false);
      handle.cancelRegionSelect?.().catch((e: unknown) => console.warn('[preview] region cancel failed', e));
      return;
    }
    if (inspectActive) {
      setInspectActive(false);
      handle.cancelInspect?.().catch((e: unknown) => console.warn('[preview] inspect cancel failed', e));
    }
    setRegionSelectActive(true);
    handle.startRegionSelect().catch((e: unknown) => {
      setRegionSelectActive(false);
      console.warn('[preview] region select failed', e);
    });
  }, [handle, inspectActive, regionSelectActive]);

  const onAnnotationChange = useCallback((id: string, annotation: string) => {
    setAnnotations((prev) => new Map(prev).set(id, annotation));
  }, []);

  const onAnnotationSubmit = useCallback(() => {
    const added = addToDraft(
      pendingCaptures.map(({ id, annotation, ...capture }) => ({
        kind: 'capture' as const,
        ...capture,
        note: annotations.get(id) ?? annotation ?? '',
      })),
    );
    // With no message to add to, the captures and their notes stay here.
    if (!added) return;
    useSandboxStore.getState().clearCaptures();
    setAnnotationPopoverOpen(false);
    setAnnotationBackdrop(null);
    setAnnotations(new Map());
  }, [pendingCaptures, annotations, addToDraft]);

  const onAnnotationCancel = useCallback(() => {
    useSandboxStore.getState().clearCaptures();
    setAnnotationPopoverOpen(false);
    setAnnotationBackdrop(null);
    setAnnotations(new Map());
  }, []);

  return {
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
  };
}
