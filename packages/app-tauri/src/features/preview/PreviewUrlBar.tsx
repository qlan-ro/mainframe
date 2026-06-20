import { RotateCw, ExternalLink, Eraser } from 'lucide-react';
import { PreviewIconButton } from './PreviewIconButton';
import { previewNavigate } from '@/lib/tauri/preview';

interface PreviewUrlBarProps {
  tabId: string;
  port: number | null;
  isRunning: boolean;
}

export function PreviewUrlBar({ tabId, port, isRunning }: PreviewUrlBarProps) {
  function handleReload() {
    if (!port) return;
    previewNavigate(tabId, `http://localhost:${port}`).catch((e) =>
      console.warn('[preview] url-bar reload', e),
    );
  }

  function handleOpenBrowser() {
    // No previewOpenExternal — use previewNavigate as fallback
    console.warn('[preview] open-in-browser: no external open API, using navigate fallback');
    if (!port) return;
    previewNavigate(tabId, `http://localhost:${port}`).catch((e) =>
      console.warn('[preview] url-bar open-browser', e),
    );
  }

  function handleClearCache() {
    if (!port) return;
    previewNavigate(tabId, `http://localhost:${port}`).catch((e) =>
      console.warn('[preview] url-bar clear-cache', e),
    );
  }

  return (
    <div className="flex-1 flex items-center gap-0.5 h-[26px] rounded-md border-[0.5px] border-border bg-card pl-0.5 pr-[4px]">
      <PreviewIconButton
        testId="preview-url-reload"
        title="Reload preview"
        onClick={handleReload}
        disabled={!isRunning}
      >
        <RotateCw size={13} />
      </PreviewIconButton>

      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mx-0.5 ${
          isRunning ? 'bg-mf-success animate-pulse' : 'bg-mf-text-4'
        }`}
      />

      <span
        className={`flex-1 min-w-0 font-mono text-caption overflow-hidden text-ellipsis whitespace-nowrap px-[4px] ${
          isRunning ? 'text-muted-foreground' : 'text-mf-text-4'
        }`}
      >
        {port !== null ? `localhost:${port}` : 'localhost:…'}
      </span>

      <PreviewIconButton
        testId="preview-url-open-browser"
        title="Open in browser"
        onClick={handleOpenBrowser}
        disabled={!isRunning}
        className="text-mf-text-3"
      >
        <ExternalLink size={12} />
      </PreviewIconButton>

      <PreviewIconButton
        testId="preview-url-clear-cache"
        title="Clear cache"
        onClick={handleClearCache}
        disabled={!isRunning}
        className="text-mf-text-3"
      >
        <Eraser size={13} />
      </PreviewIconButton>
    </div>
  );
}
