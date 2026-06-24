import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';
import { PreviewRunControl } from './PreviewRunControl';
import { PreviewUrlBar } from './PreviewUrlBar';
import { PreviewDeviceToggle } from './PreviewDeviceToggle';
import { PreviewCaptureCluster } from './PreviewCaptureCluster';

interface PreviewToolbarProps {
  tabId: string;
  port: number | null;
  configName: string | undefined;
  projectId: string | undefined;
  daemonPort: number;
  status: LaunchProcessStatus | null;
  device: 'desktop' | 'mobile';
  onDeviceChange: (d: 'desktop' | 'mobile') => void;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
  onCaptureClick: () => void;
  onRegionClick: () => void;
  onInspectClick: () => void;
  inspectActive: boolean;
  regionActive?: boolean;
  handle?: PreviewHandle | null;
}

export function PreviewToolbar({
  tabId: _tabId,
  port,
  status,
  device,
  onDeviceChange,
  onRun,
  onStop,
  onRestart,
  onCaptureClick,
  onRegionClick,
  onInspectClick,
  inspectActive,
  regionActive = false,
  handle = null,
}: PreviewToolbarProps) {
  const isRunning = status === 'running';

  return (
    <div
      data-testid="preview-toolbar"
      className="flex h-[38px] flex-shrink-0 items-center gap-[8px] [border-bottom:0.5px_solid_var(--border)] bg-background px-[8px]"
    >
      <PreviewRunControl status={status} onRun={onRun} onStop={onStop} onRestart={onRestart} />
      <PreviewUrlBar handle={handle} port={port} isRunning={isRunning} />
      <PreviewDeviceToggle device={device} onChange={onDeviceChange} />
      <PreviewCaptureCluster
        isRunning={isRunning}
        inspectActive={inspectActive}
        regionActive={regionActive}
        onCaptureClick={onCaptureClick}
        onRegionClick={onRegionClick}
        onInspectClick={onInspectClick}
      />
    </div>
  );
}
