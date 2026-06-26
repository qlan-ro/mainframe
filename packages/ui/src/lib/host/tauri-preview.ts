/**
 * TauriPreviewBackend — backs HostBridge.preview.mount on Tauri.
 *
 * Tauri composites a native child WKWebView over the DOM. mount() takes the DOM
 * container, generates a stable tabId, creates the child webview at the
 * container's current rect, and returns a PreviewHandle whose methods delegate to
 * the existing Rust commands (lib/tauri/preview). refit() re-reads the container
 * rect and re-issues preview_set_bounds (the renderer no longer threads bounds
 * through every call).
 */
import type {
  PreviewOpts,
  PreviewHandle,
  Region,
  RegionSelectResult,
  InspectResult,
  Unsubscribe,
} from '@qlan-ro/mainframe-types';
import * as preview from '@/lib/tauri/preview';

let tabSeq = 0;

export function mountTauriPreview(container: HTMLElement, url: string, _opts?: PreviewOpts): PreviewHandle {
  const tabId = `preview-${++tabSeq}`;

  const readBounds = () => {
    const r = container.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  void preview.previewCreate(tabId, url, readBounds()).catch((e) => console.warn('[preview] tauri create', e));

  return {
    setVisible: (visible: boolean): void => {
      void preview.previewSetVisible(tabId, visible).catch((e) => console.warn('[preview] tauri setVisible', e));
    },
    navigate: (next: string): Promise<void> => preview.previewNavigate(tabId, next),
    capture: (region?: Region): Promise<Uint8Array> => preview.previewCapture(tabId, region),
    startInspect: (): Promise<void> =>
      preview.previewEval(tabId, `window.__mfInspectInstall && window.__mfInspectInstall('${tabId}')`),
    onInspect: (cb: (result: InspectResult) => void): Unsubscribe => {
      let unlisten: (() => void) | null = null;
      void preview
        .onInspectResult((result) => {
          if (result.tabId === tabId) cb(result);
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch((e) => console.warn('[preview] tauri onInspect', e));
      return () => unlisten?.();
    },
    // Region select is not yet wired in the Tauri native backend — stub satisfies the interface.
    startRegionSelect: (): Promise<void> => Promise.resolve(),
    onRegionSelect:
      (_cb: (result: RegionSelectResult) => void): Unsubscribe =>
      () => {},
    refit: (): void => {
      void preview.previewSetBounds(tabId, readBounds()).catch((e) => console.warn('[preview] tauri refit', e));
    },
    setDevice: (_device: 'desktop' | 'mobile'): void => {
      // The device toggle resizes the DOM container; immediately re-read its rect
      // into the native layer so the preview webview tracks the new frame without
      // waiting for the next refit() (decision 5).
      void preview.previewSetBounds(tabId, readBounds()).catch((e) => console.warn('[preview] tauri setDevice', e));
    },
    destroy: (): void => {
      void preview.previewDestroy(tabId).catch((e) => console.warn('[preview] tauri destroy', e));
    },
  };
}
