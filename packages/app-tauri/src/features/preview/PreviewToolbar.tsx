import { RefreshCw, Camera, Crop, Search, ExternalLink, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { previewNavigate } from '@/lib/tauri/preview';
import { stopLaunchConfig } from '@/lib/api/launch';

interface PreviewToolbarProps {
  tabId: string;
  port: number | null;
  configName: string | undefined;
  projectId: string | undefined;
  daemonPort: number;
  onCaptureClick: () => void;
  onRegionClick: () => void;
  onInspectClick: () => void;
}

export function PreviewToolbar({
  tabId,
  port,
  configName,
  projectId,
  daemonPort,
  onCaptureClick,
  onRegionClick,
  onInspectClick,
}: PreviewToolbarProps) {
  function handleReload() {
    if (!port) return;
    previewNavigate(tabId, `http://localhost:${port}`).catch((e) => console.warn('[preview] toolbar reload', e));
  }

  function handleOpenBrowser() {
    if (!port) return;
    previewNavigate(tabId, `http://localhost:${port}`).catch((e) => console.warn('[preview] toolbar open-browser', e));
  }

  function handleStop() {
    if (!configName || !projectId) return;
    stopLaunchConfig(daemonPort, projectId, configName).catch((e) => console.warn('[preview] toolbar stop', e));
  }

  return (
    <div
      data-testid="preview-toolbar"
      className="flex h-[34px] flex-shrink-0 items-center gap-1 border-b border-border bg-card px-2"
    >
      <Button
        data-testid="preview-toolbar-reload"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handleReload}
        title="Reload"
        aria-label="Reload preview"
      >
        <RefreshCw size={12} />
      </Button>
      <Button
        data-testid="preview-toolbar-capture"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onCaptureClick}
        title="Capture full page"
        aria-label="Capture full page"
      >
        <Camera size={12} />
      </Button>
      <Button
        data-testid="preview-toolbar-region"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onRegionClick}
        title="Capture region"
        aria-label="Capture region"
      >
        <Crop size={12} />
      </Button>
      <Button
        data-testid="preview-toolbar-inspect"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onInspectClick}
        title="Inspect element"
        aria-label="Inspect element"
      >
        <Search size={12} />
      </Button>
      <Button
        data-testid="preview-toolbar-open-browser"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handleOpenBrowser}
        title="Open in browser"
        aria-label="Open in browser"
      >
        <ExternalLink size={12} />
      </Button>
      <Button
        data-testid="preview-toolbar-stop"
        variant="ghost"
        size="icon"
        className="h-6 w-6 ml-auto"
        onClick={handleStop}
        title="Stop server"
        aria-label="Stop server"
      >
        <Square size={12} />
      </Button>
    </div>
  );
}
