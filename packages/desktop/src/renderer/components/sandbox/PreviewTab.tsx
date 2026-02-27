import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { useSandboxStore } from '../../store/sandbox';
import { useChatsStore } from '../../store/chats';
import { useProjectsStore } from '../../store/projects';
import { useUIStore } from '../../store/ui';
import { daemonClient } from '../../lib/client';
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
      resolve({ selector: getSelector(el), rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, viewport: { width: window.innerWidth, height: window.innerHeight } });
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
  });
})()
`;

interface ElementPickResult {
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}

export function PreviewTab(): React.ReactElement {
  const webviewRef = useRef<HTMLElement>(null);
  const [inspecting, setInspecting] = useState(false);
  const addCapture = useSandboxStore((s) => s.addCapture);
  const logsOutput = useSandboxStore((s) => s.logsOutput);
  const clearLogsForName = useSandboxStore((s) => s.clearLogsForName);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);

  const launchConfig = useLaunchConfig();
  const configs = launchConfig?.configurations ?? [];

  // Selected process tab
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);

  // Switch to the tab of a freshly launched process.
  // freshLaunchSeq increments on every markFreshLaunch call, ensuring this effect
  // re-fires even when the same process is re-launched (same selector string).
  const freshLaunchedProcess = useSandboxStore((s) => {
    for (const [name, active] of Object.entries(s.freshLaunches)) {
      if (active) return name;
    }
    return null;
  });
  const freshLaunchSeq = useSandboxStore((s) => s.freshLaunchSeq);

  useEffect(() => {
    if (freshLaunchedProcess) setSelectedProcess(freshLaunchedProcess);
  }, [freshLaunchedProcess, freshLaunchSeq]);

  // Auto-select first process when configs load and nothing is selected
  useEffect(() => {
    if (configs.length > 0 && !selectedProcess) {
      setSelectedProcess(configs[0]!.name);
    }
  }, [configs, selectedProcess]);

  // Derive preview config and URL from selected process
  const selectedProcessConfig = configs.find((c) => c.name === selectedProcess);
  const hasPreview = selectedProcessConfig?.preview === true;
  const previewUrl =
    hasPreview && selectedProcessConfig
      ? (selectedProcessConfig.url ??
        (selectedProcessConfig.port ? `http://localhost:${selectedProcessConfig.port}` : 'about:blank'))
      : 'about:blank';

  // Watch the selected process status — searches across all projects
  const previewStatus = useSandboxStore((s) => {
    if (!selectedProcess) return 'stopped' as const;
    for (const projStatuses of Object.values(s.processStatuses)) {
      const st = projStatuses[selectedProcess];
      if (st) return st;
    }
    return 'stopped' as const;
  });

  // Only retry-load when the user explicitly clicked Run (not on reconnect to an already-running process)
  const isFreshLaunch = useSandboxStore((s) => (selectedProcess ? !!s.freshLaunches[selectedProcess] : false));

  // During fresh launches, keep src as about:blank — the retry effect handles navigation via loadURL.
  // For reconnect (not fresh launch), let src drive navigation directly.
  const webviewSrc = previewStatus === 'running' && !isFreshLaunch ? previewUrl : 'about:blank';

  // Track whether the webview has successfully loaded (separate from process status)
  const [webviewReady, setWebviewReady] = useState(false);
  // True only while the retry effect is actively polling
  const [webviewLoading, setWebviewLoading] = useState(false);
  // Ref-based flag so pending retry callbacks can check without stale closure values
  const retryActiveRef = useRef(false);
  // Ref for selectedProcess used inside the retry effect callbacks (avoids unstable deps)
  const selectedProcessRef = useRef(selectedProcess);
  selectedProcessRef.current = selectedProcess;

  // Reset ready state and retry flag when process stops/restarts
  useEffect(() => {
    if (previewStatus !== 'running') {
      setWebviewReady(false);
      retryActiveRef.current = false;
    }
  }, [previewStatus]);

  // For reconnect (non-fresh-launch): detect when the webview loads via src attribute.
  // Also check immediately in case the page loaded before the effect ran.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv || isFreshLaunch) return;
    const markReady = () => {
      if (!retryActiveRef.current) setWebviewReady(true);
    };
    // Check if the page already loaded before we added the listener
    try {
      const url = wv.getURL?.() as string | undefined;
      if (url && url !== 'about:blank' && !wv.isLoading?.()) {
        markReady();
        return;
      }
    } catch {
      // getURL/isLoading may throw before dom-ready — fall through to listener
    }
    wv.addEventListener('did-finish-load', markReady);
    return () => wv.removeEventListener('did-finish-load', markReady);
  }, [isFreshLaunch, selectedProcess]);

  // Reset webview state when switching process tabs
  useEffect(() => {
    setWebviewReady(false);
    retryActiveRef.current = false;
  }, [selectedProcess]);

  // Retry loading the webview URL until the server responds or 60s elapses.
  // Only activates on fresh launches (user clicked Run), not on reconnect.
  // Uses loadURL()'s promise to detect success — resolves when page loads, rejects on failure.
  // Schedule: every 1s for the first 10s, then every 5s until 60s.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv || !hasPreview || !isFreshLaunch) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const startTime = Date.now();
    retryActiveRef.current = true;
    setWebviewLoading(true);

    const finish = (success: boolean) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      retryActiveRef.current = false;
      setWebviewLoading(false);
      if (success) setWebviewReady(true);
      const name = selectedProcessRef.current;
      if (name) useSandboxStore.getState().clearFreshLaunch(name);
    };

    const attemptLoad = async () => {
      if (stopped) return;
      const elapsed = Date.now() - startTime;
      if (elapsed >= 60_000) {
        finish(false);
        return;
      }
      try {
        // loadURL returns a promise: resolves on success, rejects on failure
        await wv.loadURL(previewUrl);
        finish(true);
        return;
      } catch {
        // ERR_CONNECTION_REFUSED, ERR_ABORTED, dom-not-ready throw — all retryable
      }
      if (stopped) return;
      const delay = elapsed < 10_000 ? 1000 : 5000;
      timer = setTimeout(() => void attemptLoad(), delay);
    };

    // Start after a brief delay to let dom-ready fire for the initial about:blank
    timer = setTimeout(() => void attemptLoad(), 500);

    return () => {
      stopped = true;
      clearTimeout(timer);
      retryActiveRef.current = false;
      setWebviewLoading(false);
    };
  }, [previewUrl, hasPreview, isFreshLaunch]);

  const [logExpanded, setLogExpanded] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logsOutput]);

  // Filter logs by process name only — no project scoping
  const filteredLogs = logsOutput.filter((l) => !selectedProcess || l.name === selectedProcess);

  const handleFullScreenshot = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv) return;
    try {
      const image = (await wv.capturePage()) as { toDataURL: () => string };
      const dataUrl = image.toDataURL();
      addCapture({ type: 'screenshot', imageDataUrl: dataUrl });

      if (!useChatsStore.getState().activeChatId) {
        const projectId = useProjectsStore.getState().activeProjectId;
        if (projectId) daemonClient.createChat(projectId, 'claude');
      }
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

      // Add padding around the element for context, clamped to viewport
      const PAD = 20;
      const x = Math.max(0, Math.round(result.rect.x - PAD));
      const y = Math.max(0, Math.round(result.rect.y - PAD));
      const right = Math.min(result.viewport.width, result.rect.x + result.rect.width + PAD);
      const bottom = Math.min(result.viewport.height, result.rect.y + result.rect.height + PAD);

      const image = (await wv.capturePage({
        x,
        y,
        width: Math.round(right - x),
        height: Math.round(bottom - y),
      })) as { toDataURL: () => string };
      const dataUrl = image.toDataURL();
      addCapture({ type: 'element', imageDataUrl: dataUrl, selector: result.selector });

      // Auto-create a chat session if none is active so the composer appears
      if (!useChatsStore.getState().activeChatId) {
        const projectId = useProjectsStore.getState().activeProjectId;
        if (projectId) daemonClient.createChat(projectId, 'claude');
      }
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

  const isElectron = typeof window !== 'undefined' && 'mainframe' in window;

  return (
    <div className="h-full flex flex-col">
      {/* Header row: process tabs + minimize */}
      <div className="flex items-center justify-between px-2 h-8 shrink-0 border-b border-mf-divider">
        <div className="flex items-center gap-1">
          {configs.length === 0 ? (
            <span className="text-xs text-mf-text-secondary">No processes running</span>
          ) : (
            configs.map((c) => (
              <button
                key={c.name}
                onClick={() => setSelectedProcess(c.name)}
                className={[
                  'px-3 py-1 text-xs rounded transition-colors border',
                  selectedProcess === c.name
                    ? 'bg-mf-button-bg text-mf-text-primary border-mf-border'
                    : 'text-mf-text-secondary hover:text-mf-text-primary border-transparent hover:border-mf-border',
                ].join(' ')}
              >
                {c.name}
              </button>
            ))
          )}
        </div>
        <button
          onClick={() => setPanelVisible(false)}
          className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-2 py-1 rounded"
          title="Minimize"
        >
          _
        </button>
      </div>

      {configs.length === 0 ? (
        /* Empty state — no processes */
        <div className="flex-1 flex items-center justify-center text-mf-text-secondary text-sm">
          No processes running
        </div>
      ) : (
        <>
          {/* Preview area for selected process */}
          {hasPreview ? (
            <>
              {/* Toolbar — only shown when selected process has preview */}
              <div className="flex items-center gap-2 px-3 py-1.5 shrink-0">
                <div className="flex-1 flex items-center gap-2 px-3 py-[5px] rounded-mf-card border border-mf-border text-mf-text-secondary text-mf-body truncate">
                  {webviewLoading && (
                    <span className="inline-block w-3 h-3 border-[1.5px] border-mf-text-secondary border-t-transparent rounded-full animate-spin shrink-0" />
                  )}
                  {previewUrl !== 'about:blank' ? previewUrl : 'http://localhost:3000'}
                </div>
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

              {/* Webview */}
              <div className="flex-1 overflow-hidden min-h-0 relative mx-2 my-2">
                {isElectron ? (
                  // @ts-expect-error — webview is an Electron-specific HTML element not present in React's type definitions
                  // Electron webviews render in a separate GPU process and paint OVER regular DOM,
                  // so visibility:hidden doesn't help. Use zero dimensions to truly hide until ready.
                  <webview
                    ref={webviewRef}
                    src={webviewSrc}
                    className={webviewReady ? 'w-full h-full' : ''}
                    style={webviewReady ? undefined : { position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-mf-text-secondary text-sm">
                    Preview panel requires Electron. Use <code className="mx-1">pnpm dev:desktop</code> instead of{' '}
                    <code className="mx-1">dev:web</code>.
                  </div>
                )}
                {/* Status overlay — shown until webview successfully loads */}
                {isElectron && !webviewReady && (
                  <div className="absolute inset-0 flex items-center justify-center text-mf-text-secondary text-sm">
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
            </>
          ) : null}

          {/* Log output area — takes all space when no preview */}
          <div className={hasPreview ? 'border-t border-mf-divider shrink-0' : 'flex-1 flex flex-col min-h-0'}>
            <div className="flex items-center justify-between px-2 h-7 shrink-0">
              <span className="text-xs text-mf-text-secondary font-medium">Console</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (selectedProcess) clearLogsForName(selectedProcess);
                  }}
                  disabled={!selectedProcess}
                  className="text-mf-text-secondary hover:text-mf-text-primary px-1 disabled:opacity-40"
                  title="Clear logs"
                >
                  <Trash2 size={12} />
                </button>
                <button
                  onClick={() => setLogExpanded((v) => !v)}
                  className="text-xs text-mf-text-secondary hover:text-mf-text-primary px-1"
                  title={logExpanded ? 'Collapse logs' : 'Expand logs'}
                >
                  {logExpanded ? '∨' : '∧'}
                </button>
              </div>
            </div>
            {logExpanded && (
              <div
                ref={logRef}
                className={[
                  'overflow-y-auto px-2 pb-2 font-mono text-xs text-mf-text-secondary',
                  hasPreview ? '' : 'flex-1',
                ].join(' ')}
                style={hasPreview ? { height: 150 } : undefined}
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
        </>
      )}
    </div>
  );
}
