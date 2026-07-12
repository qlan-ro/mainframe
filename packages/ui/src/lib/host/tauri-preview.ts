/**
 * TauriPreviewBackend — backs HostBridge.preview.mount on Tauri.
 *
 * Tauri composites a native child WKWebView over the DOM. mount() takes the DOM
 * container, generates a stable tabId, creates the child webview at the
 * container's current rect, and returns a PreviewHandle whose methods delegate to
 * the existing Rust commands (lib/tauri/preview). refit() re-reads the anchor
 * rect and re-issues preview_set_bounds.
 *
 * Every native op is serialized behind the create call (and each other). The
 * preview_* commands are independent async IPC — without ordering, setVisible/
 * destroy can reach Rust before preview_create registers the tab. Observed live:
 * "[preview] tauri setVisible no preview tab" (a hide that never applies — the
 * webview stays composited over the app) and child webviews orphaned by a
 * destroy that raced ahead of its create. The op chain makes each call wait for
 * its predecessors, so those interleavings cannot happen.
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
import { getUiZoom } from '@/lib/tauri/bridge';

let tabSeq = 0;

export function mountTauriPreview(container: HTMLElement, url: string, _opts?: PreviewOpts): PreviewHandle {
  const tabId = `preview-${++tabSeq}`;
  let anchorEl = container;

  const readBounds = () => {
    const r = anchorEl.getBoundingClientRect();
    // The native child webview is positioned in window-logical px. Under UI page
    // zoom, a CSS-px DOM rect maps to (css × zoom) logical px, so scale to match
    // the anchor (z === 1 when unzoomed, leaving the original behaviour intact).
    const z = getUiZoom();
    return { x: r.left * z, y: r.top * z, w: r.width * z, h: r.height * z };
  };

  // Per-tab op chain: each native call runs only after every earlier one
  // settled. The chain itself never rejects (failures continue the chain);
  // the returned promise carries the op's own result/rejection to the caller.
  let chain: Promise<unknown> = preview
    .previewCreate(tabId, url, readBounds())
    .catch((e) => console.warn('[preview] tauri create', e));
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = chain.then(op);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const setBounds = (): void => {
    // A detached anchor reports a 0×0 rect at the window origin — never send
    // that to the native layer; the lifecycle re-anchors before the next refit.
    // Checked at call time AND at op-run time (the anchor can detach while the
    // op waits in the chain).
    if (!anchorEl.isConnected) return;
    void enqueue(() =>
      anchorEl.isConnected ? preview.previewSetBounds(tabId, readBounds()) : Promise.resolve(),
    ).catch((e) => console.warn('[preview] tauri setBounds', e));
  };

  return {
    setVisible: (visible: boolean): void => {
      void enqueue(() => preview.previewSetVisible(tabId, visible)).catch((e) =>
        console.warn('[preview] tauri setVisible', e),
      );
    },
    compositesAboveDom: true,
    navigate: (next: string): Promise<void> => enqueue(() => preview.previewNavigate(tabId, next)),
    capture: (region?: Region): Promise<Uint8Array> => enqueue(() => preview.previewCapture(tabId, region)),
    // Clears service-worker/Cache-API entries + web storage, then reloads. Does
    // NOT purge the native HTTP disk cache (no WKWebView API from JS) — enough for
    // a dev preview whose staleness is almost always app-level cached responses.
    clearCache: (): Promise<void> =>
      enqueue(() =>
        preview.previewEval(
          tabId,
          `(async () => {
             try { if (self.caches) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } } catch (e) {}
             try { localStorage.clear(); } catch (e) {}
             try { sessionStorage.clear(); } catch (e) {}
             location.reload();
           })()`,
        ),
      ),
    startInspect: (): Promise<void> =>
      enqueue(() => preview.previewEval(tabId, `window.__mfInspectInstall && window.__mfInspectInstall('${tabId}')`)),
    cancelInspect: (): Promise<void> =>
      enqueue(() => preview.previewEval(tabId, `window.__mfInspectCancel && window.__mfInspectCancel()`)),
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
    startRegionSelect: (): Promise<void> =>
      enqueue(() =>
        preview.previewEval(tabId, `window.__mfRegionSelectInstall && window.__mfRegionSelectInstall('${tabId}')`),
      ),
    cancelRegionSelect: (): Promise<void> =>
      enqueue(() => preview.previewEval(tabId, `window.__mfRegionSelectCancel && window.__mfRegionSelectCancel()`)),
    onRegionSelect: (cb: (result: RegionSelectResult) => void): Unsubscribe => {
      let unlisten: (() => void) | null = null;
      void preview
        .onRegionSelectResult((result) => {
          if (result.tabId === tabId) cb(result);
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch((e) => console.warn('[preview] tauri onRegionSelect', e));
      return () => unlisten?.();
    },
    onNavigate: (cb: (url: string) => void): Unsubscribe => {
      let unlisten: (() => void) | null = null;
      void preview
        .onNavigateResult((result) => {
          if (result.tabId === tabId) cb(result.url);
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch((e) => console.warn('[preview] tauri onNavigate', e));
      return () => unlisten?.();
    },
    refit: setBounds,
    reanchor: (el: HTMLElement): void => {
      anchorEl = el;
      setBounds();
    },
    // The device toggle resizes the DOM container; immediately re-read its rect
    // into the native layer so the preview webview tracks the new frame without
    // waiting for the next refit() (decision 5).
    setDevice: (_device: 'desktop' | 'mobile'): void => setBounds(),
    destroy: (): void => {
      void enqueue(() => preview.previewDestroy(tabId)).catch((e) => console.warn('[preview] tauri destroy', e));
    },
  };
}
