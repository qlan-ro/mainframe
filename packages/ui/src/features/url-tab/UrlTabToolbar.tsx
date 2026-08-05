/**
 * The URL tab's toolbar. Same address bar, device toggle and capture cluster as
 * the preview tab; the run/stop controls and the console drawer are absent
 * rather than disabled — a URL tab has no process behind it (#281, AC5).
 */
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { PreviewUrlBar } from '@/features/preview/PreviewUrlBar';
import { PreviewDeviceToggle } from '@/features/preview/PreviewDeviceToggle';
import { PreviewCaptureCluster } from '@/features/preview/PreviewCaptureCluster';

interface UrlTabToolbarProps {
  /** The tab's committed address — never the tunnel URL it resolves to. */
  url: string;
  handle: PreviewHandle | null;
  device: 'desktop' | 'mobile';
  onDeviceChange: (d: 'desktop' | 'mobile') => void;
  onCommitUrl: (url: string) => void;
  onCaptureClick: () => void;
  onRegionClick: () => void;
  onInspectClick: () => void;
  inspectActive: boolean;
  regionActive?: boolean;
}

export function UrlTabToolbar({
  url,
  handle,
  device,
  onDeviceChange,
  onCommitUrl,
  onCaptureClick,
  onRegionClick,
  onInspectClick,
  inspectActive,
  regionActive = false,
}: UrlTabToolbarProps) {
  return (
    <div
      data-testid="url-tab-toolbar"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-2"
    >
      {/* Always enabled: typing a new address is the only way out of the failed,
          stopped and invalid states, and none of them has a webview mounted. */}
      <PreviewUrlBar handle={handle} seedUrl={url} enabled onCommitUrl={onCommitUrl} />
      <PreviewDeviceToggle device={device} onChange={onDeviceChange} />
      <PreviewCaptureCluster
        isRunning={handle !== null}
        inspectActive={inspectActive}
        regionActive={regionActive}
        onCaptureClick={onCaptureClick}
        onRegionClick={onRegionClick}
        onInspectClick={onInspectClick}
      />
    </div>
  );
}
