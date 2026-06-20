import { useRef, useState } from 'react';
import { usePreviewLifecycle } from './use-preview-lifecycle';
import { usePreviewGeometry } from './use-preview-geometry';
import { usePreviewVisibility } from './use-preview-visibility';
import { usePreviewOcclusion } from './use-preview-occlusion';
import { usePreviewCapture } from './use-preview-capture';
import { PreviewToolbar } from './PreviewToolbar';
import { PreviewBodyState } from './PreviewBodyState';
import { ConsolePane } from '@/features/run/ConsolePane';
import { RegionCaptureOverlay } from './RegionCaptureOverlay';
import { CaptureAnnotationPopover } from './CaptureAnnotationPopover';
import { mfToast } from '@/lib/toast';
import { useSandboxStore } from '@/store/sandbox';
import { startLaunchConfig, stopLaunchConfig } from '@/lib/api/launch';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';

interface PreviewInstanceProps {
  tabId: string;
  config?: string;
  visible: boolean;
  scopeKey?: string;
  port?: number | null;
  projectId?: string;
}

export function PreviewInstance({
  tabId,
  config,
  visible,
  scopeKey,
  port: portProp,
  projectId,
}: PreviewInstanceProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  // Launch calls must target the RESOLVED daemon port (not a hardcoded default)
  // and carry the active chatId — the daemon resolves the worktree path from the
  // chat, and the worktree's launch.json is where preview configs live. Omitting
  // chatId resolves to the project root, which 404s ("config not found").
  const daemonPort = useDaemonPort();
  const identity = useActiveIdentity();
  const chatId = identity.chatId;
  // projectId arrives as a prop (RunSurface), but fall back to the live active
  // identity so a launch never silently no-ops on an undefined prop.
  const effectiveProjectId = projectId ?? identity.projectId;

  const status = useSandboxStore((s): LaunchProcessStatus | null => {
    if (!config) return null;
    if (scopeKey) {
      const v = s.processStatuses[scopeKey]?.[config];
      return v ?? null;
    }
    for (const scopeStatuses of Object.values(s.processStatuses)) {
      if (config in scopeStatuses) return scopeStatuses[config] ?? null;
    }
    return null;
  });

  const port = portProp ?? null;

  usePreviewLifecycle({ tabId, status, port, anchorRef });
  usePreviewGeometry({ tabId, anchorRef, containerRef, active: visible, status });
  // Hide the native webview only while a DOM overlay actually overlaps it (it
  // composites above the DOM, so popovers/dialogs/CMD-F would be clipped behind
  // it otherwise). Precise overlap → no gratuitous blanking.
  const occluded = usePreviewOcclusion(anchorRef, status === 'running');
  const [, setOverlayMounted] = usePreviewVisibility(tabId, visible, occluded);

  const {
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
  } = usePreviewCapture(tabId, setOverlayMounted);

  function handleStart() {
    if (!config) return;
    if (!effectiveProjectId) {
      console.warn('[preview] start blocked — no active projectId', {
        config,
        chatId,
        propProjectId: projectId,
        hookProjectId: identity.projectId,
      });
      mfToast.error('Cannot start: no active project context');
      return;
    }
    startLaunchConfig(daemonPort, effectiveProjectId, config, chatId).catch((e) => {
      mfToast.error(`Failed to start "${config}": ${e instanceof Error ? e.message : String(e)}`);
      console.warn('[preview] start failed', e);
    });
  }

  function handleStop() {
    if (!config || !effectiveProjectId) return;
    stopLaunchConfig(daemonPort, effectiveProjectId, config, chatId).catch((e) => {
      mfToast.error(`Failed to stop "${config}"`);
      console.warn('[preview] stop', e);
    });
  }

  async function handleRestart() {
    if (!config || !effectiveProjectId) return;
    try {
      await stopLaunchConfig(daemonPort, effectiveProjectId, config, chatId);
      await startLaunchConfig(daemonPort, effectiveProjectId, config, chatId);
    } catch (e) {
      mfToast.error(`Failed to restart "${config}"`);
      console.warn('[preview] restart', e);
    }
  }

  return (
    <div
      data-testid={`preview-instance-${tabId}`}
      className="absolute inset-0 flex flex-col"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
    >
      <PreviewToolbar
        tabId={tabId}
        port={port}
        configName={config}
        projectId={projectId}
        daemonPort={daemonPort}
        status={status}
        device={device}
        onDeviceChange={setDevice}
        onRun={handleStart}
        onStop={handleStop}
        onRestart={handleRestart}
        onCaptureClick={onCaptureClick}
        onRegionClick={onRegionClick}
        onInspectClick={onInspectClick}
        inspectActive={inspectActive}
        regionActive={regionOverlayOpen}
      />
      <div ref={containerRef} className="relative min-h-0 flex-1">
        <PreviewBodyState
          status={status}
          configName={config}
          port={port}
          device={device}
          inspectActive={inspectActive}
          anchorRef={anchorRef}
          onStart={handleStart}
        />
      </div>
      {config && <ConsolePane scopeKey={scopeKey ?? ''} processName={config} variant="drawer" />}
      {regionOverlayOpen && (
        <RegionCaptureOverlay onRegionSelect={onRegionSelect} onClose={onRegionClick} />
      )}
      {annotationPopoverOpen && (
        <CaptureAnnotationPopover
          captures={pendingCaptures}
          onAnnotationChange={onAnnotationChange}
          onSubmit={onAnnotationSubmit}
          onCancel={onAnnotationCancel}
        />
      )}
    </div>
  );
}
