import { useEffect, useState } from 'react';
import { RotateCw, ExternalLink, Eraser } from 'lucide-react';
import { PreviewIconButton } from './PreviewIconButton';
import { usePreviewAddress } from './use-preview-address';
import { normalizePreviewUrl } from './normalize-url';
import { useHost } from '@/lib/host';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';

interface PreviewUrlBarProps {
  handle: PreviewHandle | null;
  /** The address to show until the webview navigates somewhere else. */
  seedUrl: string | null;
  /** Whether the bar accepts typing — the URL tab keeps it live with no webview. */
  enabled: boolean;
  /**
   * When supplied, Enter hands the normalized URL to the owner instead of
   * navigating: the owner re-drives the mount, so there is one navigation and
   * no race between an optimistic navigate and a changed `seedUrl`.
   */
  onCommitUrl?: (url: string) => void;
}

export function PreviewUrlBar({ handle, seedUrl, enabled, onCommitUrl }: PreviewUrlBarProps) {
  const host = useHost();
  const { currentUrl, navigateTo } = usePreviewAddress(handle, seedUrl);
  const [draft, setDraft] = useState(currentUrl);
  const [invalid, setInvalid] = useState(false);
  const canAct = enabled && handle !== null;

  // Keep the editable draft in sync when the current URL changes (re-seed or an
  // in-webview navigation). Overwrites an in-progress edit by design — the bar
  // always shows the live URL, matching a browser address bar.
  useEffect(() => {
    setDraft(currentUrl);
    setInvalid(false);
  }, [currentUrl]);

  function commit() {
    if (!onCommitUrl) {
      if (!navigateTo(draft)) setInvalid(true);
      return;
    }
    const normalized = normalizePreviewUrl(draft);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    onCommitUrl(normalized);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      commit();
    } else if (e.key === 'Escape') {
      setDraft(currentUrl);
      setInvalid(false);
    }
  }

  function handleReload() {
    if (!currentUrl) return;
    handle?.navigate(currentUrl).catch((e: unknown) => console.warn('[preview] url-bar reload', e));
  }

  function handleOpenBrowser() {
    if (!currentUrl) return;
    host.shell.openExternal(currentUrl).catch((e: unknown) => console.warn('[preview] url-bar open-browser', e));
  }

  function handleClearCache() {
    handle?.clearCache?.().catch((e: unknown) => console.warn('[preview] url-bar clear-cache', e));
  }

  return (
    <div className="min-w-0 flex-1 flex items-center gap-0.5 h-[26px] rounded-md border-[0.5px] border-border bg-card pl-0.5 pr-[4px]">
      <PreviewIconButton testId="preview-url-reload" title="Reload preview" onClick={handleReload} disabled={!canAct}>
        <RotateCw size={14} />
      </PreviewIconButton>

      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mx-0.5 ${
          enabled ? 'bg-mf-success animate-pulse' : 'bg-mf-text-4'
        }`}
      />

      <input
        data-testid="preview-url-input"
        value={draft}
        disabled={!enabled}
        spellCheck={false}
        autoComplete="off"
        placeholder="localhost:…"
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={handleKeyDown}
        className={`flex-1 min-w-0 bg-transparent outline-none font-mono text-body px-[4px] ${
          invalid
            ? 'text-destructive ring-1 ring-destructive rounded-sm'
            : enabled
              ? 'text-foreground'
              : 'text-muted-foreground'
        }`}
      />

      <PreviewIconButton
        testId="preview-url-open-browser"
        title="Open in browser"
        onClick={handleOpenBrowser}
        disabled={!canAct}
      >
        <ExternalLink size={14} />
      </PreviewIconButton>

      <PreviewIconButton
        testId="preview-url-clear-cache"
        title="Clear cache"
        onClick={handleClearCache}
        disabled={!canAct}
      >
        <Eraser size={14} />
      </PreviewIconButton>
    </div>
  );
}
