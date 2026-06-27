import { useEffect, useState } from 'react';
import { RotateCw, ExternalLink, Eraser } from 'lucide-react';
import { PreviewIconButton } from './PreviewIconButton';
import { usePreviewAddress } from './use-preview-address';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';

interface PreviewUrlBarProps {
  handle: PreviewHandle | null;
  port: number | null;
  isRunning: boolean;
}

export function PreviewUrlBar({ handle, port, isRunning }: PreviewUrlBarProps) {
  const { currentUrl, navigateTo } = usePreviewAddress(handle, port);
  const [draft, setDraft] = useState(currentUrl);
  const [invalid, setInvalid] = useState(false);

  // Keep the editable draft in sync when the current URL changes (port re-seed
  // or an in-webview navigation). Overwrites an in-progress edit by design —
  // the bar always shows the live URL, matching a browser address bar.
  useEffect(() => {
    setDraft(currentUrl);
    setInvalid(false);
  }, [currentUrl]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (!navigateTo(draft)) setInvalid(true);
    } else if (e.key === 'Escape') {
      setDraft(currentUrl);
      setInvalid(false);
    }
  }

  function handleReload() {
    if (!port) return;
    handle?.navigate(`http://localhost:${port}`).catch((e: unknown) => console.warn('[preview] url-bar reload', e));
  }

  function handleOpenBrowser() {
    console.warn('[preview] open-in-browser: no external open API, using navigate fallback');
    if (!port) return;
    handle
      ?.navigate(`http://localhost:${port}`)
      .catch((e: unknown) => console.warn('[preview] url-bar open-browser', e));
  }

  function handleClearCache() {
    if (!port) return;
    handle
      ?.navigate(`http://localhost:${port}`)
      .catch((e: unknown) => console.warn('[preview] url-bar clear-cache', e));
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

      <input
        data-testid="preview-url-input"
        value={draft}
        disabled={!isRunning}
        spellCheck={false}
        autoComplete="off"
        placeholder="localhost:…"
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={handleKeyDown}
        className={`flex-1 min-w-0 bg-transparent outline-none font-mono text-caption px-[4px] ${
          invalid
            ? 'text-destructive ring-1 ring-destructive rounded-sm'
            : isRunning
              ? 'text-foreground'
              : 'text-mf-text-4'
        }`}
      />

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
