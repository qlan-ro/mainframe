/**
 * ElectronPreviewBackend — backs HostBridge.preview.mount on Electron.
 *
 * Injects a <webview partition="persist:sandbox-{projectId}"> into the container
 * (DOM-overlay model: natural z-index stacking, unlike Tauri's OS overlay). capture()
 * uses webContents.capturePage with DPR scaling (scaleCropRect); the element-picker
 * runs INSPECT_SCRIPT via executeJavaScript and resolves inline, fanned out to
 * onInspect subscribers. Ported from the retired desktop renderer PreviewTab.
 */
import type { PreviewOpts, PreviewHandle, Region, InspectResult, Unsubscribe } from '@qlan-ro/mainframe-types';

// Minimal interface for the Electron <webview> DOM element.
// We do NOT import from packages/desktop to keep the dependency unidirectional.
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>;
  capturePage(rect?: CropRect): Promise<{ toDataURL(): string }>;
  executeJavaScript(js: string): Promise<unknown>;
  getZoomFactor?(): number;
  getWebContentsId(): number;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts a CSS-pixel crop rectangle to device pixels by multiplying by the zoom factor.
 * capturePage() operates in device pixels; getBoundingClientRect() returns CSS pixels.
 * At zoom != 1.0 (Cmd+/-), failing to scale causes an offset crop rectangle.
 *
 * Exported for testing.
 */
export function scaleCropRect(rect: CropRect, zoom: number): CropRect {
  return {
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom),
  };
}

// CSS selector generator — injected into the webview page.
const GET_SELECTOR_FN = `
function getSelector(el) {
  if (el.id) return '#' + el.id;
  var parts = [];
  var cur = el;
  while (cur && cur !== document.body) {
    var sel = cur.tagName.toLowerCase();
    if (cur.className && typeof cur.className === 'string') {
      sel += '.' + cur.className.trim().split(/\\s+/).slice(0, 2).join('.');
    }
    parts.unshift(sel);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}
`;

// Ported verbatim from packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx lines 49-99.
// Installs a highlight overlay and returns a Promise that resolves when the user clicks an element.
const INSPECT_SCRIPT = `
(function() {
  ${GET_SELECTOR_FN}
  var old = document.getElementById('__mf_overlay');
  if (old) old.remove();
  if (window.__mf_inspect_cleanup) { window.__mf_inspect_cleanup(); delete window.__mf_inspect_cleanup; }

  var overlay = document.createElement('div');
  overlay.id = '__mf_overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);z-index:999999;transition:all 0.05s;';
  document.body.appendChild(overlay);

  function highlight(el) {
    var r = el.getBoundingClientRect();
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  return new Promise(function(resolve) {
    function cleanup() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      delete window.__mf_inspect_cleanup;
    }
    function onMove(e) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== overlay) highlight(el);
    }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) { resolve(null); return; }
      var rect = el.getBoundingClientRect();
      resolve({ selector: getSelector(el), rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, viewport: { width: window.innerWidth, height: window.innerHeight } });
    }
    function onKey(e) {
      if (e.key === 'Escape') { cleanup(); resolve(null); }
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.__mf_inspect_cleanup = function() { cleanup(); resolve(null); };
  });
})()
`;

interface InspectPickResult {
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)!;
  return bytes;
}

let tabSeq = 0;

export function mountElectronPreview(container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle {
  const tabId = `preview-${++tabSeq}`;
  const partition = `persist:sandbox-${opts?.projectId ?? 'default'}`;
  const inspectCbs = new Set<(r: InspectResult) => void>();

  // Create the <webview> element and position it to fill the container.
  const wv = document.createElement('webview') as unknown as WebviewElement;
  wv.setAttribute('partition', partition);
  wv.setAttribute('src', 'about:blank');
  wv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  container.appendChild(wv);

  // Load the initial URL on dom-ready (getWebContentsId throws before that).
  const navigate = (next: string): Promise<void> =>
    Promise.resolve(
      typeof (wv as unknown as { loadURL?: unknown }).loadURL === 'function' ? wv.loadURL(next) : undefined,
    ).catch((e: unknown) => {
      console.warn('[preview] electron loadURL failed', e);
    });

  wv.addEventListener('dom-ready', () => void navigate(url), { once: true });

  const capture = async (region?: Region): Promise<Uint8Array> => {
    if (typeof (wv as unknown as { capturePage?: unknown }).capturePage !== 'function') {
      throw new Error('capturePage unavailable (webview not ready)');
    }
    const zoom = wv.getZoomFactor?.() ?? 1;
    const crop = region
      ? scaleCropRect({ x: region.x, y: region.y, width: region.w, height: region.h }, zoom)
      : undefined;
    const image = await wv.capturePage(crop);
    return dataUrlToBytes(image.toDataURL());
  };

  const startInspect = async (): Promise<void> => {
    if (typeof (wv as unknown as { executeJavaScript?: unknown }).executeJavaScript !== 'function') return;
    try {
      const raw = (await wv.executeJavaScript(INSPECT_SCRIPT)) as InspectPickResult | null;
      const payload: InspectResult = raw
        ? {
            tabId,
            selector: raw.selector,
            rect: { x: raw.rect.x, y: raw.rect.y, w: raw.rect.width, h: raw.rect.height },
            viewport: { x: 0, y: 0, w: raw.viewport.width, h: raw.viewport.height },
          }
        : { tabId, selector: null, rect: null, viewport: null };
      for (const cb of inspectCbs) cb(payload);
    } catch (e) {
      console.warn('[preview] electron inspect failed', e);
    }
  };

  return {
    setVisible: (visible: boolean): void => {
      wv.style.display = visible ? '' : 'none';
    },
    navigate,
    capture,
    startInspect,
    onInspect: (cb: (r: InspectResult) => void): Unsubscribe => {
      inspectCbs.add(cb);
      return () => {
        inspectCbs.delete(cb);
      };
    },
    refit: (): void => {
      // The <webview> is CSS-sized inside the container; no native repositioning needed.
    },
    setDevice: (device: 'desktop' | 'mobile'): void => {
      wv.style.width = device === 'mobile' ? '390px' : '100%';
    },
    destroy: (): void => {
      try {
        const id = wv.getWebContentsId();
        const mf = (window as unknown as { mainframe?: { destroyWebview(id: number): Promise<void> } }).mainframe;
        mf?.destroyWebview(id).catch((e: unknown) => console.warn('[preview] electron destroyWebview', e));
      } catch (e) {
        // getWebContentsId() throws if dom-ready never fired — tolerate it.
        console.warn('[preview] electron destroy: webContents unavailable', e);
      }
      wv.remove();
    },
  };
}
