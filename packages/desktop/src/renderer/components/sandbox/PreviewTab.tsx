import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Trash2,
  RotateCw,
  Square,
  Play,
  RefreshCw,
  Crosshair,
  Camera,
  Minus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { startLaunchConfig, stopLaunchConfig } from '../../lib/launch';
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

const INSPECT_CANCEL_SCRIPT = `
(function() {
  if (window.__mf_inspect_cleanup) { window.__mf_inspect_cleanup(); }
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
  const markFreshLaunch = useSandboxStore((s) => s.markFreshLaunch);
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

  // Auto-select process when configs load and nothing is selected — prefer the preview config
  useEffect(() => {
    if (configs.length > 0 && !selectedProcess) {
      const preferred = configs.find((c) => c.preview) ?? configs[0]!;
      setSelectedProcess(preferred.name);
    }
  }, [configs, selectedProcess]);

  // Selected tab's config — drives UI decisions (icons, log styling)
  const selectedProcessConfig = configs.find((c) => c.name === selectedProcess);
  const hasPreview = selectedProcessConfig?.preview === true;
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const selectedProcessStatus = useSandboxStore((s) => {
    if (!selectedProcess || !activeProjectId) return 'stopped' as const;
    return s.processStatuses[activeProjectId]?.[selectedProcess] ?? 'stopped';
  });
  const isSelectedRunning = selectedProcessStatus === 'running' || selectedProcessStatus === 'starting';

  // The preview config — drives webview lifecycle independent of selected tab
  const previewConfig = configs.find((c) => c.preview === true);
  const previewProcessName = previewConfig?.name ?? null;
  const previewUrl = previewConfig
    ? (previewConfig.url ?? (previewConfig.port ? `http://localhost:${previewConfig.port}` : 'about:blank'))
    : 'about:blank';

  // Watch the preview process status (not the selected tab)
  const previewStatus = useSandboxStore((s) => {
    if (!previewProcessName || !activeProjectId) return 'stopped' as const;
    return s.processStatuses[activeProjectId]?.[previewProcessName] ?? 'stopped';
  });

  // Only retry-load when the user explicitly clicked Run (not on reconnect to an already-running process)
  const isFreshLaunch = useSandboxStore((s) => (previewProcessName ? !!s.freshLaunches[previewProcessName] : false));

  // During fresh launches, keep src as about:blank — the retry effect handles navigation via loadURL.
  // For reconnect (not fresh launch), let src drive navigation directly.
  const webviewSrc = previewStatus === 'running' && !isFreshLaunch ? previewUrl : 'about:blank';

  // Track whether the webview has successfully loaded (separate from process status)
  const [webviewReady, setWebviewReady] = useState(false);
  // Ref-based flag so pending retry callbacks can check without stale closure values
  const retryActiveRef = useRef(false);
  // Ref for preview process name used inside the retry effect callbacks (avoids unstable deps)
  const previewProcessRef = useRef(previewProcessName);
  previewProcessRef.current = previewProcessName;

  // Reset ready state and retry flag when process stops/restarts
  useEffect(() => {
    if (previewStatus !== 'running') {
      setWebviewReady(false);
      retryActiveRef.current = false;
    }
  }, [previewStatus]);

  // For reconnect (non-fresh-launch): navigate the webview via loadURL().
  // Electron's <webview> only reads the src attribute on initial mount — changing it
  // via React props does NOT trigger navigation. We must call loadURL() explicitly.
  // loadURL() requires dom-ready to have fired first.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv || isFreshLaunch || previewUrl === 'about:blank' || previewStatus !== 'running') return;

    let cancelled = false;
    const markReady = () => {
      if (!retryActiveRef.current && !cancelled) setWebviewReady(true);
    };

    const navigate = () => {
      if (cancelled) return;
      try {
        const currentUrl = wv.getURL?.() as string | undefined;
        if (currentUrl === previewUrl && !wv.isLoading?.()) {
          markReady();
          return;
        }
      } catch {
        /* not ready yet */
      }
      wv.loadURL(previewUrl)
        .then(markReady)
        .catch(() => {});
    };

    // Wait for dom-ready if the webview isn't ready yet
    try {
      // getURL() throws if dom-ready hasn't fired
      wv.getURL();
      navigate();
    } catch {
      wv.addEventListener('dom-ready', navigate, { once: true });
    }
    return () => {
      cancelled = true;
      wv.removeEventListener('dom-ready', navigate);
    };
  }, [isFreshLaunch, previewProcessName, previewUrl, previewStatus]);

  // Retry loading the webview URL until the server responds or 60s elapses.
  // Only activates on fresh launches (user clicked Run), not on reconnect.
  // Uses loadURL()'s promise to detect success — resolves when page loads, rejects on failure.
  // Schedule: every 1s for the first 10s, then every 5s until 60s.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv || !previewProcessName || !isFreshLaunch) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const startTime = Date.now();
    retryActiveRef.current = true;

    const finish = (success: boolean) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      retryActiveRef.current = false;
      if (success) setWebviewReady(true);
      const name = previewProcessRef.current;
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
    };
  }, [previewUrl, previewProcessName, isFreshLaunch]);

  const [logExpandedPerTab, setLogExpandedPerTab] = useState<Record<string, boolean>>({});
  const logExpanded = selectedProcess ? (logExpandedPerTab[selectedProcess] ?? !hasPreview) : true;
  const setLogExpanded = useCallback(
    (expanded: boolean) => {
      if (!selectedProcess) return;
      setLogExpandedPerTab((prev) => ({ ...prev, [selectedProcess]: expanded }));
    },
    [selectedProcess],
  );
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logsOutput]);

  const filteredLogs = logsOutput.filter(
    (l) => l.projectId === activeProjectId && (!selectedProcess || l.name === selectedProcess),
  );

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (inspecting) {
      if (wv) wv.executeJavaScript(INSPECT_CANCEL_SCRIPT).catch(() => {});
      setInspecting(false);
      return;
    }
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

  const handleStop = useCallback(async () => {
    if (!activeProjectId || !selectedProcess) return;
    try {
      await stopLaunchConfig(activeProjectId, selectedProcess);
    } catch (err) {
      console.warn('[sandbox] stop failed', err);
    }
  }, [activeProjectId, selectedProcess]);

  const handleStart = useCallback(async () => {
    if (!activeProjectId || !selectedProcessConfig) return;
    try {
      clearLogsForName(selectedProcessConfig.name);
      markFreshLaunch(selectedProcessConfig.name);
      await startLaunchConfig(activeProjectId, selectedProcessConfig.name);
    } catch (err) {
      console.warn('[sandbox] start failed', err);
    }
  }, [activeProjectId, selectedProcessConfig, clearLogsForName, markFreshLaunch]);

  const handleRestart = useCallback(async () => {
    if (!activeProjectId || !selectedProcessConfig) return;
    try {
      await stopLaunchConfig(activeProjectId, selectedProcessConfig.name);
      clearLogsForName(selectedProcessConfig.name);
      markFreshLaunch(selectedProcessConfig.name);
      await startLaunchConfig(activeProjectId, selectedProcessConfig.name);
    } catch (err) {
      console.warn('[sandbox] restart failed', err);
    }
  }, [activeProjectId, selectedProcessConfig, clearLogsForName, markFreshLaunch]);

  const isElectron = typeof window !== 'undefined' && 'mainframe' in window;

  return (
    <Tabs
      data-testid="preview-tab"
      value={selectedProcess ?? ''}
      onValueChange={setSelectedProcess}
      className="h-full flex flex-col"
    >
      {/* Header row: process tabs + actions */}
      <div className="flex items-center justify-between shrink-0 border-b border-mf-divider">
        <TabsList className="h-11 px-[10px] bg-transparent justify-start gap-1 shrink-0 rounded-none">
          {configs.length === 0 ? (
            <span className="text-mf-small text-mf-text-secondary">No processes running</span>
          ) : (
            configs.map((c) => (
              <TabsTrigger key={c.name} value={c.name} className="text-mf-small">
                {c.name}
              </TabsTrigger>
            ))
          )}
        </TabsList>
        <div className="flex items-center pr-2">
          {/* Process controls: play (stopped) or restart+stop (running) */}
          {selectedProcess &&
            (isSelectedRunning ? (
              <>
                <button
                  onClick={() => void handleRestart()}
                  className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                  title="Restart"
                >
                  <RotateCw size={14} />
                </button>
                <button
                  onClick={() => void handleStop()}
                  className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-red-400 transition-colors"
                  title="Stop"
                >
                  <Square size={14} />
                </button>
              </>
            ) : (
              <button
                onClick={() => void handleStart()}
                className="p-1.5 rounded hover:bg-mf-hover text-mf-accent transition-colors"
                title="Start"
              >
                <Play size={14} />
              </button>
            ))}
          {selectedProcess && <div className="w-px h-3.5 bg-mf-border mx-0.5" />}
          {/* Preview controls: reload, inspect, screenshot */}
          {hasPreview && (
            <>
              <button
                onClick={handleReload}
                className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                title="Reload"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => void handleInspect()}
                className={[
                  'p-1.5 rounded transition-colors',
                  inspecting
                    ? 'bg-mf-hover text-mf-accent'
                    : 'hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary',
                ].join(' ')}
                title="Pick element"
              >
                <Crosshair size={14} />
              </button>
              <button
                onClick={() => void handleFullScreenshot()}
                className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                title="Screenshot"
              >
                <Camera size={14} />
              </button>
              <div className="w-px h-3.5 bg-mf-border mx-0.5" />
            </>
          )}
          {/* Window controls: minimize */}
          <button
            onClick={() => setPanelVisible(false)}
            className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
        </div>
      </div>

      {configs.length === 0 ? (
        /* Empty state — no processes */
        <div className="flex-1 flex items-center justify-center text-mf-text-secondary text-sm">
          No processes running
        </div>
      ) : (
        <>
          {/* Webview — always mounted when a preview config exists, zero-dimensioned when another tab is selected.
               MUST NOT use display:none (hidden class) — Electron webviews don't initialize their guest process
               when display:none, breaking loadURL and did-finish-load events. */}
          {previewConfig ? (
            <div
              className={hasPreview ? 'flex-1 overflow-hidden min-h-0 relative mx-2 my-2' : ''}
              style={hasPreview ? undefined : { position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
            >
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
                  {(previewStatus === 'starting' || previewStatus === 'running') && (
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-3 h-3 border-[1.5px] border-mf-text-secondary border-t-transparent rounded-full animate-spin shrink-0" />
                      Waiting for {previewUrl !== 'about:blank' ? previewUrl : 'server'}
                    </span>
                  )}
                  {previewStatus === 'failed' && <span className="text-red-400">Process failed to start</span>}
                  {previewStatus === 'stopped' && (
                    <span>
                      Run Launch Configuration <strong>▷</strong> to see your app here
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* Log output area — takes all space when no preview */}
          <div className={hasPreview ? 'border-t border-mf-divider shrink-0' : 'flex-1 flex flex-col min-h-0'}>
            <div className="flex items-center justify-between px-2 h-7 shrink-0">
              <span className="text-xs text-mf-text-secondary font-medium">Console</span>
              <div className="flex items-center">
                <button
                  onClick={() => {
                    if (selectedProcess) clearLogsForName(selectedProcess);
                  }}
                  disabled={!selectedProcess}
                  className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors disabled:opacity-40"
                  title="Clear logs"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  onClick={() => setLogExpanded(!logExpanded)}
                  className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                  title={logExpanded ? 'Collapse logs' : 'Expand logs'}
                >
                  {logExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
              </div>
            </div>
            {logExpanded && (
              <div
                ref={logRef}
                data-testid="preview-console-output"
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
    </Tabs>
  );
}
