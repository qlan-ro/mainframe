import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';
import { PreviewRunControl } from './PreviewRunControl';
import { PreviewUrlBar } from './PreviewUrlBar';
import { PreviewDeviceToggle } from './PreviewDeviceToggle';
import { PreviewCaptureCluster } from './PreviewCaptureCluster';

interface PreviewToolbarProps {
  /** The address the URL bar shows until the webview navigates elsewhere. */
  seedUrl: string | null;
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
  seedUrl,
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
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-2"
    >
      <PreviewRunControl status={status} onRun={onRun} onStop={onStop} onRestart={onRestart} />
      <PreviewUrlBar handle={handle} seedUrl={seedUrl} enabled={isRunning} />
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
