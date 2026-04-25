import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  Trash2,
  RotateCw,
  Square,
  Play,
  RefreshCw,
  Crosshair,
  Camera,
  ChevronDown,
  ChevronUp,
  Smartphone,
  Frame,
} from 'lucide-react';
import { RegionCaptureOverlay, type CaptureRect } from './RegionCaptureOverlay.js';
import { CaptureAnnotationPopover } from './CaptureAnnotationPopover.js';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { startLaunchConfig, stopLaunchConfig } from '../../lib/launch';
import { useSandboxStore } from '../../store/sandbox';
import { useChatsStore } from '../../store/chats';
import { useActiveProjectId, getActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useLaunchScopeKey } from '../../hooks/useLaunchScopeKey.js';
import { daemonClient } from '../../lib/client';
import { getDefaultModelForAdapter } from '../../lib/adapters';
import { useLaunchConfig } from '../../hooks/useLaunchConfig';
import { useZoneHeaderTabs } from '../zone/ZoneHeaderSlot.js';

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
 */
export function scaleCropRect(rect: CropRect, zoom: number): CropRect {
  return {
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom),
  };
}

export function PreviewTab(): React.ReactElement {
  const webviewRef = useRef<HTMLElement>(null);
  const [inspecting, setInspecting] = useState(false);
  const [capturingRegion, setCapturingRegion] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<{ rect: CaptureRect; dataUrl: string } | null>(null);
  const webviewWrapperRef = useRef<HTMLDivElement>(null);
  const [mobileView, setMobileView] = useState(false);
  const addCapture = useSandboxStore((s) => s.addCapture);
  const logsOutput = useSandboxStore((s) => s.logsOutput);
  const clearLogsForProcess = useSandboxStore((s) => s.clearLogsForProcess);
  const setLastStartedProcess = useSandboxStore((s) => s.setLastStartedProcess);
  const scopeKey = useLaunchScopeKey();
  const launchConfig = useLaunchConfig();
  const configs = launchConfig?.configurations ?? [];

  // Selected process tab — single source of truth in sandbox store
  const selectedConfigName = useSandboxStore((s) => s.selectedConfigName);
  const setSelectedConfigName = useSandboxStore((s) => s.setSelectedConfigName);

  // Auto-select when configs load and nothing is selected yet
  useEffect(() => {
    if (configs.length > 0 && !selectedConfigName) {
      const preferred = configs.find((c) => c.preview) ?? configs[0]!;
      setSelectedConfigName(preferred.name);
    }
  }, [configs, selectedConfigName, setSelectedConfigName]);

  const selectedProcess = selectedConfigName;
  const setSelectedProcess = setSelectedConfigName;

  // Selected tab's config — drives UI decisions (icons, log styling)
  const selectedProcessConfig = configs.find((c) => c.name === selectedProcess);
  const hasPreview = selectedProcessConfig?.preview === true;
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const selectedProcessStatus = useSandboxStore((s) => {
    if (!selectedProcess || !scopeKey) return 'stopped' as const;
    return s.processStatuses[scopeKey]?.[selectedProcess] ?? 'stopped';
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
    if (!previewProcessName || !scopeKey) return 'stopped' as const;
    return s.processStatuses[scopeKey]?.[previewProcessName] ?? 'stopped';
  });

  // Track whether the webview has successfully loaded (separate from process status)
  const [webviewReady, setWebviewReady] = useState(false);

  // Draggable console height (when preview is active)
  const [consoleHeight, setConsoleHeight] = useState(150);
  const consoleDragging = useRef(false);
  const consoleDragStartY = useRef(0);
  const consoleDragStartH = useRef(0);

  const onConsoleSeparatorDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      consoleDragging.current = true;
      consoleDragStartY.current = e.clientY;
      consoleDragStartH.current = consoleHeight;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [consoleHeight],
  );

  const onConsoleSeparatorMove = useCallback((e: React.PointerEvent) => {
    if (!consoleDragging.current) return;
    // Dragging up → increases console height
    const delta = consoleDragStartY.current - e.clientY;
    setConsoleHeight(Math.max(60, consoleDragStartH.current + delta));
  }, []);

  const onConsoleSeparatorUp = useCallback(() => {
    consoleDragging.current = false;
  }, []);

  // Reset ready state when process stops or scope changes (worktree switch)
  useEffect(() => {
    if (previewStatus !== 'running') {
      setWebviewReady(false);
    }
  }, [previewStatus]);

  useEffect(() => {
    setWebviewReady(false);
    setSelectedProcess(null);
  }, [scopeKey]);

  // Navigate the webview when process becomes running.
  // Daemon waits for port readiness before emitting 'running', so the server should be available.
  // Electron's <webview> only reads the src attribute on initial mount — changing it
  // via React props does NOT trigger navigation. We must call loadURL() explicitly.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv || previewUrl === 'about:blank' || previewStatus !== 'running') return;

    let cancelled = false;

    const navigate = () => {
      if (cancelled) return;
      try {
        const currentUrl = wv.getURL?.() as string | undefined;
        if (currentUrl === previewUrl && !wv.isLoading?.()) {
          setWebviewReady(true);
          return;
        }
      } catch {
        /* not ready yet */
      }
      wv.loadURL(previewUrl)
        .then(() => {
          if (cancelled) return;
          setWebviewReady(true);
        })
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
  }, [previewProcessName, previewUrl, previewStatus]);

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
    (l) => l.scopeKey === scopeKey && (!selectedProcess || l.name === selectedProcess),
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
        const projectId = getActiveProjectId();
        if (projectId) daemonClient.createChat(projectId, 'claude', getDefaultModelForAdapter('claude'));
      }
    } catch (err) {
      console.warn('[sandbox] full screenshot failed', err);
    }
  }, [addCapture]);

  const handleRegionComplete = useCallback(async (rect: CaptureRect | null) => {
    setCapturingRegion(false);
    if (!rect) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wv = webviewRef.current as any;
    if (!wv) return;
    try {
      const zoom: number = (wv.getZoomFactor?.() as number | undefined) ?? 1;
      const cropRect = scaleCropRect(rect, zoom);
      const image = (await wv.capturePage(cropRect)) as { toDataURL: () => string };
      const dataUrl = image.toDataURL();
      setPendingCapture({ rect, dataUrl });

      if (!useChatsStore.getState().activeChatId) {
        const projectId = getActiveProjectId();
        if (projectId) daemonClient.createChat(projectId, 'claude', getDefaultModelForAdapter('claude'));
      }
    } catch (err) {
      console.warn('[sandbox] region capture failed', err);
    }
  }, []);

  const handleAnnotationSubmit = useCallback(
    (annotation: string) => {
      if (!pendingCapture) return;
      addCapture({ type: 'screenshot', imageDataUrl: pendingCapture.dataUrl, annotation: annotation || undefined });
      setPendingCapture(null);
    },
    [addCapture, pendingCapture],
  );

  const handleAnnotationClose = useCallback(() => {
    setPendingCapture(null);
  }, []);

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

      // getBoundingClientRect() returns CSS pixels, but capturePage() operates in device pixels.
      // At non-1.0 zoom (Cmd+/Cmd-), we must scale the crop rect by the zoom factor to avoid offset captures.
      const zoom: number = (wv.getZoomFactor?.() as number | undefined) ?? 1;
      const cropRect = scaleCropRect({ x, y, width: right - x, height: bottom - y }, zoom);
      const image = (await wv.capturePage(cropRect)) as { toDataURL: () => string };
      const dataUrl = image.toDataURL();
      addCapture({ type: 'element', imageDataUrl: dataUrl, selector: result.selector });

      // Auto-create a chat session if none is active so the composer appears
      if (!useChatsStore.getState().activeChatId) {
        const projectId = getActiveProjectId();
        if (projectId) daemonClient.createChat(projectId, 'claude', getDefaultModelForAdapter('claude'));
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
      await stopLaunchConfig(activeProjectId, selectedProcess, activeChatId ?? undefined);
    } catch (err) {
      console.warn('[sandbox] stop failed', err);
    }
  }, [activeProjectId, activeChatId, selectedProcess]);

  const handleStart = useCallback(async () => {
    if (!activeProjectId || !selectedProcessConfig) return;
    try {
      if (scopeKey) clearLogsForProcess(scopeKey, selectedProcessConfig.name);
      setLastStartedProcess(selectedProcessConfig.name);
      await startLaunchConfig(activeProjectId, selectedProcessConfig.name, activeChatId ?? undefined);
    } catch (err) {
      console.warn('[sandbox] start failed', err);
    }
  }, [activeProjectId, activeChatId, selectedProcessConfig, scopeKey, clearLogsForProcess, setLastStartedProcess]);

  const handleRestart = useCallback(async () => {
    if (!activeProjectId || !selectedProcessConfig) return;
    try {
      await stopLaunchConfig(activeProjectId, selectedProcessConfig.name, activeChatId ?? undefined);
      if (scopeKey) clearLogsForProcess(scopeKey, selectedProcessConfig.name);
      await startLaunchConfig(activeProjectId, selectedProcessConfig.name, activeChatId ?? undefined);
    } catch (err) {
      console.warn('[sandbox] restart failed', err);
    }
  }, [activeProjectId, activeChatId, selectedProcessConfig, scopeKey, clearLogsForProcess]);

  const isElectron = typeof window !== 'undefined' && 'mainframe' in window;

  // Register process tabs with ZoneHeader
  const processTabs = useMemo(() => configs.map((c) => ({ id: c.name, label: c.name })), [configs]);
  const handleProcessTabChange = useCallback((tabId: string) => setSelectedProcess(tabId), []);
  useZoneHeaderTabs(processTabs, selectedProcess, handleProcessTabChange);

  return (
    <div data-testid="preview-tab" className="h-full flex flex-col">
      {/* Action bar — process controls + preview tools */}
      <div className="flex items-center h-7 px-2 shrink-0 border-b border-mf-divider gap-0.5">
        {selectedProcess &&
          (isSelectedRunning ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => void handleRestart()}
                    className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                  >
                    <RotateCw size={13} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Restart</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => void handleStop()}
                    className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-red-400 transition-colors"
                  >
                    <Square size={13} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Stop</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => void handleStart()}
                  className="p-1 rounded hover:bg-mf-hover text-mf-accent transition-colors"
                >
                  <Play size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Start</TooltipContent>
            </Tooltip>
          ))}
        {hasPreview && (
          <>
            {selectedProcess && <div className="w-px h-3.5 bg-mf-border mx-0.5" />}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleReload}
                  className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                >
                  <RefreshCw size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Reload</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => void handleInspect()}
                  className={[
                    'p-1 rounded transition-colors',
                    inspecting
                      ? 'bg-mf-hover text-mf-accent'
                      : 'hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary',
                  ].join(' ')}
                >
                  <Crosshair size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Pick element</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => void handleFullScreenshot()}
                  className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                >
                  <Camera size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Screenshot</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCapturingRegion((v) => !v)}
                  className={[
                    'p-1 rounded transition-colors',
                    capturingRegion
                      ? 'bg-mf-hover text-mf-accent'
                      : 'hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary',
                  ].join(' ')}
                >
                  <Frame size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Region capture</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setMobileView((v) => !v)}
                  className={[
                    'p-1 rounded transition-colors',
                    mobileView
                      ? 'bg-mf-hover text-mf-accent'
                      : 'hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary',
                  ].join(' ')}
                >
                  <Smartphone size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Mobile view (390x844)</TooltipContent>
            </Tooltip>
            {isElectron && activeProjectId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      window.mainframe.clearSandboxSession(activeProjectId).then(() => handleReload());
                    }}
                    className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Clear cookies & session data</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
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
              ref={webviewWrapperRef}
              className={
                hasPreview ? 'flex-1 overflow-hidden min-h-0 relative mx-2 my-2 flex items-start justify-center' : ''
              }
              style={hasPreview ? undefined : { position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
            >
              {isElectron ? (
                // Electron webviews render in a separate GPU process and paint OVER regular DOM,
                // so visibility:hidden doesn't help. Use zero dimensions to truly hide until ready.
                <webview
                  key={scopeKey ?? activeProjectId ?? 'default'}
                  ref={webviewRef}
                  src="about:blank"
                  partition={`persist:sandbox-${activeProjectId ?? 'default'}`}
                  className={
                    webviewReady ? (mobileView ? 'h-full rounded border border-mf-border' : 'w-full h-full') : ''
                  }
                  style={
                    webviewReady
                      ? mobileView
                        ? { width: 390, maxHeight: 844 }
                        : undefined
                      : { position: 'absolute', width: 0, height: 0, overflow: 'hidden' }
                  }
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
              {/* Region capture overlay — shown when region capture mode is active */}
              {capturingRegion && webviewReady && (
                <RegionCaptureOverlay
                  containerRef={webviewWrapperRef}
                  onComplete={(rect) => {
                    void handleRegionComplete(rect);
                  }}
                />
              )}
              {/* Annotation popover — shown after a region has been captured */}
              {pendingCapture && (
                <CaptureAnnotationPopover
                  anchorRect={pendingCapture.rect}
                  containerRef={webviewWrapperRef}
                  imageDataUrl={pendingCapture.dataUrl}
                  onSubmit={handleAnnotationSubmit}
                  onClose={handleAnnotationClose}
                />
              )}
            </div>
          ) : null}

          {/* Draggable separator between preview and console */}
          {hasPreview && (
            <div
              className="h-1.5 shrink-0 cursor-row-resize group flex items-center"
              onPointerDown={onConsoleSeparatorDown}
              onPointerMove={onConsoleSeparatorMove}
              onPointerUp={onConsoleSeparatorUp}
            >
              <div className="h-px w-full bg-mf-divider group-hover:bg-mf-text-secondary group-active:bg-mf-text-secondary transition-colors" />
            </div>
          )}

          {/* Log output area — takes all space when no preview */}
          <div className={hasPreview ? 'shrink-0 flex flex-col' : 'flex-1 flex flex-col min-h-0'}>
            <div className="flex items-center justify-between px-2 h-7 shrink-0">
              <span className="text-xs text-mf-text-secondary font-medium">Console</span>
              <div className="flex items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        if (selectedProcess && scopeKey) clearLogsForProcess(scopeKey, selectedProcess);
                      }}
                      disabled={!selectedProcess}
                      className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Clear logs</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setLogExpanded(!logExpanded)}
                      className="p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                    >
                      {logExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{logExpanded ? 'Collapse logs' : 'Expand logs'}</TooltipContent>
                </Tooltip>
              </div>
            </div>
            {logExpanded && (
              <div
                ref={logRef}
                data-testid="preview-console-output"
                className={[
                  'overflow-y-auto px-2 pb-2 font-mono text-xs text-mf-text-secondary whitespace-pre-wrap select-text',
                  hasPreview ? '' : 'flex-1',
                ].join(' ')}
                style={hasPreview ? { height: consoleHeight } : undefined}
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
