import { useRef } from 'react';
import { usePreviewLifecycle } from './use-preview-lifecycle';
import { usePreviewGeometry } from './use-preview-geometry';
import { usePreviewVisibility } from './use-preview-visibility';
import { PreviewToolbar } from './PreviewToolbar';
import { useSandboxStore } from '@/store/sandbox';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';

interface PreviewInstanceProps {
  tabId: string;
  config?: string;
  visible: boolean;
  scopeKey?: string;
  port?: number | null;
  projectId?: string;
  daemonPort?: number;
}

export function PreviewInstance({
  tabId,
  config,
  visible,
  scopeKey,
  port: portProp,
  projectId,
  daemonPort = 31415,
}: PreviewInstanceProps) {
  const anchorRef = useRef<HTMLDivElement>(null);

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

  const { processStopped } = usePreviewLifecycle({ tabId, status, port, anchorRef });
  usePreviewGeometry({ tabId, anchorRef, active: visible });
  const [, setOverlayMounted] = usePreviewVisibility(tabId, visible);
  void setOverlayMounted;

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
        onCaptureClick={() => {
          /* Unit D */
        }}
        onRegionClick={() => {
          /* Unit D */
        }}
        onInspectClick={() => {
          /* Unit E */
        }}
      />
      <div className="relative min-h-0 flex-1">
        <div ref={anchorRef} data-testid={`preview-anchor-${tabId}`} className="absolute inset-0" />
        {processStopped && (
          <div
            data-testid="preview-stopped-placeholder"
            className="absolute inset-0 grid place-items-center bg-card text-muted-foreground text-body"
          >
            Process stopped
          </div>
        )}
      </div>
    </div>
  );
}
