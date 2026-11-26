import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, ExternalLink, Eraser } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
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

  function goHistory(direction: -1 | 1) {
    handle?.goHistory?.(direction).catch((error: unknown) => console.warn('[preview] history navigation', error));
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
    <InputGroup className="ml-1 h-7 min-w-0 flex-1 rounded-md border-transparent bg-chrome-chip shadow-none dark:bg-chrome-chip">
      <InputGroupAddon className="gap-1">
        <Hint label="Back">
          <InputGroupButton
            data-testid="preview-url-back"
            size="icon-xs"
            aria-label="Back"
            disabled={!canAct || !handle?.goHistory}
            onClick={() => goHistory(-1)}
          >
            <ChevronLeft />
          </InputGroupButton>
        </Hint>
        <Hint label="Forward">
          <InputGroupButton
            data-testid="preview-url-forward"
            size="icon-xs"
            aria-label="Forward"
            disabled={!canAct || !handle?.goHistory}
            onClick={() => goHistory(1)}
          >
            <ChevronRight />
          </InputGroupButton>
        </Hint>
        <Hint label="Reload preview">
          <InputGroupButton
            data-testid="preview-url-reload"
            size="icon-xs"
            aria-label="Reload preview"
            onClick={handleReload}
            disabled={!canAct}
          >
            <RotateCw className="size-4" />
          </InputGroupButton>
        </Hint>
      </InputGroupAddon>

      <InputGroupInput
        data-testid="preview-url-input"
        value={draft}
        disabled={!enabled}
        spellCheck={false}
        autoComplete="off"
        placeholder="localhost:…"
        aria-invalid={invalid}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={handleKeyDown}
        className="text-meta/[1.45] text-ink-secondary md:text-meta/[1.45]"
      />

      <InputGroupAddon align="inline-end" className="gap-1">
        <Hint label="Open in browser">
          <InputGroupButton
            data-testid="preview-url-open-browser"
            size="icon-xs"
            aria-label="Open in browser"
            onClick={handleOpenBrowser}
            disabled={!canAct}
          >
            <ExternalLink />
          </InputGroupButton>
        </Hint>
        <Hint label="Clear cache">
          <InputGroupButton
            data-testid="preview-url-clear-cache"
            size="icon-xs"
            aria-label="Clear cache"
            onClick={handleClearCache}
            disabled={!canAct}
          >
            <Eraser />
          </InputGroupButton>
        </Hint>
      </InputGroupAddon>
    </InputGroup>
  );
}
