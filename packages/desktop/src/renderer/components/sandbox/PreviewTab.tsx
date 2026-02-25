import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { LaunchConfig } from '@mainframe/types';
import { useSandboxStore } from '../../store/sandbox';
import { useProjectsStore } from '../../store/projects';

// CSS selector generator — injected into the webview page
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

const INSPECT_SCRIPT = `
(function() {
  ${GET_SELECTOR_FN}
  var old = document.getElementById('__mf_overlay');
  if (old) old.remove();

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
    function onMove(e) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== overlay) highlight(el);
    }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      overlay.remove();
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) { resolve(null); return; }
      var rect = el.getBoundingClientRect();
      resolve({ selector: getSelector(el), rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } });
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
  });
})()
`;

interface ElementPickResult {
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
}

export function PreviewTab(): React.ReactElement {
  const webviewRef = useRef<HTMLElement>(null);
  const [url, setUrl] = useState('about:blank');
  const [inspecting, setInspecting] = useState(false);
  const { addCapture } = useSandboxStore();
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? (s.projects.find((p) => p.id === s.activeProjectId) ?? null) : null,
  );

  // Load preview URL from launch config when project changes
  useEffect(() => {
    if (!activeProject) return;
    void window.mainframe
      .readFile(`${activeProject.path}/.mainframe/launch.json`)
      .then((content) => {
        if (!content) return;
        const config = JSON.parse(content) as LaunchConfig;
        const preview = config.configurations.find((c) => c.preview);
        if (!preview) return;
        const previewUrl = preview.url ?? (preview.port ? `http://localhost:${preview.port}` : null);
        if (previewUrl) setUrl(previewUrl);
      })
      .catch(() => {
        /* no launch.json — expected */
      });
  }, [activeProject?.id]);

  const handleFullScreenshot = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv) return;
    try {
      const image = (await wv.capturePage()) as { toDataURL: () => string };
      const dataUrl = image.toDataURL();
      addCapture({ type: 'screenshot', imageDataUrl: dataUrl });
    } catch (err) {
      console.warn('[sandbox] full screenshot failed', err);
    }
  }, [addCapture]);

  const handleInspect = useCallback(async () => {
    if (inspecting) {
      setInspecting(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv) return;
    setInspecting(true);
    try {
      const result = (await wv.executeJavaScript(INSPECT_SCRIPT)) as ElementPickResult | null;
      if (!result) return;

      const image = (await wv.capturePage({
        x: Math.round(result.rect.x),
        y: Math.round(result.rect.y),
        width: Math.round(result.rect.width),
        height: Math.round(result.rect.height),
      })) as { toDataURL: () => string };
      const dataUrl = image.toDataURL();
      addCapture({ type: 'element', imageDataUrl: dataUrl, selector: result.selector });
    } catch (err) {
      console.warn('[sandbox] inspect failed', err);
    } finally {
      setInspecting(false);
    }
  }, [inspecting, addCapture]);

  const handleReload = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;

    wv?.reload();
  }, []);

  const handleAddressKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wv = webviewRef.current as any;

        wv?.loadURL(url);
      }
    },
    [url],
  );

  const isElectron = typeof window !== 'undefined' && 'mainframe' in window;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-mf-divider bg-mf-app-bg shrink-0">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleAddressKeyDown}
          className="flex-1 text-xs bg-mf-input-bg rounded px-2 py-1 text-mf-text-primary border border-mf-divider"
          placeholder="http://localhost:3000"
        />
        <button
          onClick={handleReload}
          className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-2 py-1 rounded"
          title="Reload"
        >
          ↺
        </button>
        <button
          onClick={() => void handleInspect()}
          className={[
            'text-xs px-2 py-1 rounded',
            inspecting ? 'bg-blue-500 text-white' : 'text-mf-text-secondary hover:text-mf-text-primary',
          ].join(' ')}
          title="Pick element"
        >
          ⊕
        </button>
        <button
          onClick={() => void handleFullScreenshot()}
          className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-2 py-1 rounded"
          title="Full screenshot"
        >
          📷
        </button>
      </div>

      {/* Webview or fallback */}
      <div className="flex-1 overflow-hidden">
        {isElectron ? (
          // @ts-expect-error — webview is an Electron-specific HTML element not present in React's type definitions
          <webview ref={webviewRef} src={url} className="w-full h-full" />
        ) : (
          <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">
            Preview panel requires Electron. Use <code className="mx-1">pnpm dev:desktop</code> instead of{' '}
            <code className="mx-1">dev:web</code>.
          </div>
        )}
      </div>
    </div>
  );
}
