import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useSandboxStore } from '../../store/sandbox';
import { useLaunchConfig } from '../../hooks/useLaunchConfig';

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
  const { addCapture, logsOutput, clearLogsForProcess } = useSandboxStore();

  const launchConfig = useLaunchConfig();
  const configs = launchConfig?.configurations ?? [];

  // Derive preview config and URL from launch config
  const previewConfig = configs.find((c) => c.preview);
  const previewUrl = previewConfig
    ? (previewConfig.url ?? (previewConfig.port ? `http://localhost:${previewConfig.port}` : 'about:blank'))
    : 'about:blank';

  // Watch the preview process status
  const previewStatus = useSandboxStore((s) =>
    previewConfig ? (s.processStatuses[previewConfig.name] ?? 'stopped') : 'stopped',
  );

  // Keep address bar in sync with config URL
  useEffect(() => {
    if (previewUrl !== 'about:blank') setUrl(previewUrl);
  }, [previewUrl]);

  // Only navigate the webview once the process is running
  const webviewSrc = previewStatus === 'running' ? previewUrl : 'about:blank';

  // Track whether the webview has successfully loaded (separate from process status)
  const [webviewReady, setWebviewReady] = useState(false);

  // Reset ready state when process stops/restarts
  useEffect(() => {
    if (previewStatus !== 'running') setWebviewReady(false);
  }, [previewStatus]);

  // Attach webview event listeners for load success and retry on connection refused
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv || previewStatus !== 'running') return;

    const handleFinishLoad = () => setWebviewReady(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleFailLoad = (e: any) => {
      // ERR_CONNECTION_REFUSED (-102) — server not ready yet, retry after 2s
      if (e.errorCode === -102) {
        setTimeout(() => {
          wv.loadURL(previewUrl);
        }, 2000);
      }
    };

    wv.addEventListener('did-finish-load', handleFinishLoad);
    wv.addEventListener('did-fail-load', handleFailLoad);
    return () => {
      wv.removeEventListener('did-finish-load', handleFinishLoad);
      wv.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, [previewStatus, previewUrl]);

  const [logExpanded, setLogExpanded] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-select first process when configs load
  useEffect(() => {
    if (configs.length > 0 && !selectedProcess) {
      setSelectedProcess(configs[0]!.name);
    }
  }, [configs, selectedProcess]);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logsOutput]);

  const filteredLogs = selectedProcess ? logsOutput.filter((l) => l.name === selectedProcess) : logsOutput;

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
      <div className="flex-1 overflow-hidden min-h-0 relative">
        {isElectron ? (
          // @ts-expect-error — webview is an Electron-specific HTML element not present in React's type definitions
          <webview ref={webviewRef} src={webviewSrc} className="w-full h-full" />
        ) : (
          <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">
            Preview panel requires Electron. Use <code className="mx-1">pnpm dev:desktop</code> instead of{' '}
            <code className="mx-1">dev:web</code>.
          </div>
        )}
        {/* Status overlay — shown until webview successfully loads */}
        {isElectron && !webviewReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-mf-app-bg text-mf-text-secondary text-sm">
            {(previewStatus === 'starting' || previewStatus === 'running') && <span>Starting…</span>}
            {previewStatus === 'failed' && <span className="text-red-400">Process failed to start</span>}
            {previewStatus === 'stopped' && (
              <span>
                Start processes with <strong>▷ Preview</strong> to see your app here
              </span>
            )}
          </div>
        )}
      </div>

      {/* Log strip */}
      <div className="border-t border-mf-divider shrink-0 bg-mf-app-bg">
        {/* Header */}
        <div className="flex items-center justify-between px-2 h-7">
          <select
            value={selectedProcess ?? ''}
            onChange={(e) => setSelectedProcess(e.target.value || null)}
            className="text-xs bg-transparent text-mf-text-secondary border-none outline-none cursor-pointer max-w-[160px]"
          >
            {configs.length === 0 && <option value="">No processes</option>}
            {configs.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLogExpanded((v) => !v)}
              className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-1"
              title={logExpanded ? 'Collapse logs' : 'Expand logs'}
            >
              {logExpanded ? '∨' : '∧'}
            </button>
            <button
              onClick={() => {
                if (selectedProcess) clearLogsForProcess(selectedProcess);
              }}
              disabled={!selectedProcess}
              className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-1 disabled:opacity-40"
              title="Clear logs"
            >
              ✕
            </button>
          </div>
        </div>
        {/* Log output */}
        {logExpanded && (
          <div
            ref={logRef}
            style={{ height: 150 }}
            className="overflow-y-auto px-2 pb-2 font-mono text-xs text-mf-text-secondary"
          >
            {filteredLogs.length === 0 ? (
              <span>No output yet.</span>
            ) : (
              filteredLogs.map((l, i) => (
                <div key={`${i}-${l.name}-${l.stream}`} className={l.stream === 'stderr' ? 'text-red-400' : ''}>
                  {l.data}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
